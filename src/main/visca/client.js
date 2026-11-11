// A VISCA client for one camera: opens the transport, sends one message at a
// time, matches replies, times out, keeps the link alive and reconnects.
//
// Status (client.status.state):
//   connecting      opening the connection, or waiting for the first reply
//   online          the camera answered recently
//   not-responding  the connection is open but the last few messages got no reply
//   offline         TCP connection lost or refused; reconnecting in the background
//   stopped         stop() was called

import { EventEmitter } from 'node:events';
import { Transport } from './transport.js';
import { parseReply, powerInquiry, isInquiry, toHex } from './commands.js';

const MISSES_BEFORE_NOT_RESPONDING = 2;

export class ViscaClient extends EventEmitter {
    constructor({
        host,
        port,
        mode,
        address = 1,
        commandTimeoutMs = 1000,
        heartbeatMs = 5000,
        reconnectMinMs = 1000,
        reconnectMaxMs = 10000,
    }) {
        super();
        this.host = host;
        this.port = port;
        this.mode = mode;
        this.address = address;
        this.commandTimeoutMs = commandTimeoutMs;
        this.heartbeatMs = heartbeatMs;
        this.reconnectMinMs = reconnectMinMs;
        this.reconnectMaxMs = reconnectMaxMs;

        this.transport = null;
        this.queue = [];
        this.inFlight = null;
        // VISCA sockets (1 or 2) of commands the camera acknowledged but has not
        // finished. Their later "done" replies must not be taken as the answer
        // to whatever is in flight then.
        this.openSockets = new Set();
        this.misses = 0;
        this.reconnectDelay = reconnectMinMs;
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.stopped = true;
        this.status = { state: 'stopped', message: '' };
    }

    start() {
        if (!this.stopped) return;
        this.stopped = false;
        this.#connect();
        this.heartbeatTimer = setInterval(() => this.#heartbeat(), this.heartbeatMs);
        this.heartbeatTimer.unref?.();
    }

    stop() {
        this.stopped = true;
        clearInterval(this.heartbeatTimer);
        clearTimeout(this.reconnectTimer);
        this.heartbeatTimer = null;
        this.reconnectTimer = null;
        this.#failAll(stoppedError());
        this.transport?.close();
        this.transport = null;
        this.#setStatus('stopped', '');
    }

    // Sends a command. Resolves when the camera accepts or completes it.
    //   key:    messages with the same key replace each other while waiting to
    //           be sent, so only the newest joystick position goes out.
    //   urgent: put at the front of the queue (used for every Stop).
    command(payload, { key, urgent = false } = {}) {
        return this.#enqueue({ payload, kind: 'command', key, urgent });
    }

    // Sends an inquiry. Resolves with the data bytes of the answer.
    inquiry(payload) {
        if (!isInquiry(payload)) return Promise.reject(new Error('Not an inquiry message'));
        return this.#enqueue({ payload, kind: 'inquiry' });
    }

    #enqueue(item) {
        if (this.stopped) return Promise.reject(stoppedError());
        if (!this.transport?.isOpen) return Promise.reject(notConnectedError(this));
        return new Promise((resolve, reject) => {
            item.resolve = resolve;
            item.reject = reject;
            if (item.key) {
                const index = this.queue.findIndex((q) => q.key === item.key);
                if (index !== -1) {
                    const old = this.queue[index];
                    old.resolve({ replaced: true });
                    if (item.urgent) {
                        this.queue.splice(index, 1);
                        this.queue.unshift(item);
                    } else {
                        this.queue[index] = item;
                    }
                    this.#pump();
                    return;
                }
            }
            if (item.urgent) this.queue.unshift(item);
            else this.queue.push(item);
            this.#pump();
        });
    }

