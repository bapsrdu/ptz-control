// Tracking hand-off, exposure and power, driven through the real window.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { FakeCamera } from '../sim/fake-camera.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.PTZ_SCREENSHOTS;

async function until(check, what, timeoutMs = 5000) {
    const start = Date.now();
    for (;;) {
        if (await check()) return;
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 50));
    }
}

test('tracking turns off when the operator moves the camera; exposure; standby and wake', async (t) => {
    const cams = await Promise.all([0, 1].map(() => new FakeCamera({ mode: 'udp-raw' }).start()));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-p5-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        cameras: cams.map((c, i) => ({ name: ['Left', 'Right'][i], host: '127.0.0.1', port: c.port, mode: 'udp-raw', previewUrl: 'rtsp://127.0.0.1:9/none' })),
    }));
    const app = await electron.launch({ args: [root, '--no-sandbox'], env: { ...process.env, PTZ_USER_DATA: dir } });
    t.after(async () => {
        await app.close();
        await Promise.all(cams.map((c) => c.stop()));
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=camera-tile]')].every((t) => t.dataset.state === 'online'));
    const [left] = cams;

    // --- Tracking hand-off ---------------------------------------------------
    await page.getByRole('button', { name: 'Off', exact: true }).click();
    await until(() => left.state.tracking, 'tracking on');
    left.clearLog();
    const pad = await page.getByTestId('joystick').boundingBox();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.mouse.move(pad.x + pad.width - 5, pad.y + pad.height / 2, { steps: 3 });
    await page.mouse.up();
    await until(() => left.received.includes('81 01 06 01 01 01 03 03 FF'), 'stop');
    const trackingOff = left.received.indexOf('81 0A 01 32 00 00 03 00 FF');
    const firstDrive = left.received.findIndex((h) => h.startsWith('81 01 06 01') && h.endsWith('02 03 FF'));
    assert.ok(trackingOff !== -1 && firstDrive !== -1 && trackingOff < firstDrive, `tracking off must come before moving:\n${left.received.join('\n')}`);
    assert.equal(left.state.tracking, false);
    await page.getByRole('status').getByText('Auto tracking turned off for Left').waitFor();
    await page.getByRole('button', { name: 'Off', exact: true }).waitFor();

    // --- Exposure ------------------------------------------------------------
    await page.getByRole('button', { name: 'Exposure' }).click();
    const panel = page.getByTestId('exposure-panel');
    await panel.getByRole('button', { name: 'Auto', pressed: true }).waitFor();
    await panel.getByRole('button', { name: 'Bright', exact: true }).click();
    await panel.getByRole('button', { name: 'Bright', exact: true, pressed: true }).waitFor();
    assert.equal(left.state.ae, 0x0d);
    await panel.getByRole('button', { name: 'Brightness up' }).click();
    await panel.getByTestId('step-bright').getByText('13').waitFor();
    await panel.getByRole('button', { name: 'Backlight' }).click();
    await until(() => left.state.backlight, 'backlight on');
    await panel.locator('select[name=wbMode]').selectOption('5500K');
    await until(() => left.state.wb === 0x09, 'white balance 5500K');
    // The panel reads back what the camera reports, so a change made elsewhere shows too.
    left.state.ae = 0x00;
    await page.getByRole('button', { name: 'Close exposure' }).click();
    await page.getByRole('button', { name: 'Exposure' }).click();
    await panel.getByRole('button', { name: 'Auto', pressed: true }).waitFor();
    await panel.getByRole('button', { name: 'Brighter or darker' }).click();
    await panel.getByRole('button', { name: 'Adjust up' }).click();
    await panel.getByTestId('step-expComp').getByText('+1').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '11-exposure.png') });
    await page.getByRole('button', { name: 'Close exposure' }).click();

    // --- Standby and wake ----------------------------------------------------
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Standby' }).click();
    await page.getByTestId('standby-banner').waitFor();
    assert.equal(left.state.power, false);
    await page.getByTestId('camera-tile').filter({ hasText: 'Left' }).getByText('Standby').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '12-standby.png') });
    await page.getByRole('button', { name: 'Wake up' }).click();
    await page.getByTestId('standby-banner').waitFor({ state: 'detached' });
    assert.equal(left.state.power, true);

    // Standby all from settings, then wake all.
    await page.getByRole('button', { name: 'Settings' }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Standby all' }).click();
    await until(() => cams.every((c) => !c.state.power), 'all in standby');
    await page.getByRole('button', { name: 'Wake all' }).click();
    await until(() => cams.every((c) => c.state.power), 'all awake');
});
