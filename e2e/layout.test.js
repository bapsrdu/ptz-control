// The shot pad must fit any number of cameras without moving anything else
// on the screen, and the joystick panel must have no empty space.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.PTZ_SCREENSHOTS;
const NAMES = ['Left', 'Centre', 'Right', 'Mandir', 'Balcony', 'Stage', 'Choir', 'Wide', 'Back', 'Side'];
const SHOT_NAMES = ['Pulpit', 'Wide stage', 'Speaker close', 'Choir', 'Musicians', 'Audience', 'Murti darshan', 'Full hall'];

async function measure(count, size) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-layout-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        cameras: Array.from({ length: count }, (_, i) => ({
            name: NAMES[i],
            // Nothing listens here: layout does not depend on cameras answering.
            host: '127.0.0.1',
            port: 9 + i,
            mode: 'udp-raw',
            previewUrl: 'rtsp://127.0.0.1:9/none',
            presets: SHOT_NAMES.slice(0, i === 0 ? 8 : 3).map((name, n) => ({ name, number: n + 1 })),
        })),
    }));
    const app = await electron.launch({ args: [root, '--no-sandbox'], env: { ...process.env, PTZ_USER_DATA: dir } });
    try {
        const page = await app.firstWindow();
        await page.setViewportSize(size);
        await page.getByTestId('shots-row').first().waitFor();
        // Let cameras settle into their "not found" state before measuring.
        await page.waitForTimeout(1500);
        if (shots) await page.screenshot({ path: path.join(shots, `16-shot-pad-${count}-${size.width}.png`) });
        return await page.evaluate(() => {
            const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
            const frame = document.querySelector('[data-testid=frame-panel]');
            const cols = document.querySelector('[data-testid=shot-columns]');
            const columnWidths = [...document.querySelectorAll('[data-testid=shots-row]')].map((c) => Math.round(c.getBoundingClientRect().width));
            // Gap at the bottom of the joystick panel: panel bottom minus its lowest content.
            const contentBottom = Math.max(...[...frame.querySelectorAll('*')].map((el) => el.getBoundingClientRect().bottom));
            return {
                selectedView: box(document.querySelector('[data-testid=selected-view]')),
                frame: box(frame),
                frameGap: Math.round(frame.getBoundingClientRect().bottom - contentBottom),
                padScrollsSideways: cols.scrollWidth > cols.clientWidth + 1,
                narrowestColumn: Math.min(...columnWidths),
                pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1,
            };
        });
    } finally {
        await app.close();
    }
}

for (const size of [{ width: 1280, height: 900 }, { width: 1920, height: 1080 }]) {
    test(`shot pad at ${size.width}x${size.height}: 1, 3 and 10 cameras leave the rest of the screen unchanged`, async () => {
        const one = await measure(1, size);
        const three = await measure(3, size);
        const ten = await measure(10, size);

        for (const m of [three, ten]) {
            assert.deepEqual(m.selectedView, one.selectedView, 'the video views do not move or resize');
            assert.deepEqual(m.frame, one.frame, 'the joystick panel does not move or resize');
        }
        for (const m of [one, three, ten]) {
            assert.equal(m.pageScrollsSideways, false, 'the page never scrolls sideways');
            assert.ok(m.frameGap <= 20, `no empty space under the joystick controls (gap ${m.frameGap}px)`);
            assert.ok(m.narrowestColumn >= 150, `columns stay readable (${m.narrowestColumn}px)`);
        }
        assert.equal(three.padScrollsSideways, false, 'three cameras fit without scrolling');
        assert.equal(ten.padScrollsSideways, true, 'ten cameras scroll inside the pad');
    });
}
