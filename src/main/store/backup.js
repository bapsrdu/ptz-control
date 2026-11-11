// Export and import of everything a temple has set up, in one JSON file:
// cameras, ATEM settings, shots and the shot pictures. Used to back up a
// setup or copy it to another computer.

import fs from 'node:fs';
import { normalizeSettings } from './settings.js';

export const BACKUP_KIND = 'ptz-control-settings';

export function buildBackup({ settings, version, shotImages }) {
    const pictures = {};
    for (const camera of settings.cameras) {
        for (const p of camera.presets) {
            if (!p.thumb) continue;
            const file = shotImages.file(p.id);
            try {
                if (file && fs.existsSync(file)) pictures[p.id] = fs.readFileSync(file).toString('base64');
            } catch {}
        }
    }
    return { kind: BACKUP_KIND, appVersion: version, exportedAt: new Date().toISOString(), settings, pictures };
}

// Returns { ok, settings, pictures } or { ok: false, message }.
export function readBackup(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return { ok: false, message: 'This file is not a PTZ Control settings file (it could not be read).' };
    }
    if (data?.kind !== BACKUP_KIND || !data.settings) {
        return { ok: false, message: 'This file is not a PTZ Control settings file.' };
    }
    const settings = normalizeSettings(data.settings);
    const pictures = data.pictures && typeof data.pictures === 'object' ? data.pictures : {};
    return { ok: true, settings, pictures };
}

// Pure function for SettingsStore.apply: swap in imported settings.
export function replaceSettings(_current, next) {
    return { ok: true, settings: next };
}
