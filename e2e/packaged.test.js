// Smoke test of an installed or packaged build, not the source folder.
//
//   PTZ_PACKAGED_APP=release/linux-unpacked/ptz-control xvfb-run -a node --test e2e/packaged.test.js
//
// Skipped when PTZ_PACKAGED_APP is not set.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { FakeCamera } from '../sim/fake-camera.js';
import { FakeRtspServer } from '../sim/fake-rtsp.js';

const executablePath = process.env.PTZ_PACKAGED_APP;

test('packaged app: cameras, video, movement and ATEM all work', { skip: !executablePath && 'PTZ_PACKAGED_APP not set' }, async (t) => {
    const cam = await new FakeCamera({ mode: 'udp-raw' }).start();
    const rtsp = await new FakeRtspServer().start();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-packaged-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        cameras: [{ name: 'Left', host: '127.0.0.1', port: cam.port, previewUrl: rtsp.url, atemInput: 3 }],
        atem: { host: '192.0.2.10', watched: [{ type: 'me', index: 0 }] },
    }));
    const app = await electron.launch({
        executablePath,
        args: ['--no-sandbox'],
        env: { ...process.env, PTZ_USER_DATA: dir, PTZ_FAKE_ATEM: '1' },
    });
    t.after(async () => { await app.close(); await cam.stop(); await rtsp.stop(); });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    // Version from the packaged package.json.
    assert.match(await app.evaluate(({ app: a }) => a.getVersion()), /^\d+\.\d+\.\d+$/);

    // The camera was found without a stored transport, and is connected.
    await page.locator('[data-testid=camera-tile][data-state=online]').waitFor({ timeout: 15000 });
    // ATEM library loads from inside the package.
    await page.getByText('Fake ATEM 2 M/E').waitFor();
    // Video decodes.
    await page.waitForFunction(() => {
        const c = document.querySelector('[data-testid=selected-view] [data-testid=video-canvas]');
        if (!c || !c.width) return false;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4 * 97) sum += d[i] + d[i + 1] + d[i + 2];
        return sum / (d.length / (4 * 97)) / 3 > 30;
    }, null, { timeout: 15000 });

    // Movement reaches the camera and stops.
    cam.clearLog();
    const pad = await page.getByTestId('joystick').boundingBox();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + 5, { steps: 3 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    const start = Date.now();
    while (!cam.received.includes('81 01 06 01 01 01 03 03 FF') && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 50));
    assert.ok(cam.received.some((h) => h.startsWith('81 01 06 01') && h.endsWith('03 01 FF')), cam.received.join(' | '));
    const lastDrive = cam.received.findLastIndex((h) => h.startsWith('81 01 06 01') && !h.endsWith('03 03 FF'));
    assert.ok(cam.received.lastIndexOf('81 01 06 01 01 01 03 03 FF') > lastDrive, 'Stop must come after the last move');
});
