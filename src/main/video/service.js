// Keeps one video stream per camera running, and retries when one drops.
//
// Events:
//   'frame'  (cameraId, { data, key, codec })
//   'status' (cameraId, { state: 'connecting' | 'playing' | 'error' | 'off', message })

import { EventEmitter } from 'node:events';
import { RtspClient } from './rtsp-client.js';

export class VideoService extends EventEmitter {
    constructor({ retryMinMs = 2000, retryMaxMs = 15000, createClient = (url) => new RtspClient(url) } = {}) {
        super();
        this.retryMinMs = retryMinMs;
        this.retryMaxMs = retryMaxMs;
        this.createClient = createClient;
        this.entries = new Map(); // cameraId -> entry
    }

    // cameras: [{ id, url }]. url null means no video for that camera.
    sync(cameras) {
        const wanted = new Map(cameras.map((c) => [c.id, c.url]));
        for (const [id, entry] of this.entries) {
            if (wanted.get(id) !== entry.url) {
                this.#dispose(entry);
                this.entries.delete(id);
            }
        }
        for (const [id, url] of wanted) {
            if (this.entries.has(id)) continue;
            const entry = { id, url, client: null, retryTimer: null, delay: this.retryMinMs, disposed: false, status: null };
            this.entries.set(id, entry);
            if (url) this.#start(entry);
            else this.#setStatus(entry, { state: 'off', message: 'No video address for this camera.' });
        }
    }

    statuses() {
        const out = {};
        for (const [id, entry] of this.entries) if (entry.status) out[id] = { ...entry.status };
        return out;
    }

    stopAll() {
        for (const entry of this.entries.values()) this.#dispose(entry);
        this.entries.clear();
    }

    #start(entry) {
        if (entry.disposed) return;
        let client;
        try {
            client = this.createClient(entry.url);
        } catch (err) {
            this.#setStatus(entry, { state: 'error', message: err.message });
            return;
        }
        entry.client = client;
        if (entry.status?.state !== 'error') this.#setStatus(entry, { state: 'connecting', message: 'Starting video...' });
        client.on('playing', () => {
            entry.delay = this.retryMinMs;
            this.#setStatus(entry, { state: 'playing', message: '' });
        });
        client.on('frame', (frame) => this.emit('frame', entry.id, frame));
        client.on('error', (err) => {
            if (entry.client !== client) return;
            entry.client = null;
            this.#setStatus(entry, { state: 'error', message: err.userMessage || err.message });
            this.#retry(entry);
        });
        client.start();
    }

    #retry(entry) {
        if (entry.disposed || entry.retryTimer) return;
        const delay = entry.delay;
        entry.delay = Math.min(this.retryMaxMs, entry.delay * 2);
        entry.retryTimer = setTimeout(() => {
            entry.retryTimer = null;
            this.#start(entry);
        }, delay);
        entry.retryTimer.unref?.();
    }

    #dispose(entry) {
        entry.disposed = true;
        clearTimeout(entry.retryTimer);
        const client = entry.client;
        entry.client = null;
        client?.removeAllListeners();
        client?.on('error', () => {});
        client?.stop();
    }

    #setStatus(entry, status) {
        entry.status = status;
        this.emit('status', entry.id, status);
    }
}
