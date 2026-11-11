// A pretend camera video stream: a tiny RTSP server that loops an H.264 clip
// over RTP inside the RTSP connection, the way the app asks real cameras to.
// Used by the tests and by `npm run sim -- --video`.

import net from 'node:net';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitAnnexB, nalType, isVcl, NAL } from '../src/main/video/h264.js';
import { buildRtp } from '../src/main/video/rtp.js';
import { parseResponse } from '../src/main/video/rtsp-client.js';

const DEFAULT_CLIP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'test-pattern.h264');
const MAX_PAYLOAD = 1200;

// Groups NAL units into frames: SPS/PPS/SEI go with the picture that follows.
function loadFrames(file) {
    const frames = [];
    let current = [];
    for (const nal of splitAnnexB(fs.readFileSync(file))) {
        const type = nalType(nal);
        if (type === NAL.AUD) continue;
        current.push(nal);
        if (isVcl(type)) {
            frames.push(current);
            current = [];
        }
    }
    return frames;
}

// Turns one frame into RTP payloads: SPS+PPS together as STAP-A, big NALs
// split as FU-A, everything else as single NAL packets.
function packetize(nals) {
    const out = [];
    const params = nals.filter((n) => nalType(n) === NAL.SPS || nalType(n) === NAL.PPS);
    if (params.length) {
        const parts = [Buffer.from([NAL.STAP_A | (params[0][0] & 0x60)])];
        for (const p of params) {
            const size = Buffer.alloc(2);
            size.writeUInt16BE(p.length);
            parts.push(size, p);
        }
        out.push(Buffer.concat(parts));
    }
    for (const nal of nals) {
        const type = nalType(nal);
        if (type === NAL.SPS || type === NAL.PPS) continue;
        if (nal.length <= MAX_PAYLOAD) {
            out.push(nal);
            continue;
        }
        const indicator = (nal[0] & 0xe0) | NAL.FU_A;
        for (let i = 1; i < nal.length; i += MAX_PAYLOAD) {
            const start = i === 1 ? 0x80 : 0;
            const end = i + MAX_PAYLOAD >= nal.length ? 0x40 : 0;
            out.push(Buffer.concat([Buffer.from([indicator, start | end | type]), nal.subarray(i, i + MAX_PAYLOAD)]));
        }
    }
    return out;
}

export class FakeRtspServer {
    constructor({
        port = 0,
        host = '127.0.0.1',
        path: streamPath = '/live/av1',
        file = DEFAULT_CLIP,
        fps = 25,
        encoding = 'H264',
        auth = null, // { username, password } turns on Digest login
    } = {}) {
        this.requestedPort = port;
        this.host = host;
        this.path = streamPath;
        this.fps = fps;
        this.encoding = encoding;
        this.auth = auth;
        this.frames = loadFrames(file);
        const sps = this.frames.flat().find((n) => nalType(n) === NAL.SPS);
        const pps = this.frames.flat().find((n) => nalType(n) === NAL.PPS);
        this.sprop = `${sps.toString('base64')},${pps.toString('base64')}`;
        this.profileLevelId = sps.subarray(1, 4).toString('hex');
        this.server = null;
        this.connections = new Set();
        this.port = null;
    }

    get url() {
        return `rtsp://${this.host}:${this.port}${this.path}`;
    }

    start() {
        return new Promise((resolve, reject) => {
            const server = net.createServer((socket) => this.#onConnection(socket));
            server.once('error', reject);
            server.listen(this.requestedPort, this.host, () => {
                this.server = server;
                this.port = server.address().port;
                resolve(this);
            });
        });
    }

    async stop() {
        for (const c of this.connections) {
            clearInterval(c.timer);
            c.socket.destroy();
        }
        this.connections.clear();
        if (this.server) await new Promise((r) => this.server.close(() => r()));
        this.server = null;
    }

    #onConnection(socket) {
        const conn = { socket, buffer: '', timer: null, seq: 0, timestamp: 0, frame: 0, nonce: crypto.randomBytes(8).toString('hex') };
        this.connections.add(conn);
        socket.on('error', () => {});
        socket.on('close', () => {
            clearInterval(conn.timer);
            this.connections.delete(conn);
        });
        socket.on('data', (chunk) => {
            conn.buffer += chunk.toString('latin1');
            let end;
            while ((end = conn.buffer.indexOf('\r\n\r\n')) !== -1) {
                const head = conn.buffer.slice(0, end);
                conn.buffer = conn.buffer.slice(end + 4);
                this.#onRequest(conn, head);
            }
        });
    }

