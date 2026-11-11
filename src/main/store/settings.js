// Settings: the camera list, saved shots (presets) and screen preferences.
//
// The functions at the top are pure: they take settings and return new
// settings, so they are easy to test. SettingsStore at the bottom loads and
// saves them as JSON in Electron's userData folder.
//
// Nothing about any one temple is written here. Every camera comes from the
// user (PLAN.md section 8).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { PROFILES, DEFAULT_PROFILE_ID, getProfile } from '../profiles/index.js';
import { MODES } from '../visca/transport.js';
import { clampSpeed, SPEED_DEFAULT } from '../cameras/motion.js';

export const SETTINGS_VERSION = 1;
export const NAME_MAX = 40;
export const PRESET_NAME_MAX = 30;
// Preset 0 is the camera's power-on position, so saved shots start at 1.
export const SHOT_PRESET_FIRST = 1;
export const SHOT_PRESET_LAST = 254;

export function defaultSettings() {
    return {
        version: SETTINGS_VERSION,
        cameras: [],
        ui: { speed: SPEED_DEFAULT, selectedCameraId: null },
    };
}

function newId() {
    return crypto.randomUUID();
}

function cleanText(value, max) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const HOSTNAME = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function isValidHost(host) {
    if (net.isIP(host)) return true;
    // Something like "192.168.1" is a typo, not a hostname.
    if (/^[\d.]+$/.test(host)) return false;
    return HOSTNAME.test(host);
}

// Checks what the user typed in the camera form.
// Returns { ok, errors: {field: message}, value: cleaned fields }.
export function validateCameraInput(input = {}, { cameras = [], editingId = null } = {}) {
    const errors = {};
    const profileId = PROFILES[input.profile] ? input.profile : DEFAULT_PROFILE_ID;
    const profile = getProfile(profileId);

    const name = cleanText(input.name, NAME_MAX);
    if (!name) errors.name = 'Give the camera a name, for example "Left".';
    else if (cameras.some((c) => c.id !== editingId && c.name.toLowerCase() === name.toLowerCase())) {
        errors.name = 'Another camera already has this name.';
    }

    const host = cleanText(input.host, 253);
    if (!host) errors.host = 'Enter the camera\'s IP address, for example 192.168.1.50.';
    else if (!isValidHost(host)) errors.host = 'This does not look like an IP address.';

    const portText = String(input.port ?? '').trim();
    const port = portText === '' ? profile.defaultPort : Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        errors.port = 'The port must be a whole number from 1 to 65535.';
    }

    if (!errors.host && !errors.port) {
        const clash = cameras.find((c) => c.id !== editingId && c.host === host && c.port === port);
        if (clash) errors.host = `"${clash.name}" already uses this address and port.`;
    }

    const mode = MODES.includes(input.mode) ? input.mode : null;

    return {
        ok: Object.keys(errors).length === 0,
        errors,
        value: { name, host, port, profile: profileId, mode },
    };
}

function normalizePreset(raw, used) {
    const number = Number(raw?.number);
    if (!Number.isInteger(number) || number < SHOT_PRESET_FIRST || number > SHOT_PRESET_LAST) return null;
    if (used.has(number)) return null;
    used.add(number);
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
        name: cleanText(raw.name, PRESET_NAME_MAX) || `Shot ${number}`,
        number,
    };
}

function normalizeCamera(raw, seen) {
    if (!raw || typeof raw !== 'object') return null;
    const check = validateCameraInput(raw, { cameras: seen });
    if (!check.ok) return null;
    const used = new Set();
    const presets = Array.isArray(raw.presets)
        ? raw.presets.map((p) => normalizePreset(p, used)).filter(Boolean)
        : [];
    return {
        id: typeof raw.id === 'string' && raw.id && !seen.some((c) => c.id === raw.id) ? raw.id : newId(),
        ...check.value,
        presets,
    };
}

// Makes any loaded or imported settings safe to use. Bad entries are dropped
// rather than stopping the app from starting.
export function normalizeSettings(raw) {
    const out = defaultSettings();
    if (!raw || typeof raw !== 'object') return out;
    if (Array.isArray(raw.cameras)) {
        for (const c of raw.cameras) {
            const camera = normalizeCamera(c, out.cameras);
            if (camera) out.cameras.push(camera);
        }
    }
    const ui = raw.ui && typeof raw.ui === 'object' ? raw.ui : {};
    out.ui.speed = clampSpeed(ui.speed ?? SPEED_DEFAULT);
    out.ui.selectedCameraId = out.cameras.some((c) => c.id === ui.selectedCameraId)
        ? ui.selectedCameraId
        : out.cameras[0]?.id ?? null;
    return out;
}

// --- Camera list ------------------------------------------------------------

function result(settings, extra = {}) {
    return { ok: true, settings, ...extra };
}

function failure(errors) {
    return { ok: false, errors };
}

export function addCamera(settings, input) {
    const check = validateCameraInput(input, { cameras: settings.cameras });
    if (!check.ok) return failure(check.errors);
    const camera = { id: newId(), ...check.value, presets: [] };
    const next = {
        ...settings,
        cameras: [...settings.cameras, camera],
        ui: { ...settings.ui, selectedCameraId: settings.ui.selectedCameraId ?? camera.id },
    };
    return result(next, { camera });
}

