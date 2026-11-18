// Finding cameras on the network, and matching cameras' exposure, through
// the real window against pretend cameras.

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

async function until(check, what, timeoutMs = 8000) {
    const start = Date.now();
    for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 50));
    }
}

test('find a camera on the network and add it', async (t) => {
    const cam = await new FakeCamera({ mode: 'udp-raw' }).start();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-find-'));
    const finder = { hosts: ['127.0.0.1'], probes: [{ mode: 'udp-raw', port: cam.port }], atemPort: 1, waitMs: 500, titles: false };
    const app = await electron.launch({ args: [root, '--no-sandbox'], env: { ...process.env, PTZ_USER_DATA: dir, PTZ_FINDER: JSON.stringify(finder) } });
    t.after(async () => { await app.close(); await cam.stop(); });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole('button', { name: 'Add a camera' }).click();
    await page.getByTestId('camera-form').getByRole('button', { name: 'Cancel' }).click();
    const find = page.getByTestId('find-devices');
    await find.getByRole('button', { name: 'Find' }).click();
    await find.getByTestId('found-device').filter({ hasText: '127.0.0.1' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '22-find-devices.png') });
    await find.getByRole('button', { name: 'Add the camera at 127.0.0.1' }).click();

    const form = page.getByTestId('camera-form');
    assert.equal(await form.locator('input[name=host]').inputValue(), '127.0.0.1');
    assert.equal(await form.locator('input[name=port]').inputValue(), String(cam.port));
    await form.locator('input[name=name]').fill('Found');
    await form.getByRole('button', { name: 'Add camera' }).click();
    await page.getByTestId('settings-camera').filter({ hasText: 'Connected using UDP, plain VISCA' }).waitFor();
    // Searching again shows it as added.
    await find.getByRole('button', { name: 'Look again' }).click();
    await find.getByTestId('found-device').filter({ hasText: 'Already added' }).waitFor();
});

test('match cameras: copy settings and fine-tune from the pictures', async (t) => {
    const cams = await Promise.all([0, 1].map(() => new FakeCamera({ mode: 'udp-raw' }).start()));
    const streams = await Promise.all([0, 1].map(() => new FakeRtspServer().start()));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-match-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        cameras: cams.map((c, i) => ({ name: ['Left', 'Right'][i], host: '127.0.0.1', port: c.port, mode: 'udp-raw', previewUrl: streams[i].url })),
    }));
    const app = await electron.launch({ args: [root, '--no-sandbox'], env: { ...process.env, PTZ_USER_DATA: dir } });
    t.after(async () => { await app.close(); await Promise.all([...cams, ...streams].map((c) => c.stop())); });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=camera-tile]')].length === 2
        && [...document.querySelectorAll('[data-testid=camera-tile]')].every((x) => x.dataset.state === 'online'));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=camera-tile] [data-testid=video-canvas]')].every((c) => c.width > 0), null, { timeout: 15000 });

    Object.assign(cams[0].state, { ae: 0x03, iris: 14, shutter: 11, gain: 4, wb: 0x05, rGain: 150, bGain: 110 });
    await page.getByRole('button', { name: 'Exposure' }).click();
    await page.getByRole('button', { name: 'Match other cameras' }).click();
    const panel = page.getByTestId('match-panel');
    await panel.getByText('Match cameras to Left').waitFor();
    // Both pictures are measured.
    await until(async () => (await panel.getByTestId('match-row').allInnerTexts()).every((r) => /\d/.test(r)), 'measurements');
    if (shots) await page.screenshot({ path: path.join(shots, '23-match-cameras.png') });

    await panel.getByRole('button', { name: 'Copy settings' }).click();
    await until(() => cams[1].state.iris === 14 && cams[1].state.rGain === 150 && cams[1].state.wb === 0x05, 'settings copied');
    assert.equal(cams[1].state.ae, 0x03);
    await page.getByRole('status').getByText("Copied Left's settings to Right.").waitFor();

    // The same test picture on both: fine-tuning finds them already matched.
    await panel.getByRole('button', { name: 'Fine-tune from the pictures' }).click();
    await panel.getByText('Matched').waitFor({ timeout: 15000 });
});