    #reply(conn, cseq, status, reason, headers = {}, body = '') {
        const lines = [`RTSP/1.0 ${status} ${reason}`, `CSeq: ${cseq}`];
        for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
        if (body) lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
        conn.socket.write(`${lines.join('\r\n')}\r\n\r\n${body}`);
    }

    #authorized(conn, method, headers) {
        if (!this.auth) return true;
        const header = headers.authorization || '';
        const params = {};
        for (const m of header.matchAll(/(\w+)="?([^",]*)"?/g)) params[m[1]] = m[2];
        const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
        const ha1 = md5(`${this.auth.username}:fake:${this.auth.password}`);
        const ha2 = md5(`${method}:${params.uri}`);
        const expected = params.qop
            ? md5(`${ha1}:${conn.nonce}:${params.nc}:${params.cnonce}:${params.qop}:${ha2}`)
            : md5(`${ha1}:${conn.nonce}:${ha2}`);
        return header.startsWith('Digest ') && params.username === this.auth.username && params.response === expected;
    }

    #onRequest(conn, head) {
        const firstLine = head.split('\r\n')[0];
        const [method, url] = firstLine.split(' ');
        const { headers } = parseResponse(`RTSP/1.0 200 OK\r\n${head.split('\r\n').slice(1).join('\r\n')}`);
        const cseq = headers.cseq;

        if (method !== 'OPTIONS' && !this.#authorized(conn, method, headers)) {
            this.#reply(conn, cseq, 401, 'Unauthorized', {
                'WWW-Authenticate': `Digest realm="fake", nonce="${conn.nonce}", qop="auth"`,
            });
            return;
        }
        const pathname = (() => { try { return new URL(url).pathname; } catch { return ''; } })();
        if (method !== 'OPTIONS' && !pathname.startsWith(this.path)) {
            this.#reply(conn, cseq, 404, 'Not Found');
            return;
        }

        switch (method) {
            case 'OPTIONS':
                this.#reply(conn, cseq, 200, 'OK', { Public: 'OPTIONS, DESCRIBE, SETUP, PLAY, TEARDOWN, GET_PARAMETER' });
                break;
            case 'DESCRIBE': {
                const encoding = this.encoding === 'H265' ? 'H265' : 'H264';
                const sdp = [
                    'v=0',
                    'o=- 0 0 IN IP4 127.0.0.1',
                    's=Fake camera',
                    't=0 0',
                    'm=video 0 RTP/AVP 96',
                    `a=rtpmap:96 ${encoding}/90000`,
                    `a=fmtp:96 packetization-mode=1;profile-level-id=${this.profileLevelId};sprop-parameter-sets=${this.sprop}`,
                    'a=control:trackID=1',
                    '',
                ].join('\r\n');
                this.#reply(conn, cseq, 200, 'OK', {
                    'Content-Base': `rtsp://${this.host}:${this.port}${this.path}/`,
                    'Content-Type': 'application/sdp',
                }, sdp);
                break;
            }
            case 'SETUP':
                this.#reply(conn, cseq, 200, 'OK', {
                    Transport: 'RTP/AVP/TCP;unicast;interleaved=0-1',
                    Session: '12345678;timeout=60',
                });
                break;
            case 'PLAY':
                this.#reply(conn, cseq, 200, 'OK', { Session: '12345678' });
                if (!conn.timer) conn.timer = setInterval(() => this.#sendFrame(conn), 1000 / this.fps);
                break;
            case 'GET_PARAMETER':
                this.#reply(conn, cseq, 200, 'OK', { Session: '12345678' });
                break;
            case 'TEARDOWN':
                this.#reply(conn, cseq, 200, 'OK');
                clearInterval(conn.timer);
                conn.socket.end();
                break;
            default:
                this.#reply(conn, cseq, 501, 'Not Implemented');
        }
    }

    #sendFrame(conn) {
        const nals = this.frames[conn.frame % this.frames.length];
        conn.frame += 1;
        conn.timestamp += Math.round(90000 / this.fps);
        const payloads = packetize(nals);
        payloads.forEach((payload, i) => {
            const rtp = buildRtp({ payload, seq: conn.seq, timestamp: conn.timestamp, marker: i === payloads.length - 1 });
            conn.seq = (conn.seq + 1) & 0xffff;
            const head = Buffer.alloc(4);
            head[0] = 0x24;
            head[1] = 0;
            head.writeUInt16BE(rtp.length, 2);
            conn.socket.write(Buffer.concat([head, rtp]));
        });
    }
}