export function updateCamera(settings, id, input) {
    const existing = settings.cameras.find((c) => c.id === id);
    if (!existing) return failure({ form: 'This camera no longer exists.' });
    const check = validateCameraInput({ ...existing, ...input }, { cameras: settings.cameras, editingId: id });
    if (!check.ok) return failure(check.errors);
    const value = { ...check.value };
    // A new address, port or model means the old transport may be wrong.
    const moved = value.host !== existing.host || value.port !== existing.port || value.profile !== existing.profile;
    if (moved && !MODES.includes(input.mode)) value.mode = null;
    const camera = { ...existing, ...value };
    return result({ ...settings, cameras: settings.cameras.map((c) => (c.id === id ? camera : c)) }, { camera });
}

export function setCameraMode(settings, id, mode) {
    if (!MODES.includes(mode)) return failure({ form: 'Unknown transport.' });
    if (!settings.cameras.some((c) => c.id === id)) return failure({ form: 'This camera no longer exists.' });
    return result({
        ...settings,
        cameras: settings.cameras.map((c) => (c.id === id ? { ...c, mode } : c)),
    });
}

export function removeCamera(settings, id) {
    if (!settings.cameras.some((c) => c.id === id)) return failure({ form: 'This camera no longer exists.' });
    const cameras = settings.cameras.filter((c) => c.id !== id);
    const selected = settings.ui.selectedCameraId === id ? cameras[0]?.id ?? null : settings.ui.selectedCameraId;
    return result({ ...settings, cameras, ui: { ...settings.ui, selectedCameraId: selected } });
}

// delta -1 moves the camera one place earlier in the list, +1 one place later.
export function moveCamera(settings, id, delta) {
    const from = settings.cameras.findIndex((c) => c.id === id);
    if (from === -1) return failure({ form: 'This camera no longer exists.' });
    const to = Math.min(settings.cameras.length - 1, Math.max(0, from + Math.sign(delta)));
    if (to === from) return result(settings);
    const cameras = [...settings.cameras];
    const [camera] = cameras.splice(from, 1);
    cameras.splice(to, 0, camera);
    return result({ ...settings, cameras });
}

// --- Shots (presets) --------------------------------------------------------

export function nextPresetNumber(camera) {
    const used = new Set(camera.presets.map((p) => p.number));
    for (let n = SHOT_PRESET_FIRST; n <= SHOT_PRESET_LAST; n += 1) {
        if (!used.has(n)) return n;
    }
    return null;
}

function withCamera(settings, cameraId, fn) {
    const camera = settings.cameras.find((c) => c.id === cameraId);
    if (!camera) return failure({ form: 'This camera no longer exists.' });
    const out = fn(camera);
    if (!out.ok) return out;
    return result(
        { ...settings, cameras: settings.cameras.map((c) => (c.id === cameraId ? out.camera : c)) },
        out.extra,
    );
}

export function addPreset(settings, cameraId, { name, number }) {
    return withCamera(settings, cameraId, (camera) => {
        if (camera.presets.some((p) => p.number === number)) return failure({ form: 'That preset number is taken.' });
        if (!Number.isInteger(number) || number < SHOT_PRESET_FIRST || number > SHOT_PRESET_LAST) {
            return failure({ form: 'No free preset numbers left on this camera.' });
        }
        const preset = { id: newId(), name: cleanText(name, PRESET_NAME_MAX) || `Shot ${number}`, number };
        return { ok: true, camera: { ...camera, presets: [...camera.presets, preset] }, extra: { preset } };
    });
}

export function renamePreset(settings, cameraId, presetId, name) {
    const clean = cleanText(name, PRESET_NAME_MAX);
    if (!clean) return failure({ name: 'The shot needs a name.' });
    return withCamera(settings, cameraId, (camera) => {
        if (!camera.presets.some((p) => p.id === presetId)) return failure({ form: 'This shot no longer exists.' });
        return {
            ok: true,
            camera: { ...camera, presets: camera.presets.map((p) => (p.id === presetId ? { ...p, name: clean } : p)) },
        };
    });
}

export function removePreset(settings, cameraId, presetId) {
    return withCamera(settings, cameraId, (camera) => {
        if (!camera.presets.some((p) => p.id === presetId)) return failure({ form: 'This shot no longer exists.' });
        return { ok: true, camera: { ...camera, presets: camera.presets.filter((p) => p.id !== presetId) } };
    });
}

export function setUi(settings, patch = {}) {
    const ui = { ...settings.ui };
    if ('speed' in patch) ui.speed = clampSpeed(patch.speed);
    if ('selectedCameraId' in patch && settings.cameras.some((c) => c.id === patch.selectedCameraId)) {
        ui.selectedCameraId = patch.selectedCameraId;
    }
    return result({ ...settings, ui });
}

// --- File storage -----------------------------------------------------------

// Events: 'change' (settings)
export class SettingsStore extends EventEmitter {
    constructor(dir) {
        super();
        this.file = path.join(dir, 'settings.json');
        this.settings = defaultSettings();
    }

    load() {
        try {
            if (fs.existsSync(this.file)) {
                this.settings = normalizeSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')));
            }
        } catch (err) {
            // Keep the broken file so nothing is lost, and start empty.
            const backup = `${this.file}.broken-${Date.now()}`;
            try { fs.copyFileSync(this.file, backup); } catch {}
            console.error(`Could not read ${this.file}; saved a copy as ${backup}.`, err);
            this.settings = defaultSettings();
        }
        return this.settings;
    }

    get() {
        return this.settings;
    }

    // Applies one of the pure functions above and saves if it succeeded.
    apply(fn, ...args) {
        const out = fn(this.settings, ...args);
        if (!out.ok) return out;
        this.settings = out.settings;
        this.#save();
        this.emit('change', this.settings);
        return out;
    }

    #save() {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        // Write to a temporary file and rename, so a crash mid-write cannot
        // leave a half-written settings file.
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
        fs.renameSync(tmp, this.file);
    }
}
