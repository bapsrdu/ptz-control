// One network connection to one camera, in one of four modes:
//
//   udp-sony  UDP, Sony 8-byte header       (Sony's own VISCA over IP)
//   udp-raw   UDP, plain VISCA bytes
//   tcp-raw   TCP, plain VISCA bytes
//   tcp-sony  TCP, Sony 8-byte header
//
// A Transport only moves bytes. Waiting for replies, queueing and reconnecting
// are the client's job (client.js).

import dgram from 'node:dgram';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { createDecoder, encodeSony, PAYLOAD } from './framing.js';
import { isInquiry } from './commands.js';

export const MODES = Object.freeze(['udp-sony', 'udp-raw', 'tcp-raw', 'tcp-sony']);

export function parseMode(mode) {
    if (!MODES.includes(mode)) throw new Error(`Unknown VISCA transport mode "${mode}"`);
    const [protocol, framing] = mode.split('-');
    return { protocol, framing };
}

export const MODE_LABELS = Object.freeze({
    'udp-sony': 'UDP with Sony header',
    'udp-raw': 'UDP, plain VISCA',
    'tcp-raw': 'TCP, plain VISCA',
    'tcp-sony': 'TCP with Sony header',
});

// Events: 'message' (Buffer payload), 'close' (Error|undefined), 'error' (Error)
export class Transport extends EventEmitter {
    constructor({ host, port, mode, connectTimeoutMs = 2000 }) {
        super();
        const { protocol, framing } = parseMode(mode);
        this.host = host;
        this.port = port;
        this.mode = mode;
        this.protocol = protocol;
        this.framing = framing;
        this.connectTimeoutMs = connectTimeoutMs;
        this.seq = 0;
        this.socket = null;
        this.isOpen = false;
        this.decoder = createDecoder(framing);
    }

    open() {
        if (this.isOpen) return Promise.resolve();
        return this.protocol === 'udp' ? this.#openUdp() : this.#openTcp();
    }

    #openUdp() {
        return new Promise((resolve, reject) => {
            const socket = dgram.createSocket('udp4');
            this.socket = socket;
            const fail = (err) => {
                socket.removeAllListeners();
                try { socket.close(); } catch {}
                this.socket = null;
                reject(err);
            };
            socket.once('error', fail);
            // connect() makes the OS drop datagrams from anyone but the camera,
            // and lets the OS report "port unreachable" back to us.
            socket.connect(this.port, this.host, () => {
                socket.removeListener('error', fail);
                socket.on('error', (err) => this.emit('error', err));
                socket.on('message', (datagram) => {
                    // Each datagram stands alone, so decode with a fresh decoder.
                    for (const m of createDecoder(this.framing).push(datagram)) {
                        this.emit('message', m.payload);
                    }
                });
                socket.on('close', () => this.#closed());
                this.isOpen = true;
                resolve();
            });
        });
    }

    #openTcp() {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ host: this.host, port: this.port });
            this.socket = socket;
            socket.setNoDelay(true);
            const timer = setTimeout(() => {
                const err = new Error(`No answer from ${this.host}:${this.port} within ${this.connectTimeoutMs} ms`);
                err.code = 'ETIMEDOUT';
                socket.destroy(err);
            }, this.connectTimeoutMs);
            const fail = (err) => {
                clearTimeout(timer);
                socket.removeAllListeners();
                socket.destroy();
                this.socket = null;
                reject(err);
            };
            socket.once('error', fail);
            socket.once('connect', () => {
                clearTimeout(timer);
                socket.removeListener('error', fail);
                socket.setKeepAlive(true, 5000);
                socket.on('error', (err) => this.emit('error', err));
                socket.on('data', (chunk) => {
                    for (const m of this.decoder.push(chunk)) this.emit('message', m.payload);
                });
                socket.on('close', () => this.#closed());
                this.isOpen = true;
                resolve();
            });
        });
    }

    #closed() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.socket = null;
        this.emit('close');
    }

    frame(payload) {
        if (this.framing === 'raw') return payload;
        this.seq = (this.seq + 1) >>> 0;
        const type = isInquiry(payload) ? PAYLOAD.INQUIRY : PAYLOAD.COMMAND;
        return encodeSony(payload, { type, seq: this.seq });
    }

    send(payload) {
        if (!this.isOpen || !this.socket) return Promise.reject(notConnected());
        const data = this.frame(payload);
        return new Promise((resolve, reject) => {
            const done = (err) => (err ? reject(err) : resolve());
            if (this.protocol === 'udp') this.socket.send(data, done);
            else this.socket.write(data, done);
        });
    }

    close() {
        const socket = this.socket;
        this.isOpen = false;
        this.socket = null;
        if (!socket) return;
        socket.removeAllListeners();
        socket.on('error', () => {});
        if (this.protocol === 'udp') {
            try { socket.close(); } catch {}
        } else {
            socket.destroy();
        }
    }
}

function notConnected() {
    const err = new Error('Camera not connected');
    err.code = 'ENOTCONN';
    return err;
}
