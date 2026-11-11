// A small RTSP client (RFC 2326) that plays one H.264 video track, with the
// video sent inside the RTSP TCP connection ("interleaved"). TCP avoids extra
// UDP ports and firewall prompts.
//
// Events:
//   'playing' ({ codec })                         video has started
//   'frame'   ({ data, key, timestamp, codec })   one H.264 frame, Annex B bytes
//   'error'   (Error)                             err.userMessage is plain words
//   'close'   ()

import net from 'node:net';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { parseRtp } from './rtp.js';
import { H264Depacketizer, toAnnexB, codecString } from './h264.js';

const USER_AGENT = 'PTZ Control';
const NO_VIDEO_MS = 6000;

export class RtspClient extends EventEmitter {
    constructor(url, { timeoutMs = 5000 } = {}) {
        super();
        this.url = new URL(url);
        if (this.url.protocol !== 'rtsp:') throw new Error('The video address must start with rtsp://');
        this.username = decodeURIComponent(this.url.username);
        this.password = decodeURIComponent(this.url.password);
        this.url.username = '';
        this.url.password = '';
        this.timeoutMs = timeoutMs;
        this.cseq = 0;
        this.pending = new Map(); // cseq -> { resolve, reject, timer }
        this.buffer = Buffer.alloc(0);
        this.socket = null;
        this.session = null;
        this.auth = null;
        this.keepAliveTimer = null;
        this.noVideoTimer = null;
        this.closed = false;
        this.codec = null;
        this.depacketizer = null;
        this.channel = 0;
        this.playing = false;
    }

    get cleanUrl() {
        return this.url.toString();
    }

    async start() {
        try {
            await this.#connect();
            const describe = await this.#request('DESCRIBE', this.cleanUrl, { Accept: 'application/sdp' });
            const base = describe.headers['content-base'] || describe.headers['content-location'] || this.cleanUrl;
            const track = parseSdp(describe.body);
            if (!track) throw userError('ENOVIDEO', 'The camera\'s stream has no video in it.');
            if (track.encoding !== 'H264') {
                throw userError(
                    'EUNSUPPORTED',
                    `This camera sends ${track.encoding} video, which the app cannot show. In the camera's web page, set the stream to H.264 (Configuration, Video Encode).`,
                );
            }
            this.depacketizer = new H264Depacketizer({ sps: track.sps, pps: track.pps });
            if (track.sps) this.codec = codecString(track.sps);

            const setup = await this.#request('SETUP', resolveControl(base, track.control), {
                Transport: 'RTP/AVP/TCP;unicast;interleaved=0-1',
            });
            this.session = (setup.headers.session || '').split(';')[0].trim();
            const timeout = Number(/timeout=(\d+)/.exec(setup.headers.session || '')?.[1]) || 60;
            const transport = setup.headers.transport || '';
            const interleaved = /interleaved=(\d+)/.exec(transport);
            this.channel = interleaved ? Number(interleaved[1]) : 0;

