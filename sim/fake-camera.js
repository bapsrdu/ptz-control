#!/usr/bin/env node
// A pretend PTZ camera that answers VISCA over IP. Used by the tests, and by
// people who want to try the app without real cameras.
//
//   npm run sim -- --mode udp-raw --port 1259 --count 3 --video
//
// starts three fake cameras on ports 1259, 1260 and 1261 and prints every
// command they receive. Add them in the app as 127.0.0.1 with those ports.
// With --video each also streams a test picture; the video addresses are
// printed (rtsp://127.0.0.1:8554/live/av1 and up).

import dgram from 'node:dgram';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createDecoder, encodeSony, PAYLOAD } from '../src/main/visca/framing.js';
import { parseMode, MODES } from '../src/main/visca/transport.js';
import { toHex } from '../src/main/visca/commands.js';
import { FakeRtspServer } from './fake-rtsp.js';

const ACK = [0x90, 0x41, 0xff];
const COMPLETION = [0x90, 0x51, 0xff];
const SYNTAX_ERROR = [0x90, 0x60, 0x02, 0xff];

export class FakeCamera extends EventEmitter {
    constructor({ mode = 'udp-sony', port = 0, host = '127.0.0.1', silent = false } = {}) {
        super();
        const { protocol, framing } = parseMode(mode);
        this.mode = mode;
        this.protocol = protocol;
        this.framing = framing;
        this.host = host;
        this.requestedPort = port;
        this.port = null;
        // When silent, the camera receives but never answers (a dead camera).
        this.silent = silent;
        this.log = [];
        this.state = {
            power: true,
            pan: 0,
            tilt: 0,
            zoom: 0,
            focusAuto: true,
            tracking: false,
            panTilt: { panDir: 3, tiltDir: 3, panSpeed: 0, tiltSpeed: 0 },
            zoomDrive: 0,
            presets: new Map(),
            lastPreset: null,
            tally: { red: false, green: false },
            ae: 0x00,
            expCompOn: false,
            expComp: 7,
            backlight: false,
            wb: 0x00,
            iris: 10,
            shutter: 8,
            bright: 12,
        };
        this.server = null;
        this.clients = new Set();
        this.motionTimer = null;
    }

    async start() {
        if (this.protocol === 'udp') await this.#startUdp();
        else await this.#startTcp();
        this.motionTimer = setInterval(() => this.#tickMotion(), 50);
        this.motionTimer.unref?.();
        return this;
    }

    async stop() {
        clearInterval(this.motionTimer);
        for (const c of this.clients) c.destroy();
        this.clients.clear();
        if (!this.server) return;
        const server = this.server;
        this.server = null;
        await new Promise((resolve) => server.close(() => resolve()));
    }

    clearLog() {
        this.log = [];
    }

    // Hex strings of every VISCA message received, e.g. "81 01 06 04 FF".
    get received() {
        return this.log.map((e) => e.hex);
    }

    #startUdp() {
        return new Promise((resolve, reject) => {
            const socket = dgram.createSocket('udp4');
            socket.once('error', reject);
            socket.on('message', (datagram, rinfo) => {
                const reply = (bytes, seq) => {
                    socket.send(this.#frame(bytes, seq), rinfo.port, rinfo.address);
                };
                this.#onData(createDecoder(this.framing), datagram, reply);
            });
            socket.bind(this.requestedPort, this.host, () => {
                socket.removeListener('error', reject);
                this.port = socket.address().port;
                this.server = socket;
                resolve();
            });
        });
    }

    #startTcp() {
        return new Promise((resolve, reject) => {
            const server = net.createServer((conn) => {
                this.clients.add(conn);
                const decoder = createDecoder(this.framing);
                conn.on('data', (chunk) => {
                    this.#onData(decoder, chunk, (bytes, seq) => conn.write(this.#frame(bytes, seq)));
                });
                conn.on('error', () => {});
                conn.on('close', () => this.clients.delete(conn));
            });
            server.once('error', reject);
            server.listen(this.requestedPort, this.host, () => {
                server.removeListener('error', reject);
                this.port = server.address().port;
                this.server = server;
                resolve();
            });
        });
    }

