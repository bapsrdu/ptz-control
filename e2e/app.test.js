// Drives the real app window against fake cameras.
//
//   xvfb-run -a npm run test:e2e        (Linux without a screen)
//   npm run test:e2e                    (Windows / Mac)
//
// Set PTZ_SCREENSHOTS=<folder> to save screenshots along the way.

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

async function launch(userData) {
    const app = await electron.launch({
        args: [root, '--no-sandbox'],
        env: { ...process.env, PTZ_USER_DATA: userData },
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('header');
    return { app, page };
}

async function screenshot(page, name) {
    if (!shots) return;
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-e2e-'));
}

async function waitForLog(camera, hex, timeoutMs = 3000) {
    const start = Date.now();
    while (!camera.received.includes(hex)) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`camera never received ${hex}; got:\n${camera.received.join('\n')}`);
        }
        await new Promise((r) => setTimeout(r, 25));
    }
}

test('first run: add a camera, move it, save and recall a shot', async (t) => {
    const fake = await new FakeCamera({ mode: 'udp-sony' }).start();
    const { app, page } = await launch(tempDir());
    t.after(async () => { await app.close(); await fake.stop(); });

    await page.getByText('Welcome').waitFor();
    await screenshot(page, '01-welcome');
    await page.getByRole('button', { name: 'Add a camera' }).click();

    const form = page.getByTestId('camera-form');
    await form.locator('input[name=name]').fill('Left');
    await form.locator('input[name=host]').fill('127.0.0.1');
    await form.locator('input[name=port]').fill(String(fake.port));
    await form.getByRole('button', { name: 'Test connection' }).click();
    await assert.doesNotReject(page.getByTestId('test-result').filter({ hasText: 'Found it' }).waitFor());
    await screenshot(page, '02-add-camera-tested');
    await form.getByRole('button', { name: 'Add camera' }).click();

    await page.getByTestId('settings-camera').filter({ hasText: 'Connected using UDP with Sony header' }).waitFor();
    await screenshot(page, '03-camera-list');
    await page.getByRole('button', { name: 'Back to controls' }).click();

    assert.equal(await page.getByTestId('camera-tile').count(), 1);
    await page.getByTestId('camera-tile').filter({ hasText: 'Connected' }).waitFor();

    // Drag the joystick right, hold, let go.
    fake.clearLog();
    const pad = await page.getByTestId('joystick').boundingBox();
    const cx = pad.x + pad.width / 2;
    const cy = pad.y + pad.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + pad.width / 2, cy, { steps: 5 });
    await page.waitForTimeout(600);
    await screenshot(page, '04-control-moving');
    await page.mouse.up();
    await waitForLog(fake, '81 01 06 01 01 01 03 03 FF');
    const drives = fake.received.filter((h) => h.startsWith('81 01 06 01') && h.endsWith('02 03 FF'));
    assert.ok(drives.length >= 1, `expected a pan-right drive, got ${fake.received.join(' | ')}`);
    assert.ok(drives.length <= 8, `too many drive messages: ${drives.length}`);
    assert.equal(fake.received.at(-1), '81 01 06 01 01 01 03 03 FF', 'last message must be Stop');

    // Zoom lever: push up, let go.
    fake.clearLog();
    const lever = await page.getByTestId('zoom-slider').boundingBox();
    await page.mouse.move(lever.x + lever.width / 2, lever.y + lever.height / 2);
    await page.mouse.down();
    await page.mouse.move(lever.x + lever.width / 2, lever.y + 4, { steps: 3 });
    await page.mouse.up();
    await waitForLog(fake, '81 01 04 07 00 FF');
    assert.ok(fake.received.some((h) => /^81 01 04 07 2[0-7] FF$/.test(h)), fake.received.join(' | '));

    // Save a shot, then recall it.
    fake.clearLog();
    await page.getByRole('button', { name: 'Save a shot on Left' }).click();
    await page.getByPlaceholder('Name this shot').fill('Pulpit');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Pulpit' }).waitFor();
    await waitForLog(fake, '81 01 04 3F 01 01 FF');
    await page.getByRole('button', { name: 'Pulpit' }).click();
    await waitForLog(fake, '81 01 04 3F 02 01 FF');
    await screenshot(page, '05-control-with-shot');

    // Tracking toggle (BZB profile).
    await page.getByRole('button', { name: 'Off' }).click();
    await waitForLog(fake, '81 0A 01 32 00 00 02 00 FF');
    assert.equal(fake.state.tracking, true);
});

test('blur stops a camera that is being moved', async (t) => {
    const fake = await new FakeCamera({ mode: 'tcp-raw' }).start();
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        cameras: [{ name: 'Centre', host: '127.0.0.1', port: fake.port, mode: 'tcp-raw' }],
    }));
    const { app, page } = await launch(dir);
    t.after(async () => { await app.close(); await fake.stop(); });
    await page.getByTestId('camera-tile').filter({ hasText: 'Connected' }).waitFor();

    const pad = await page.getByTestId('joystick').boundingBox();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + 5, { steps: 3 });
    fake.clearLog();
    // Simulate the operator clicking into another app mid-drag.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('blur'));
    await waitForLog(fake, '81 01 06 01 01 01 03 03 FF');
    await page.mouse.up();
});

for (const count of [1, 3, 6]) {
    test(`shows ${count} camera tile${count === 1 ? '' : 's'} for ${count} camera${count === 1 ? '' : 's'}`, async (t) => {
        const fakes = await Promise.all(Array.from({ length: count }, () => new FakeCamera({ mode: 'udp-raw' }).start()));
        const dir = tempDir();
        const names = ['Left', 'Centre', 'Right', 'Mandir', 'Balcony', 'Stage'];
        fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
            cameras: fakes.map((f, i) => ({
                name: names[i],
                host: '127.0.0.1',
                port: f.port,
                mode: 'udp-raw',
                presets: i === 0 ? [{ name: 'Home', number: 1 }, { name: 'Pulpit', number: 2 }] : [{ name: 'Home', number: 1 }],
            })),
        }));
        const { app, page } = await launch(dir);
        t.after(async () => { await app.close(); await Promise.all(fakes.map((f) => f.stop())); });

        await page.getByTestId('camera-tile').first().waitFor();
        assert.equal(await page.getByTestId('camera-tile').count(), count);
        assert.equal(await page.getByTestId('shots-row').count(), count);
        await page.waitForFunction((n) => document.querySelectorAll('[data-testid=camera-tile]').length === n
            && [...document.querySelectorAll('[data-testid=camera-tile]')].every((t) => t.textContent.includes('Connected')), count);

        // Picking another camera moves the green border.
        if (count > 1) {
            await page.getByTestId('camera-tile').nth(1).click();
            await page.getByText(`Frame ${names[1]}`).waitFor();
        }
        await screenshot(page, `06-tiles-${count}`);
    });
}
