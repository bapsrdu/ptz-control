// The app was called "PTZ Control" before version 0.10. Electron keeps
// settings in a folder named after the app, so after the rename the settings
// would seem to vanish. On first start under the new name, copy them over
// from the old folder. The old folder is left alone, as a backup.

import fs from 'node:fs';
import path from 'node:path';

export const OLD_APP_FOLDER = 'PTZ Control';

// Returns true if settings were copied.
export function migrateOldSettings({ from, to }) {
    try {
        if (fs.existsSync(path.join(to, 'settings.json'))) return false;
        if (!fs.existsSync(path.join(from, 'settings.json'))) return false;
        fs.mkdirSync(to, { recursive: true });
        const shots = path.join(from, 'shots');
        if (fs.existsSync(shots)) fs.cpSync(shots, path.join(to, 'shots'), { recursive: true });
        // settings.json last, so a half-finished copy is tried again next start.
        fs.copyFileSync(path.join(from, 'settings.json'), path.join(to, 'settings.json'));
        return true;
    } catch (err) {
        console.error('Could not copy settings from the old app folder', err);
        return false;
    }
}