    #frame(bytes, seq) {
        const payload = Buffer.from(bytes);
        if (this.framing === 'raw') return payload;
        return encodeSony(payload, { type: PAYLOAD.REPLY, seq: seq ?? 0 });
    }

    #onData(decoder, chunk, reply) {
        // A camera set up for plain VISCA that is sent a Sony header sees
        // garbage bytes before the real message. Real cameras answer that with
        // a syntax error, so this one does too.
        if (this.framing === 'raw' && chunk.length && (chunk[0] & 0x80) === 0) {
            this.log.push({ hex: toHex(chunk), garbage: true });
            if (!this.silent) reply(SYNTAX_ERROR);
            return;
        }
        for (const message of decoder.push(chunk)) {
            const hex = toHex(message.payload);
            this.log.push({ hex, type: message.type, seq: message.seq });
            this.emit('command', hex);
            if (process.env.FAKE_CAMERA_VERBOSE) {
                console.log(`[cam :${this.port}] ${hex}`);
            }
            if (this.silent) continue;
            for (const bytes of this.#handle(message.payload)) reply(bytes, message.seq);
        }
    }

    // Returns the reply messages for one VISCA message.
    #handle(p) {
        const b = [...p];
        const s = this.state;
        const is = (...prefix) => prefix.every((v, i) => b[i + 1] === v);
        const done = () => [ACK, COMPLETION];

        if (b[0] < 0x81 || b[0] > 0x87 || b[b.length - 1] !== 0xff) return [SYNTAX_ERROR];

        // Inquiries
        if (is(0x09, 0x04, 0x00) && b.length === 5) return [[0x90, 0x50, s.power ? 0x02 : 0x03, 0xff]];
        if (is(0x09, 0x04, 0x47) && b.length === 5) return [[0x90, 0x50, ...nibbles(s.zoom), 0xff]];
        if (is(0x09, 0x06, 0x12) && b.length === 5) {
            return [[0x90, 0x50, ...nibbles(s.pan), ...nibbles(s.tilt), 0xff]];
        }
        if (is(0x09, 0x04, 0x3f) && b.length === 5) return [[0x90, 0x50, s.lastPreset ?? 0, 0xff]];
        if (is(0x09, 0x04, 0x38) && b.length === 5) return [[0x90, 0x50, s.focusAuto ? 0x02 : 0x03, 0xff]];
        if (is(0x09, 0x04, 0x39) && b.length === 5) return [[0x90, 0x50, s.ae, 0xff]];
        if (is(0x09, 0x04, 0x3e) && b.length === 5) return [[0x90, 0x50, s.expCompOn ? 0x02 : 0x03, 0xff]];
        if (is(0x09, 0x04, 0x33) && b.length === 5) return [[0x90, 0x50, s.backlight ? 0x02 : 0x03, 0xff]];
        if (is(0x09, 0x04, 0x35) && b.length === 5) return [[0x90, 0x50, s.wb, 0xff]];
        const levels = { 0x4e: 'expComp', 0x4b: 'iris', 0x4a: 'shutter', 0x4d: 'bright' };
        if (b[1] === 0x09 && b[2] === 0x04 && levels[b[3]] && b.length === 5) {
            const v = s[levels[b[3]]];
            return [[0x90, 0x50, 0x00, 0x00, (v >> 4) & 0x0f, v & 0x0f, 0xff]];
        }

        // A camera in standby only answers power commands and inquiries.
        if (!s.power && !(is(0x01, 0x04, 0x00) && b.length === 6)) return [[0x90, 0x61, 0x41, 0xff]];

        // Power
        if (is(0x01, 0x04, 0x00) && b.length === 6 && (b[4] === 0x02 || b[4] === 0x03)) {
            s.power = b[4] === 0x02;
            return done();
        }
        // Exposure
        if (is(0x01, 0x04, 0x39) && b.length === 6 && [0x00, 0x03, 0x0a, 0x0b, 0x0d].includes(b[4])) {
            s.ae = b[4];
            return done();
        }
        if (is(0x01, 0x04, 0x3e) && b.length === 6 && (b[4] === 0x02 || b[4] === 0x03)) {
            s.expCompOn = b[4] === 0x02;
            return done();
        }
        if (is(0x01, 0x04, 0x33) && b.length === 6 && (b[4] === 0x02 || b[4] === 0x03)) {
            s.backlight = b[4] === 0x02;
            return done();
        }
        const steps = { 0x0e: ['expComp', 7, 14], 0x0b: ['iris', 10, 17], 0x0a: ['shutter', 8, 21], 0x0d: ['bright', 12, 27] };
        if (b[1] === 0x01 && b[2] === 0x04 && steps[b[3]] && b.length === 6 && [0x00, 0x02, 0x03].includes(b[4])) {
            const [key, reset, max] = steps[b[3]];
            if (b[4] === 0x00) s[key] = reset;
            if (b[4] === 0x02) s[key] = Math.min(max, s[key] + 1);
            if (b[4] === 0x03) s[key] = Math.max(0, s[key] - 1);
            return done();
        }
        if (is(0x01, 0x04, 0x35) && b.length === 6 && b[4] <= 0x0b) {
            s.wb = b[4];
            return done();
        }
        if (is(0x01, 0x04, 0x10, 0x05) && b.length === 6) return done();

        // Pan/tilt drive
        if (is(0x01, 0x06, 0x01) && b.length === 9) {
            const [, , , , panSpeed, tiltSpeed, panDir, tiltDir] = b;
            if (panSpeed < 1 || panSpeed > 0x18 || tiltSpeed < 1 || tiltSpeed > 0x14) return [SYNTAX_ERROR];
            if (![1, 2, 3].includes(panDir) || ![1, 2, 3].includes(tiltDir)) return [SYNTAX_ERROR];
            s.panTilt = { panDir, tiltDir, panSpeed, tiltSpeed };
            return done();
        }
        // Home
        if (is(0x01, 0x06, 0x04) && b.length === 5) {
            s.pan = 0;
            s.tilt = 0;
            s.panTilt = { panDir: 3, tiltDir: 3, panSpeed: 0, tiltSpeed: 0 };
            return done();
        }
        // Zoom
        if (is(0x01, 0x04, 0x07) && b.length === 6) {
            const v = b[4];
            if (v === 0x00) s.zoomDrive = 0;
            else if ((v & 0xf0) === 0x20) s.zoomDrive = (v & 0x0f) + 1;
            else if ((v & 0xf0) === 0x30) s.zoomDrive = -((v & 0x0f) + 1);
            else if (v === 0x02) s.zoomDrive = 4;
            else if (v === 0x03) s.zoomDrive = -4;
            else return [SYNTAX_ERROR];
            return done();
        }
        // Focus mode
        if (is(0x01, 0x04, 0x38) && b.length === 6 && (b[4] === 0x02 || b[4] === 0x03)) {
            s.focusAuto = b[4] === 0x02;
            return done();
        }
        // Focus drive. Real cameras refuse manual focus moves while in auto focus.
        if (is(0x01, 0x04, 0x08) && b.length === 6 && [0x00, 0x02, 0x03].includes(b[4])) {
            if (s.focusAuto && b[4] !== 0x00) return [[0x90, 0x61, 0x41, 0xff]];
            return done();
        }
        // Presets
        if (is(0x01, 0x04, 0x3f) && b.length === 7 && b[5] <= 254) {
            const n = b[5];
            if (b[4] === 0x00) s.presets.delete(n);
            else if (b[4] === 0x01) s.presets.set(n, { pan: s.pan, tilt: s.tilt, zoom: s.zoom });
            else if (b[4] === 0x02) {
                const p = s.presets.get(n);
                if (p) Object.assign(s, p);
            } else return [SYNTAX_ERROR];
            s.lastPreset = n;
            return done();
        }
        // BZB auto tracking
        if (b.length === 9 && b[1] === 0x0a && b[2] === 0x01 && b[3] === 0x32 && b[4] === 0 && b[5] === 0 && b[7] === 0) {
            if (b[6] === 0x02) s.tracking = true;
            else if (b[6] === 0x03) s.tracking = false;
            else return [SYNTAX_ERROR];
            return done();
        }
        // BZB tally
        if (b.length === 9 && is(0x01, 0x7e, 0x01, 0x0a, 0x00)) {
            if (b[6] === 0x02) s.tally.red = true;
            if (b[6] === 0x03) s.tally.red = false;
            if (b[7] === 0x02) s.tally.green = true;
            if (b[7] === 0x03) s.tally.green = false;
            return done();
        }
        return [SYNTAX_ERROR];
    }

    #tickMotion() {
        const s = this.state;
        const { panDir, tiltDir, panSpeed, tiltSpeed } = s.panTilt;
        if (panDir === 1) s.pan = clamp(s.pan - panSpeed * 4, -0x0990, 0x0990);
        if (panDir === 2) s.pan = clamp(s.pan + panSpeed * 4, -0x0990, 0x0990);
        if (tiltDir === 1) s.tilt = clamp(s.tilt + tiltSpeed * 4, -0x0200, 0x0510);
        if (tiltDir === 2) s.tilt = clamp(s.tilt - tiltSpeed * 4, -0x0200, 0x0510);
        if (s.zoomDrive) s.zoom = clamp(s.zoom + s.zoomDrive * 40, 0, 0x4000);
    }
}

