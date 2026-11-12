// App-side tracking (phase 7): the window runs the person detector on the
// camera's video, and the app steers the camera. Runs the real detector on
// software WebGL, and checks the steering with made-up body positions (the
// test video has no person in it).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { FakeCamera } from '../sim/fake-camera.js';
import { FakeRtspServer } from '../sim/fake-rtsp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.PTZ_SCREENSHOTS;

async function until(check, what, timeoutMs = 10000) {
    const start = Date.now();
    for (;;) {
        if (await check()) return;
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${typeof what === 'function' ? what() : what}`);
        await new Promise((r) => setTimeout(r, 50));
    }
}

// A standing person whose body centre is at x, seen full length.
function personAt(x) {
    const p = (px, py) => ({ x: px, y: py, visibility: 0.99 });
    return {
        nose: p(x, 0.15),
        leftShoulder: p(x - 0.04, 0.25), rightShoulder: p(x + 0.04, 0.25),
        leftHip: p(x - 0.03, 0.55), rightHip: p(x + 0.03, 0.55),
        leftAnkle: p(x - 0.03, 0.9), rightAnkle: p(x + 0.03, 0.9),
    };
}

test('app tracking: detector runs, the camera follows, and the operator can take over', async (t) => {
    const cam = await new FakeCamera({ mode: 'udp-raw' }).start();
    const rtsp = await new FakeRtspServer().start();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-apptrack-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        cameras: [{ id: 'cam-1', name: 'Left', host: '127.0.0.1', port: cam.port, mode: 'udp-raw', previewUrl: rtsp.url }],
    }));
    const app = await electron.launch({
        // Software WebGL: the test machine has no graphics card.
        args: [root, '--no-sandbox', '--enable-unsafe-swiftshader'],
        env: { ...process.env, PTZ_USER_DATA: dir, PTZ_TEST_HOOKS: '1' },
    });
    t.after(async () => { await app.close(); await cam.stop(); await rtsp.stop(); });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('[data-testid=camera-tile][data-state=online]').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid=camera-tile] [data-testid=video-canvas]')?.width > 0, null, { timeout: 15000 });

    const tracking = page.getByRole('group', { name: 'Tracking', exact: true });
    await tracking.getByRole('button', { name: 'App' }).click();
    await tracking.getByRole('button', { name: 'App', pressed: true }).waitFor();
    // Turning app tracking on turns the camera's own tracking off.
    await until(() => cam.received.includes('81 0A 01 32 00 00 03 00 FF'), 'camera tracking off');
    await page.getByRole('group', { name: 'Framing' }).getByRole('button', { name: 'Waist', pressed: true }).waitFor();

    // The real detector loads and runs on the video: nobody in the test
    // picture, so it keeps looking, with no error shown.
    await page.getByTestId('app-tracking-status').getByText('Looking for the presenter').waitFor();
    await page.waitForTimeout(4000);
    assert.equal(await page.getByRole('alert').count(), 0, 'no error message');
    assert.deepEqual(errors, []);

    // A presenter to the right of the picture: the camera pans right.
    cam.clearLog();
    for (let i = 0; i < 5; i += 1) {
        await app.evaluate((_e, pts) => globalThis.ptzTest.observe('cam-1', pts), personAt(0.8));
        await page.waitForTimeout(30);
    }
    await until(() => cam.received.some((h) => /^81 01 06 01 .. .. 02 0[123] FF$/.test(h)), () => `pan right (got ${cam.received.join(' | ')})`);
    // ...and to the left: pans left.
    for (let i = 0; i < 5; i += 1) {
        await app.evaluate((_e, pts) => globalThis.ptzTest.observe('cam-1', pts), personAt(0.15));
        await page.waitForTimeout(30);
    }
    await until(() => cam.received.some((h) => /^81 01 06 01 .. .. 01 0[123] FF$/.test(h)), 'pan left');
    // When nobody is found, the camera stops.
    await until(() => cam.received.at(-1) === '81 01 06 01 01 01 03 03 FF' || cam.received.slice(-3).includes('81 01 06 01 01 01 03 03 FF'), 'stop when nobody is seen');

    // Framing choice.
    await page.getByRole('group', { name: 'Framing' }).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('group', { name: 'Framing' }).getByRole('button', { name: 'Close', pressed: true }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '15-app-tracking.png') });

    // The operator grabs the joystick: app tracking hands over.
    const pad = await page.getByTestId('joystick').boundingBox();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.mouse.move(pad.x + pad.width - 5, pad.y + pad.height / 2, { steps: 3 });
    await page.mouse.up();
    await page.getByRole('status').getByText('App tracking turned off for Left').waitFor();
    await tracking.getByRole('button', { name: 'Off', pressed: true }).waitFor();

    // Switching to the camera's own tracking from app tracking.
    await tracking.getByRole('button', { name: 'App' }).click();
    await tracking.getByRole('button', { name: 'App', pressed: true }).waitFor();
    await tracking.getByRole('button', { name: 'Camera' }).click();
    await tracking.getByRole('button', { name: 'Camera', pressed: true }).waitFor();
    assert.equal(cam.state.tracking, true);
});