            await this.#request('PLAY', base, { Range: 'npt=0.000-' });
            this.#armNoVideo();
            this.keepAliveTimer = setInterval(() => {
                this.#request('GET_PARAMETER', base).catch(() => {});
            }, Math.max(5, timeout / 2) * 1000);
            this.keepAliveTimer.unref?.();
        } catch (err) {
            this.#fail(err);
        }
    }

    stop() {
        if (this.closed) return;
        if (this.socket && this.session) {
            // Polite goodbye; the socket closes right after either way.
            try { this.socket.write(this.#format('TEARDOWN', this.cleanUrl, {})); } catch {}
        }
        this.#close();
    }

    #connect() {
        return new Promise((resolve, reject) => {
            const port = Number(this.url.port) || 554;
            const socket = net.createConnection({ host: this.url.hostname, port });
            this.socket = socket;
            socket.setNoDelay(true);
            const timer = setTimeout(() => socket.destroy(withCode(new Error('timeout'), 'ETIMEDOUT')), this.timeoutMs);
            socket.once('connect', () => {
                clearTimeout(timer);
                resolve();
            });
            socket.on('data', (chunk) => this.#onData(chunk));
            socket.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
                this.#fail(err);
            });
            socket.on('close', () => {
                clearTimeout(timer);
                if (!this.closed) this.#fail(userError('ECLOSED', 'The camera closed the video connection.'));
            });
        });
    }

    async #request(method, url, headers = {}) {
        let res = await this.#send(method, url, headers);
        if (res.status === 401 && !this.auth) {
            const challenge = res.headers['www-authenticate'];
            if (!this.username) {
                throw userError(
                    'EAUTH',
                    'The camera asks for a login to show video. Put the username and password in the video address, like rtsp://admin:password@192.168.1.50:554/live/av1',
                );
            }
            this.auth = parseChallenge(challenge);
            res = await this.#send(method, url, headers);
        }
        if (res.status === 401) throw userError('EAUTH', 'The camera did not accept the video username or password.');
        if (res.status === 404) throw userError('ENOTFOUND', 'The camera has no video stream at this address. Check the video address.');
        if (res.status < 200 || res.status >= 300) {
            throw userError('ERTSP', `The camera answered "${res.status} ${res.reason}" when asked for video.`);
        }
        return res;
    }

    #send(method, url, headers) {
        if (!this.socket || this.closed) return Promise.reject(userError('ECLOSED', 'The video connection is closed.'));
        this.cseq += 1;
        const cseq = this.cseq;
        const text = this.#format(method, url, headers, cseq);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(cseq);
                reject(userError('ETIMEDOUT', 'The camera did not answer the request for video.'));
            }, this.timeoutMs);
            this.pending.set(cseq, { resolve, reject, timer });
            this.socket.write(text);
        });
    }

    #format(method, url, headers, cseq = ++this.cseq) {
        const lines = [`${method} ${url} RTSP/1.0`, `CSeq: ${cseq}`, `User-Agent: ${USER_AGENT}`];
        if (this.session) lines.push(`Session: ${this.session}`);
        if (this.auth) lines.push(`Authorization: ${this.#authorization(method, url)}`);
        for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
        return `${lines.join('\r\n')}\r\n\r\n`;
    }

    #authorization(method, uri) {
        const { scheme, realm, nonce, qop, opaque } = this.auth;
        if (scheme === 'basic') {
            return `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
        }
        const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
        const ha1 = md5(`${this.username}:${realm}:${this.password}`);
        const ha2 = md5(`${method}:${uri}`);
        const parts = [`username="${this.username}"`, `realm="${realm}"`, `nonce="${nonce}"`, `uri="${uri}"`];
        if (qop) {
            const nc = '00000001';
            const cnonce = crypto.randomBytes(8).toString('hex');
            parts.push(`qop=auth`, `nc=${nc}`, `cnonce="${cnonce}"`, `response="${md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`)}"`);
        } else {
            parts.push(`response="${md5(`${ha1}:${nonce}:${ha2}`)}"`);
        }
        if (opaque) parts.push(`opaque="${opaque}"`);
        return `Digest ${parts.join(', ')}`;
    }

    #onData(chunk) {
        this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
        for (;;) {
            if (!this.buffer.length) return;
            if (this.buffer[0] === 0x24) {
                // $ channel length(2) packet
                if (this.buffer.length < 4) return;
                const length = this.buffer.readUInt16BE(2);
                if (this.buffer.length < 4 + length) return;
                const channel = this.buffer[1];
                const packet = this.buffer.subarray(4, 4 + length);
                this.buffer = this.buffer.subarray(4 + length);
                if (channel === this.channel) this.#onRtp(packet);
                continue;
            }
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) {
                if (this.buffer.length > 65536) this.#fail(userError('ERTSP', 'The camera sent a reply the app could not read.'));
                return;
            }
            const head = this.buffer.subarray(0, headerEnd).toString('latin1');
            if (!head.startsWith('RTSP/')) {
                // Out of step: skip to the next possible start.
                const next = this.buffer.indexOf(0x24, 1);
                this.buffer = next === -1 ? Buffer.alloc(0) : this.buffer.subarray(next);
                continue;
            }
            const res = parseResponse(head);
            const length = Number(res.headers['content-length'] || 0);
            if (this.buffer.length < headerEnd + 4 + length) return;
            res.body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8');
            this.buffer = this.buffer.subarray(headerEnd + 4 + length);
            const waiter = this.pending.get(Number(res.headers.cseq));
            if (waiter) {
                this.pending.delete(Number(res.headers.cseq));
                clearTimeout(waiter.timer);
                waiter.resolve(res);
            }
        }
    }

    #onRtp(packet) {
        const rtp = parseRtp(packet);
        if (!rtp || !this.depacketizer) return;
        for (const frame of this.depacketizer.push(rtp.payload, rtp)) {
            if (!this.codec && this.depacketizer.sps) this.codec = codecString(this.depacketizer.sps);
            if (!this.codec) continue;
            this.#armNoVideo();
            if (!this.playing) {
                this.playing = true;
                this.emit('playing', { codec: this.codec });
            }
            this.emit('frame', { data: toAnnexB(frame.nals), key: frame.key, timestamp: frame.timestamp, codec: this.codec });
        }
    }

    #armNoVideo() {
        clearTimeout(this.noVideoTimer);
        this.noVideoTimer = setTimeout(() => {
            this.#fail(userError('ENOVIDEO', 'The camera connected but no video arrived.'));
        }, NO_VIDEO_MS);
        this.noVideoTimer.unref?.();
    }

    #fail(err) {
        if (this.closed) return;
        const e = err?.userMessage ? err : userError(err?.code || 'ERTSP', describeNetworkError(err, this.url));
        this.#close();
        this.emit('error', e);
    }

    #close() {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.keepAliveTimer);
        clearTimeout(this.noVideoTimer);
        for (const { reject, timer } of this.pending.values()) {
            clearTimeout(timer);
            reject(userError('ECLOSED', 'The video connection is closed.'));
        }
        this.pending.clear();
        this.socket?.removeAllListeners('data');
        this.socket?.on('error', () => {});
        this.socket?.destroy();
        this.socket = null;
        this.emit('close');
    }
}

function withCode(err, code) {
    err.code = code;
    return err;
}

function userError(code, message) {
    const err = new Error(message);
    err.code = code;
    err.userMessage = message;
    return err;
}

function describeNetworkError(err, url) {
    const host = url.hostname;
    const port = Number(url.port) || 554;
    switch (err?.code) {
        case 'ECONNREFUSED': return `The camera at ${host} refused the video connection on port ${port}.`;
        case 'EHOSTUNREACH':
        case 'ENETUNREACH': return `This computer cannot reach ${host} for video.`;
        case 'ENOTFOUND':
        case 'EAI_AGAIN': return `"${host}" is not a known address.`;
        case 'ETIMEDOUT': return `No answer from ${host}:${port} for video.`;
        case 'ECONNRESET': return 'The camera dropped the video connection.';
        default: return err?.message || 'The video could not be started.';
    }
}

export function parseResponse(head) {
    const [statusLine, ...lines] = head.split('\r\n');
    const m = /^RTSP\/\d\.\d\s+(\d+)\s*(.*)$/.exec(statusLine);
    const headers = {};
    for (const line of lines) {
        const i = line.indexOf(':');
        if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    return { status: m ? Number(m[1]) : 0, reason: m ? m[2] : '', headers, body: '' };
}

export function parseChallenge(header = '') {
    const scheme = header.trim().split(/\s+/)[0]?.toLowerCase();
    const params = {};
    for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) params[m[1].toLowerCase()] = m[2] ?? m[3];
    return {
        scheme: scheme === 'basic' ? 'basic' : 'digest',
        realm: params.realm || '',
        nonce: params.nonce || '',
        opaque: params.opaque,
        qop: params.qop && params.qop.split(',').map((q) => q.trim()).includes('auth') ? 'auth' : null,
    };
}

// Finds the first video track in an SDP description.
export function parseSdp(sdp = '') {
    const lines = sdp.split(/\r?\n/);
    let track = null;
    for (const line of lines) {
        if (line.startsWith('m=')) {
            if (track) break;
            if (line.startsWith('m=video')) track = { payloadType: Number(line.split(' ')[3]), control: null, encoding: null, sps: null, pps: null };
            continue;
        }
        if (!track) continue;
        if (line.startsWith('a=control:')) track.control = line.slice('a=control:'.length).trim();
        const rtpmap = /^a=rtpmap:(\d+)\s+([\w-]+)\//.exec(line);
        if (rtpmap && Number(rtpmap[1]) === track.payloadType) track.encoding = rtpmap[2].toUpperCase();
        const fmtp = /^a=fmtp:(\d+)\s+(.*)$/.exec(line);
        if (fmtp) {
            const sets = /sprop-parameter-sets=([^;\s]+)/.exec(fmtp[2]);
            if (sets) {
                const [sps, pps] = sets[1].split(',').map((s) => Buffer.from(s, 'base64'));
                track.sps = sps?.length ? sps : null;
                track.pps = pps?.length ? pps : null;
            }
        }
    }
    if (track && track.encoding === 'H265') track.encoding = 'H.265';
    return track;
}

function resolveControl(base, control) {
    if (!control || control === '*') return base;
    if (/^rtsp:\/\//i.test(control)) return control;
    return base.endsWith('/') ? base + control : `${base}/${control}`;
}