function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

function nibbles(value) {
    const v = value & 0xffff;
    return [(v >> 12) & 0x0f, (v >> 8) & 0x0f, (v >> 4) & 0x0f, v & 0x0f];
}

function parseArgs(argv) {
    const args = { mode: 'udp-raw', port: 1259, count: 1, host: '0.0.0.0', video: false, videoPort: 8554 };
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i].replace(/^--/, '');
        const value = argv[i + 1];
        if (key === 'help' || key === 'h') return { help: true };
        if (key === 'video') { args.video = true; continue; }
        if (key === 'video-port') { args.videoPort = Number(value); i += 1; continue; }
        if (['mode', 'host'].includes(key)) { args[key] = value; i += 1; }
        else if (['port', 'count'].includes(key)) { args[key] = Number(value); i += 1; }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !MODES.includes(args.mode)) {
        console.log(`Usage: npm run sim -- [--mode ${MODES.join('|')}] [--port 1259] [--count 1] [--host 0.0.0.0] [--video] [--video-port 8554]`);
        process.exit(args.help ? 0 : 1);
    }
    process.env.FAKE_CAMERA_VERBOSE = '1';
    const cameras = [];
    for (let i = 0; i < args.count; i += 1) {
        const cam = new FakeCamera({ mode: args.mode, port: args.port + i, host: args.host });
        await cam.start();
        cameras.push(cam);
        console.log(`Fake camera ${i + 1}: ${args.mode} on ${args.host}:${cam.port}`);
        if (args.video) {
            const rtsp = await new FakeRtspServer({ host: args.host, port: args.videoPort + i }).start();
            cameras.push(rtsp);
            console.log(`  video address: rtsp://127.0.0.1:${rtsp.port}/live/av1`);
        }
    }
    console.log('Press Ctrl+C to stop.');
    process.on('SIGINT', async () => {
        await Promise.all(cameras.map((c) => c.stop()));
        process.exit(0);
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}
