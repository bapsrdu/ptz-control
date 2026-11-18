// Booth Video's setup, kept as plain JSON so a person can read and edit it:
// <user data>/config.json. Every field is optional when written by hand.
//
// - Edits to the file are picked up within a second.
// - Every setup that loads or saves cleanly is copied to config.last-good.json.
//   If config.json has a mistake when the app opens, it runs on that copy and
//   says so on the main screen.
// - Before saving over a file it could not read, the app keeps that file as
//   config.unreadable-<date>.json.
//
//     {
//       "atemHost": "192.168.1.240",
//       "me": 1,
//       "sources": [ { "input": 3, "label": "Cam 1" } ],
//       "cameras": [ { "name": "Left", "host": "192.168.1.91", "atemInput": 3 } ],
//       "keys": [ { "label": "Lower thirds", "me": 1, "keyer": 1 }, { "label": "Logo", "dsk": 1 } ],
//       "trackSpeed": 1, "ptzSpeed": 1, "trackTilt": true, "trackZoom": true,
//       "mixNames": [ "Live stream", "Side screens" ],
//       "screens": [ { "name": "Lobby TVs", "aux": [4, 5], "note": "Converters 4 and 5" } ],
//       "routes": [ { "label": "Lobby: stream", "set": [ { "aux": 4, "source": 10010 } ] } ]
//     }
//
// M/Es, keyers, DSKs and aux outputs are counted from 1 here, as on the switcher.

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const POLL_MS = 1000;
const int = (v, lo, hi, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
};
const num = (v, lo, hi, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const id = () => crypto.randomUUID();

export const SHOT_KINDS = ['position', 'exposure'];

function normShot(s) {
    if (!s || typeof s !== 'object') return null;
    const kind = SHOT_KINDS.includes(s.kind) ? s.kind : (s.exposure ? 'exposure' : 'position');
    const out = { id: str(s.id, 64) || id(), name: str(s.name, 40).trim() || 'Shot', kind };
    if (kind === 'position') {
        out.pan = int(s.pan, -32768, 32767, 0);
        out.tilt = int(s.tilt, -32768, 32767, 0);
        out.zoom = int(s.zoom, 0, 65535, 0);
    } else {
        const e = s.exposure && typeof s.exposure === 'object' ? s.exposure : {};
        out.exposure = {};
        for (const k of ['aeMode', 'wbMode']) if (typeof e[k] === 'string') out.exposure[k] = e[k];
        for (const k of ['iris', 'shutter', 'gain', 'bright', 'expComp', 'rGain', 'bGain']) {
            if (Number.isInteger(e[k])) out.exposure[k] = e[k];
        }
        for (const k of ['expCompOn', 'backlight']) if (typeof e[k] === 'boolean') out.exposure[k] = e[k];
    }
    return out;
}

function normCamera(c, i) {
    if (!c || typeof c !== 'object') return null;
    const presetNames = {};
    if (c.presetNames && typeof c.presetNames === 'object') {
        for (const [k, v] of Object.entries(c.presetNames)) {
            const n = int(k, 0, 254, null);
            if (n !== null && typeof v === 'string' && v.trim()) presetNames[n] = v.trim().slice(0, 40);
        }
    }
    return {
        id: str(c.id, 64) || id(),
        name: str(c.name, 40).trim() || `Cam ${i + 1}`,
        host: str(c.host, 120).trim(),
        port: int(c.port, 1, 65535, 1259),
        // VISCA transport, found by the app when it first reaches the camera.
        mode: ['udp-raw', 'udp-sony', 'tcp-raw'].includes(c.mode) ? c.mode : null,
        profile: str(c.profile, 40) || 'bzb-adamo',
        atemInput: int(c.atemInput, 1, 65535, null),
        previewUrl: str(c.previewUrl, 300).trim(),
        presetNames,
        shots: (Array.isArray(c.shots) ? c.shots : []).map(normShot).filter(Boolean).slice(0, 200),
    };
}

function normKey(k) {
    if (!k || typeof k !== 'object') return null;
    const label = str(k.label, 30).trim() || 'Key';
    const dsk = int(k.dsk, 1, 8, null);
    if (dsk) return { label, dsk };
    const keyer = int(k.keyer, 1, 8, null);
    if (!keyer) return null;
    return { label, me: int(k.me, 1, 8, 1), keyer };
}

function normScreen(s) {
    if (!s || typeof s !== 'object') return null;
    const aux = (Array.isArray(s.aux) ? s.aux : [s.aux]).map((a) => int(a, 1, 64, null)).filter(Boolean);
    if (!aux.length) return null;
    const out = { name: str(s.name, 40).trim() || `Aux ${aux.join(', ')}`, aux: [...new Set(aux)] };
    if (typeof s.note === 'string' && s.note.trim()) out.note = s.note.trim().slice(0, 120);
    if (typeof s.volunteer === 'boolean') out.volunteer = s.volunteer;
    if (typeof s.pinned === 'boolean') out.pinned = s.pinned;
    return out;
}

function normRoute(r) {
    if (!r || typeof r !== 'object') return null;
    const set = (Array.isArray(r.set) ? r.set : [])
        .map((c) => ({ aux: int(c?.aux, 1, 64, null), source: int(c?.source, 0, 65535, null) }))
        .filter((c) => c.aux && c.source !== null);
    return { label: str(r.label, 40).trim() || 'Routing', set };
}

export function normalize(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    const seenSource = new Set();
    return {
        atemHost: str(c.atemHost, 120).trim(),
        me: int(c.me, 1, 8, 1),
        sources: (Array.isArray(c.sources) ? c.sources : [])
            .map((s) => ({ input: int(s?.input, 0, 65535, null), label: str(s?.label, 30).trim() || undefined }))
            .filter((s) => s.input !== null && !seenSource.has(s.input) && seenSource.add(s.input))
            .map((s) => (s.label ? s : { input: s.input })),
        cameras: (Array.isArray(c.cameras) ? c.cameras : []).map(normCamera).filter(Boolean).slice(0, 32),
        keys: (Array.isArray(c.keys) ? c.keys : []).map(normKey).filter(Boolean).slice(0, 12),
        trackSpeed: num(c.trackSpeed, 0.5, 4, 1),
        ptzSpeed: num(c.ptzSpeed, 0.25, 2, 1),
        trackTilt: bool(c.trackTilt, true),
        trackZoom: bool(c.trackZoom, true),
        mixNames: (Array.isArray(c.mixNames) ? c.mixNames : []).slice(0, 8).map((n) => str(n, 30).trim()),
        screens: (Array.isArray(c.screens) ? c.screens : []).map(normScreen).filter(Boolean).slice(0, 64),
        routes: (Array.isArray(c.routes) ? c.routes : []).map(normRoute).filter(Boolean).slice(0, 40),
        cameraLoginUser: str(c.cameraLoginUser, 60).trim(),
    };
}

const EMPTY = JSON.stringify(normalize({}));

// Events: 'change' (config)
export class ConfigStore extends EventEmitter {
    constructor(dir) {
        super();
        this.dir = dir;
        this.file = path.join(dir, 'config.json');
        this.lastGoodFile = path.join(dir, 'config.last-good.json');
        this.config = normalize({});
        this.fileError = null; // why config.json could not be read, if it could not
        this.loadedAt = null;
        this.unreadable = false;
        this.lastText = null;
        this.timer = null;
    }

    get() {
        return this.config;
    }

    load() {
        fs.mkdirSync(this.dir, { recursive: true });
        const read = this.#read();
        if (read) {
            this.config = read;
        } else if (this.fileError) {
            // config.json has a mistake: run on the last setup that worked, and say so.
            try {
                this.config = normalize(JSON.parse(fs.readFileSync(this.lastGoodFile, 'utf8')));
            } catch {
                this.config = normalize({});
            }
        } else {
            this.#write();
        }
        this.timer = setInterval(() => this.#poll(), POLL_MS);
        this.timer.unref?.();
        return this.config;
    }

    // Change the setup from the app: fn(config) returns the new config.
    update(fn) {
        const next = normalize(fn(structuredClone(this.config)));
        if (JSON.stringify(next) === JSON.stringify(this.config)) return this.config;
        this.config = next;
        this.#write();
        this.emit('change', this.config);
        return this.config;
    }

    stop() {
        clearInterval(this.timer);
    }

    #poll() {
        let text;
        try {
            text = fs.readFileSync(this.file, 'utf8');
        } catch {
            return;
        }
        if (text === this.lastText) return;
        const read = this.#parse(text);
        if (read && JSON.stringify(read) !== JSON.stringify(this.config)) {
            this.config = read;
            this.emit('change', this.config);
        } else {
            this.emit('change', this.config); // fileError may have changed
        }
    }

    #read() {
        let text;
        try {
            text = fs.readFileSync(this.file, 'utf8');
        } catch {
            return null;
        }
        return this.#parse(text);
    }

    #parse(text) {
        this.lastText = text;
        try {
            const c = normalize(JSON.parse(text));
            this.fileError = null;
            this.unreadable = false;
            this.loadedAt = Date.now();
            this.#keepLastGood(c);
            return c;
        } catch (err) {
            this.fileError = `Not valid JSON: ${err.message}`;
            this.unreadable = true;
            return null;
        }
    }

    #write() {
        const text = `${JSON.stringify(this.config, null, 2)}\n`;
        try {
            if (this.unreadable && fs.existsSync(this.file)) {
                // The file on disk has a mistake and may hold work that is not in
                // the app. Keep it under another name before saving over it.
                const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
                fs.copyFileSync(this.file, path.join(this.dir, `config.unreadable-${stamp}.json`));
                this.unreadable = false;
            }
            const tmp = `${this.file}.tmp`;
            fs.writeFileSync(tmp, text);
            fs.renameSync(tmp, this.file);
            this.lastText = text;
            this.fileError = null;
            this.#keepLastGood(this.config);
        } catch (err) {
            this.fileError = `Could not save the setup: ${err.message}`;
        }
    }

    #keepLastGood(c) {
        // Never an empty setup: that would throw away the copy worth keeping.
        if (JSON.stringify(c) === EMPTY) return;
        const text = JSON.stringify(c, null, 2);
        try {
            if (fs.existsSync(this.lastGoodFile) && fs.readFileSync(this.lastGoodFile, 'utf8') === text) return;
            fs.writeFileSync(this.lastGoodFile, text);
        } catch {}
    }
}
