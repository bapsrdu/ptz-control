// Tracking mode and headroom through the camera's web page interface, driven
// through the real window against a fake camera and fake camera web page.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { FakeCamera } from '../sim/fake-camera.js';
import { FakeBzbWeb } from '../sim/fake-bzb-web.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.PTZ_SCREENSHOTS;

async function until(check, what, timeoutMs = 8000) {
    const start = Date.now();
    for (;;) {
        if (await check()) return;
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 100));
    }
}

test('tracking mode and headroom follow the camera, and can be changed', async (t) => {
    const cam = await new FakeCamera({ mode: 'udp-raw' }).start();
    const web = await new FakeBzbWeb({ requireLogin: true }).start();
    // Someone already turned tracking on at the camera, in Presenter mode, medium headroom.
    Object.assign(web.tracking, { bEnable: 1, nTrackMode: 0, nHeadRoom: 1 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-track-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        cameras: [{ name: 'Left', host: '127.0.0.1', port: cam.port, mode: 'udp-raw', previewUrl: 'rtsp://127.0.0.1:9/none' }],
    }));
    const app = await electron.launch({ args: [root, '--no-sandbox'], env: { ...process.env, PTZ_USER_DATA: dir, PTZ_WEB_PORT: String(web.port) } });
    t.after(async () => { await app.close(); await cam.stop(); await web.stop(); });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    // The app shows what the camera reports, not a guess.
    await page.getByRole('button', { name: 'On', exact: true }).waitFor({ timeout: 10000 });
    await page.getByRole('group', { name: 'Tracking mode' }).getByRole('button', { name: 'Presenter', pressed: true }).waitFor();
    await until(async () => (await page.getByLabel('Headroom').inputValue()) === 'medium', 'headroom medium');
    assert.equal(web.loggedIn, true, 'logged in with the default login when asked');

    // Change headroom and mode.
    await page.getByLabel('Headroom').selectOption('high');
    await until(() => web.tracking.nHeadRoom === 2, 'headroom high at the camera');
    await page.getByRole('group', { name: 'Tracking mode' }).getByRole('button', { name: 'Zone' }).click();
    await until(() => web.tracking.nTrackMode === 1, 'zone mode at the camera');
    await page.getByRole('button', { name: 'Set up zones' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '13-tracking-zone.png') });

    // Zones are set up on the camera's own page, which opens in its own window.
    const pageWindow = app.waitForEvent('window');
    await page.getByRole('button', { name: 'Set up zones' }).click();
    const opened = await pageWindow;
    await until(() => opened.url().startsWith(`http://127.0.0.1:${web.port}/`), 'the camera page to open');

    await page.getByRole('group', { name: 'Tracking mode' }).getByRole('button', { name: 'Presenter' }).click();
    await until(() => web.tracking.nTrackMode === 0, 'presenter mode at the camera');
    await page.getByRole('group', { name: 'Tracking mode' }).getByRole('button', { name: 'Presenter', pressed: true }).waitFor();
    await page.getByLabel('Headroom').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '14-tracking-presenter.png') });

    // Someone turns tracking off with the remote: the app notices within 10 seconds.
    web.tracking.bEnable = 0;
    await page.getByRole('button', { name: 'Off', exact: true }).waitFor({ timeout: 15000 });
});
