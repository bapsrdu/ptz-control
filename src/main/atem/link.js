// The connection to the ATEM switcher. Read-only except for one thing: the
// lower-thirds key on/off (PLAN.md section 8). It never changes program,
// preview or transitions.
//
// Events: 'status' ({ state, message, model }), 'change' ()

import { EventEmitter } from 'node:events';
import { Atem, Enums } from 'atem-connection';

export const DEFAULT_ATEM_PORT = 9910;
const SLOW_CONNECT_MS = 5000;
const REBUILD_AFTER_MS = 20000;

function defaultCreate() {
    // Threaded mode forks a child process, which fails inside a packaged
    // Electron app. The ATEM sends little data, so one thread is plenty.
    return new Atem({ disableMultithreaded: true });
}

export class AtemLink extends EventEmitter {
    constructor({ createAtem = defaultCreate } = {}) {
        super();
        this.createAtem = createAtem;
        this.atem = null;
        this.host = '';
        this.port = DEFAULT_ATEM_PORT;
        this.session = 0;
        this.timers = new Set();
        this.status = { state: 'off', message: 'No ATEM set up.', model: null };
        this.changeTimer = null;
    }

    get connected() {
        return this.status.state === 'connected';
    }

    get state() {
        return this.connected ? this.atem?.state ?? null : null;
    }

    configure({ host, port = DEFAULT_ATEM_PORT }) {
        host = (host || '').trim();
        if (host === this.host && port === this.port && (this.atem || !host)) return;
        this.host = host;
        this.port = port;
        this.#teardown();
        if (!host) {
            this.#setStatus('off', 'No ATEM set up.');
            this.emit('change');
            return;
        }
        this.#connect();
    }

    #later(fn, ms) {
        const t = setTimeout(() => {
            this.timers.delete(t);
            fn();
        }, ms);
        t.unref?.();
        this.timers.add(t);
        return t;
    }

    #clearTimers() {
        for (const t of this.timers) clearTimeout(t);
        this.timers.clear();
    }

    #connect() {
        const session = ++this.session;
        const atem = this.createAtem();
        this.atem = atem;
        const mine = (fn) => (...args) => {
            if (session === this.session) fn(...args);
        };
        this.#setStatus('connecting', `Connecting to the ATEM at ${this.host}...`);
        const slow = this.#later(mine(() => {
            if (!this.connected) {
                this.#setStatus('connecting', `No answer from the ATEM at ${this.host}. Check the address, and that this computer is on the same network. Still trying.`);
            }
        }), SLOW_CONNECT_MS);

        atem.on('connected', mine(() => {
            clearTimeout(slow);
            this.#clearTimers();
            const model = atem.state?.info?.productIdentifier || 'ATEM';
            this.#setStatus('connected', '', model);
            this.emit('change');
        }));
        atem.on('disconnected', mine(() => {
            this.#setStatus('connecting', `Lost the connection to the ATEM at ${this.host}. Reconnecting...`);
            this.emit('change');
            // atem-connection retries by itself; start over if that does not work.
            this.#later(mine(() => {
                if (!this.connected) this.#rebuild();
            }), REBUILD_AFTER_MS);
        }));
        atem.on('error', () => {});
        atem.on('stateChanged', mine(() => {
            if (this.changeTimer) return;
            this.changeTimer = setTimeout(() => {
                this.changeTimer = null;
                this.emit('change');
            }, 30);
        }));
        Promise.resolve()
            .then(() => atem.connect(this.host, this.port))
            .catch(mine((err) => {
                this.#setStatus('error', `Could not connect to the ATEM: ${err?.message || err}`);
                this.#later(mine(() => this.#rebuild()), 5000);
            }));
    }

    #rebuild() {
        this.#teardown();
        if (this.host) this.#connect();
    }

    #teardown() {
        this.session += 1;
        this.#clearTimers();
        clearTimeout(this.changeTimer);
        this.changeTimer = null;
        const atem = this.atem;
        this.atem = null;
        if (atem) {
            atem.removeAllListeners();
            atem.on('error', () => {});
            Promise.resolve().then(() => atem.disconnect()).catch(() => {});
            atem.destroy?.().catch?.(() => {});
        }
    }

    #setStatus(state, message, model = this.status.model) {
        this.status = { state, message, model: state === 'off' ? null : model };
        this.emit('status', this.status);
    }

    // What the settings screen needs to offer choices.
    summary() {
        const state = this.state;
        if (!state) return null;
        const caps = state.info?.capabilities ?? {};
        const inputs = Object.values(state.inputs ?? {})
            .filter((i) => i && i.internalPortType === Enums.InternalPortType.External)
            .map((i) => ({ id: i.inputId, name: i.longName || `Input ${i.inputId}` }))
            .sort((a, b) => a.id - b.id);
        const meCount = caps.mixEffects ?? state.video.mixEffects.length;
        const auxCount = caps.auxilliaries ?? state.video.auxilliaries.length;
        return {
            model: state.info?.productIdentifier || 'ATEM',
            inputs,
            names: Object.fromEntries(Object.values(state.inputs ?? {}).filter(Boolean).map((i) => [i.inputId, i.longName])),
            meCount,
            outputs: Array.from({ length: auxCount }, (_, i) => ({
                index: i,
                name: state.inputs?.[8001 + i]?.longName || `Output ${i + 1}`,
            })),
            dskCount: caps.downstreamKeyers ?? state.video.downstreamKeyers.length,
            uskCounts: Array.from({ length: meCount }, (_, me) => state.info?.mixEffects?.[me]?.keyCount ?? 4),
        };
    }

    // The only thing this app changes on the ATEM.
    async setKeyer(keyer, on) {
        if (!this.connected) return { ok: false, message: 'The ATEM is not connected.' };
        try {
            if (keyer?.type === 'dsk') {
                await this.atem.setDownstreamKeyOnAir(Boolean(on), keyer.index);
            } else if (keyer?.type === 'usk') {
                await this.atem.setUpstreamKeyerOnAir(Boolean(on), keyer.me, keyer.index);
            } else {
                return { ok: false, message: 'Choose the lower-thirds key in the ATEM settings first.' };
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, message: `The ATEM did not accept that: ${err?.message || err}` };
        }
    }

    dispose() {
        this.host = '';
        this.#teardown();
    }
}