    async #connect() {
        if (this.stopped) return;
        this.#setStatus('connecting', '');
        const transport = new Transport({ host: this.host, port: this.port, mode: this.mode });
        this.transport = transport;
        transport.on('message', (payload) => this.#onMessage(payload));
        transport.on('error', (err) => this.#onTransportError(err));
        transport.on('close', () => this.#onClose(transport));
        try {
            await transport.open();
        } catch (err) {
            if (this.transport !== transport) return;
            this.transport = null;
            this.#setStatus('offline', describeNetworkError(err, this));
            this.#scheduleReconnect();
            return;
        }
        if (this.stopped || this.transport !== transport) {
            transport.close();
            return;
        }
        this.reconnectDelay = this.reconnectMinMs;
        this.misses = 0;
        this.openSockets.clear();
        this.#heartbeat();
    }

    #scheduleReconnect() {
        if (this.stopped || this.reconnectTimer) return;
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(this.reconnectMaxMs, this.reconnectDelay * 2);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.#connect();
        }, delay);
        this.reconnectTimer.unref?.();
    }

    #onClose(transport) {
        if (this.transport !== transport) return;
        this.transport = null;
        this.#failAll(notConnectedError(this));
        if (this.stopped) return;
        this.#setStatus('offline', 'Connection to the camera was lost. Reconnecting.');
        this.#scheduleReconnect();
    }

    #onTransportError(err) {
        // On UDP the OS reports "port unreachable" as ECONNREFUSED on the next
        // send. Treat it as a missed reply; the timeout will follow.
        this.emit('transport-error', err);
    }

    #heartbeat() {
        if (this.stopped || !this.transport?.isOpen) return;
        if (this.inFlight || this.queue.length) return;
        this.inquiry(powerInquiry(this.address)).catch(() => {});
    }

    #pump() {
        if (this.inFlight || !this.queue.length) return;
        if (!this.transport?.isOpen) {
            this.#failAll(notConnectedError(this));
            return;
        }
        const item = this.queue.shift();
        const timer = setTimeout(() => this.#onTimeout(item), this.commandTimeoutMs);
        this.inFlight = { item, timer };
        this.emit('sent', item.payload);
        this.transport.send(item.payload).catch((err) => {
            if (this.inFlight?.item !== item) return;
            this.#settle(item, err);
        });
    }

    #onTimeout(item) {
        if (this.inFlight?.item !== item) return;
        this.misses += 1;
        if (this.misses >= MISSES_BEFORE_NOT_RESPONDING && this.transport?.isOpen) {
            this.#setStatus(
                'not-responding',
                `The camera at ${this.host}:${this.port} is not answering.`,
            );
        }
        const err = new Error(`No reply from camera within ${this.commandTimeoutMs} ms (${toHex(item.payload)})`);
        err.code = 'ETIMEDOUT';
        this.#settle(item, err);
    }

    #onMessage(payload) {
        const reply = parseReply(payload);
        if (reply.type === 'invalid') return;
        this.misses = 0;
        if (this.status.state !== 'online') this.#setStatus('online', '');
        this.emit('reply', payload);

        // Replies carry the socket number in the low nibble of byte 1.
        const socket = payload[1] & 0x0f;
        if (reply.type === 'ack') this.openSockets.add(socket);
        else if (socket !== 0 && this.openSockets.has(socket)) {
            // The end of a command that was already acknowledged earlier.
            this.openSockets.delete(socket);
            return;
        }

        const current = this.inFlight?.item;
        if (!current) return;
        if (current.kind === 'inquiry') {
            // A bare completion (no data) belongs to an earlier command, not to this inquiry.
            if (reply.type === 'completion' && reply.data.length > 0) this.#settle(current, null, reply.data);
            else if (reply.type === 'error') this.#settle(current, replyError(reply));
            return;
        }
        if (reply.type === 'ack' || reply.type === 'completion') this.#settle(current, null, { ok: true });
        else if (reply.type === 'error') this.#settle(current, replyError(reply));
    }

    #settle(item, err, value) {
        if (this.inFlight?.item === item) {
            clearTimeout(this.inFlight.timer);
            this.inFlight = null;
        }
        if (err) item.reject(err);
        else item.resolve(value);
        this.#pump();
    }

    #failAll(err) {
        if (this.inFlight) {
            clearTimeout(this.inFlight.timer);
            this.inFlight.item.reject(err);
            this.inFlight = null;
        }
        const pending = this.queue;
        this.queue = [];
        for (const item of pending) item.reject(err);
    }

    #setStatus(state, message) {
        if (this.status.state === state && this.status.message === message) return;
        this.status = { state, message };
        this.emit('status', this.status);
    }
}

function replyError(reply) {
    const err = new Error(`Camera replied: ${reply.message}`);
    err.code = 'EVISCA';
    err.viscaCode = reply.code;
    return err;
}

function stoppedError() {
    const err = new Error('Camera connection was closed');
    err.code = 'ESTOPPED';
    return err;
}

function notConnectedError(client) {
    const err = new Error(`Not connected to the camera at ${client.host}:${client.port}`);
    err.code = 'ENOTCONN';
    return err;
}

export function describeNetworkError(err, { host, port }) {
    switch (err?.code) {
        case 'ECONNREFUSED':
            return `The camera at ${host} refused the connection on port ${port}. Check the port number.`;
        case 'EHOSTUNREACH':
        case 'ENETUNREACH':
            return `This computer cannot reach ${host}. Check the address and that this computer is on the camera's network.`;
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
            return `"${host}" is not a known address. Check for typing mistakes.`;
        case 'ETIMEDOUT':
            return `No answer from ${host}:${port}. Check the address and that the camera is switched on.`;
        default:
            return err?.message || 'Could not connect to the camera.';
    }
}
