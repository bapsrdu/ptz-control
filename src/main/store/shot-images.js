// Pictures of saved shots, one JPEG file per shot in <userData>/shots/.
// The window shows them through the ptz-shot:// address (see main.js).

import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'data:image/jpeg;base64,';
const MAX_BYTES = 400 * 1024;
const SAFE_ID = /^[a-zA-Z0-9-]{1,80}$/;

export class ShotImages {
    constructor(dir) {
        this.dir = path.join(dir, 'shots');
    }

    file(presetId) {
        if (!SAFE_ID.test(presetId)) return null;
        return path.join(this.dir, `${presetId}.jpg`);
    }

    // Returns true if the picture was stored.
    save(presetId, dataUrl) {
        const file = this.file(presetId);
        if (!file || typeof dataUrl !== 'string' || !dataUrl.startsWith(PREFIX)) return false;
        const bytes = Buffer.from(dataUrl.slice(PREFIX.length), 'base64');
        // A JPEG starts FF D8.
        if (bytes.length < 100 || bytes.length > MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            fs.writeFileSync(file, bytes);
            return true;
        } catch (err) {
            console.error('Could not save shot picture', err);
            return false;
        }
    }

    remove(presetId) {
        const file = this.file(presetId);
        if (file) fs.rm(file, { force: true }, () => {});
    }
}
