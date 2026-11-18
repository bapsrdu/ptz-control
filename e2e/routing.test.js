// The Routing page and the operator's routing buttons, with a pretend ATEM
// (PTZ_FAKE_ATEM).

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

async function until(check, what, timeoutMs = 8000) {
    const start = Date.now();
    for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${typeof what === 'function' ? what() : what}`);
        await new Promise((r) => setTimeout(r, 50));
    }
}

test('routing: name mixes and screens, route, save and run buttons', async (t) => {
    const cam = await new FakeCamera({ mode: 'udp-raw' }).start();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-routing-'));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        cameras: [{ name: 'Left', host: '127.0.0.1', port: cam.port, mode: 'udp-raw', atemInput: 3 }],
        atem: { host: '192.0.2.10', watched: [{ type: 'me', index: 1 }] },
    }));
    const app = await electron.launch({ args: [root, '--no-sandbox'], env: { ...process.env, PTZ_USER_DATA: dir, PTZ_FAKE_ATEM: '1' } });
    t.after(async () => { await app.close(); await cam.stop(); });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    const writes = () => app.evaluate(() => globalThis.ptzFakeAtem.writes.filter((w) => w[0] === 'aux'));
    const auxNow = (i) => app.evaluate((_e, n) => globalThis.ptzFakeAtem.state.video.auxilliaries[n], i);
    await page.getByText('Fake ATEM 2 M/E').waitFor();
    await app.evaluate(() => globalThis.ptzFakeAtem.nameInput(4, 'Graphics'));

    await page.getByRole('button', { name: 'Routing' }).click();
    const view = page.getByTestId('routing-view');
    await view.getByTestId('mix-card').first().waitFor();
    assert.equal(await view.getByTestId('mix-card').count(), 2);

    // Say what the M/Es are for.
    await view.getByLabel('What M/E 1 is for').fill('Live stream');
    await view.getByLabel('What M/E 1 is for').press('Enter');
    await view.getByLabel('What M/E 2 is for').fill('Side screens');
    await view.getByLabel('What M/E 2 is for').press('Enter');

    // Name Aux 1 the LED wall, and Aux 4 and 5 together the Lobby TVs.
    await view.getByRole('button', { name: 'Name Aux 1', exact: true }).click();
    let editor = view.getByTestId('screen-editor');
    await editor.getByPlaceholder('Such as Lobby TVs').fill('LED wall');
    await editor.getByRole('button', { name: 'Save' }).click();
    await view.getByText('LED wall', { exact: true }).waitFor();
    await view.getByRole('button', { name: 'Name Aux 4', exact: true }).click();
    editor = view.getByTestId('screen-editor');
    await editor.getByPlaceholder('Such as Lobby TVs').fill('Lobby TVs');
    await editor.getByRole('button', { name: '5', exact: true }).click();
    await editor.getByPlaceholder('Such as Converter 1 → Lobby TV').fill('Converters 4 and 5');
    await editor.getByRole('button', { name: 'Save' }).click();
    await view.getByText('Converters 4 and 5').waitFor();

    // Route: the LED wall to the side screens mix; the lobby to graphics (both outputs).
    await view.getByLabel('What LED wall shows').selectOption({ label: 'Side screens (M/E 2)' });
    await until(async () => (await auxNow(0)) === 10020, 'aux 1 routed');
    await view.getByLabel('What Lobby TVs shows').selectOption({ label: 'Graphics' });
    await until(async () => (await auxNow(3)) === 4 && (await auxNow(4)) === 4, 'aux 4 and 5 routed');

    // Save that as a button, then change things and run it.
    await view.getByRole('button', { name: 'Save the current routing as a button...' }).click();
    const form = view.getByTestId('new-route-button');
    await form.getByLabel('Button label').fill('Lobby: graphics');
    await form.getByLabel(/Lobby TVs/).check();
    await form.getByRole('button', { name: 'Save button' }).click();
    const card = view.getByTestId('route-button-card');
    await card.filter({ hasText: 'Lobby TVs ← Graphics' }).waitFor();
    await card.getByText('ON').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '20-routing.png') });

    await app.evaluate(() => globalThis.ptzFakeAtem.route(3, 10010));
    await until(async () => (await card.getByText('ON').count()) === 0, 'button no longer lit');
    await card.getByRole('button', { name: 'Run now' }).click();
    await until(async () => (await auxNow(3)) === 4, 'button ran');

    // The operator's buttons on the main screen.
    await page.getByRole('button', { name: 'Back to controls' }).click();
    await page.getByRole('tab', { name: 'Screens' }).click();
    const panel = page.getByTestId('route-panel');
    await panel.getByRole('button', { name: /Lobby: graphics/, pressed: true }).waitFor();
    await panel.getByTestId('screens-now').getByText('Side screens (M/E 2)').waitFor();
    await app.evaluate(() => globalThis.ptzFakeAtem.route(4, 10010));
    await panel.getByRole('button', { name: /Lobby: graphics/, pressed: false }).waitFor();
    await panel.getByRole('button', { name: /Lobby: graphics/ }).click();
    await panel.getByRole('button', { name: /Lobby: graphics/, pressed: true }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '21-route-panel.png') });

    // Only aux outputs were changed: nothing on program, preview or keys.
    const all = await app.evaluate(() => globalThis.ptzFakeAtem.writes);
    assert.ok(all.every((w) => w[0] === 'aux'), JSON.stringify(all));
    assert.ok((await writes()).length >= 4);

    // Saved in the settings file.
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).routing;
    assert.deepEqual(saved.mixNames, ['Live stream', 'Side screens']);
    assert.deepEqual(saved.screens.map((s) => [s.name, s.aux]), [['LED wall', [0]], ['Lobby TVs', [3, 4]]]);
    assert.equal(saved.buttons[0].label, 'Lobby: graphics');
});
