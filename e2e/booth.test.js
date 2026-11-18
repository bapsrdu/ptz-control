// Drives Booth Video's real window against a pretend ATEM and pretend
// cameras: pick, frame, take; shots; keys; routing; the full switcher;
// Setup, Status and hand edits to the setup file.
//
//   xvfb-run -a node --test e2e/booth.test.js   (after npm run build:booth)

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

async function screenshot(page, name) {
    if (!shots) return;
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, `booth-${name}.png`) });
}

const fakeAtem = (app, fn) => app.evaluate((_e, src) => {
    return new Function('atem', `return (${src})(atem)`)(globalThis.ptzFakeAtem);
}, fn.toString());

async function until(check, what, timeoutMs = 4000) {
    const start = Date.now();
    for (;;) {
        const v = await check();
        if (v) return v;
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 40));
    }
}

test('Booth Video: pick, frame, take, shots, keys, routing, switcher, setup', async (t) => {
    const left = await new FakeCamera({ mode: 'udp-raw' }).start();
    const right = await new FakeCamera({ mode: 'udp-raw' }).start();
    const rtsp = await new FakeRtspServer().start();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-e2e-'));
    const configFile = path.join(dir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({
        atemHost: 'fake-atem',
        me: 1,
        sources: [{ input: 1 }, { input: 2 }, { input: 3, label: 'Graphics' }],
        cameras: [
            { id: 'cam-l', name: 'Left', host: '127.0.0.1', port: left.port, mode: 'udp-raw', atemInput: 1, previewUrl: rtsp.url, presetNames: { 3: 'Band' } },
            { id: 'cam-r', name: 'Right', host: '127.0.0.1', port: right.port, mode: 'udp-raw', atemInput: 2, previewUrl: rtsp.url },
        ],
        keys: [{ label: 'Lower thirds', me: 1, keyer: 1 }, { label: 'Logo', dsk: 1 }],
        screens: [{ name: 'Lobby TVs', aux: [4, 5] }, { name: 'Stream encoder', aux: [1], volunteer: false }],
        routes: [{ label: 'Lobby: stream', set: [{ aux: 4, source: 10010 }, { aux: 5, source: 10010 }] }],
    }, null, 2));

    const app = await electron.launch({
        args: [path.join(root, 'booth', 'main.js'), '--no-sandbox'],
        env: { ...process.env, PTZ_USER_DATA: dir, PTZ_FAKE_ATEM: '1', PTZ_TEST_HOOKS: '1' },
    });
    t.after(async () => { await app.close(); await left.stop(); await right.stop(); await rtsp.stop(); });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // --- Operate: the monitors and the source row --------------------------
    await page.getByTestId('monitor-next').waitFor();
    assert.equal(await page.getByTestId('source-tile').count(), 3);
    // The fake ATEM starts with input 1 live and 2 next.
    await page.getByTestId('next-camera').filter({ hasText: 'Right' }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=monitor-next] [data-testid=video-canvas]')].some((c) => c.width > 0), null, { timeout: 15000 });
    await screenshot(page, '01-operate');

    // Pick: a tile puts it on Next.
    await page.getByTestId('source-tile').nth(2).click();
    await until(() => fakeAtem(app, (a) => a.state.video.mixEffects[0].previewInput === 3), 'preview 3');
    await page.getByTestId('next-camera').filter({ hasText: 'No camera on Next' }).waitFor();

    // Take: Space cuts, the number keys pick, Return fades.
    await page.keyboard.press('Space');
    await until(() => fakeAtem(app, (a) => a.state.video.mixEffects[0].programInput === 3), 'cut to 3');
    await page.keyboard.press('2');
    await until(() => fakeAtem(app, (a) => a.state.video.mixEffects[0].previewInput === 2), 'preview 2 from the keyboard');
    await page.keyboard.press('Enter');
    await page.getByTestId('fade').filter({ hasText: 'FADING' }).waitFor();
    await until(() => fakeAtem(app, (a) => a.state.video.mixEffects[0].programInput === 2), 'fade to 2');
    await page.getByTestId('fade').filter({ hasText: 'FADE' }).filter({ hasNotText: 'FADING' }).waitFor();

    // Frame: the joystick moves the camera on Next (now Left, input 1? no: 3 is next after the fade).
    await page.getByTestId('source-tile').nth(0).click();
    await page.getByTestId('next-camera').filter({ hasText: 'Left' }).waitFor();
    const pad = await page.getByTestId('joystick').boundingBox();
    left.clearLog();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.mouse.move(pad.x + pad.width - 10, pad.y + pad.height / 2, { steps: 4 });
    await until(() => left.received.some((h) => h.startsWith('81 01 06 01') && h.split(' ')[6] === '02'), 'pan right');
    await page.mouse.up();
    await until(() => left.received.some((h) => /^81 01 06 01 .. .. 03 03 FF$/.test(h)), 'stop');
    // Right is live: the arrows never move it, only the camera on Next.
    right.clearLog();
    await page.keyboard.down('ArrowLeft');
    await until(() => left.received.some((h) => h.startsWith('81 01 06 01') && h.split(' ')[6] === '01'), 'arrow pans left');
    await page.keyboard.up('ArrowLeft');
    assert.ok(!right.received.some((h) => h.startsWith('81 01 06 01') && h.split(' ')[6] !== '03'), 'the live camera never moved');

    // Shots: save where Left is, move it, recall the shot.
    left.state.pan = 0x0123;
    left.state.tilt = -0x20;
    left.state.zoom = 0x0800;
    const leftRow = page.getByTestId('shot-row').filter({ hasText: 'Left' });
    await leftRow.getByTestId('save-shot').click();
    await page.getByTestId('name-input').fill('Pulpit');
    await page.getByTestId('name-save').click();
    await leftRow.getByTestId('shot').filter({ hasText: 'Pulpit' }).waitFor();
    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8')).cameras[0].shots[0];
    assert.deepEqual([saved.name, saved.pan, saved.tilt, saved.zoom], ['Pulpit', 0x123, -0x20, 0x800]);
    left.state.pan = 0;
    left.state.zoom = 0;
    await leftRow.getByTestId('shot').filter({ hasText: 'Pulpit' }).click();
    await until(() => left.state.pan === 0x123 && left.state.tilt === -0x20 && left.state.zoom === 0x800, 'the camera back on the shot');
    // A preset named on the camera shows and recalls.
    await leftRow.getByTestId('shot').filter({ hasText: 'Band' }).click();
    await until(() => left.received.includes('81 01 04 3F 02 03 FF'), 'preset 3 recalled');
    // Moving the live camera asks first.
    await page.getByTestId('shot-row').filter({ hasText: 'Right' }).getByTestId('save-shot').click();
    await page.getByTestId('name-input').fill('Wide');
    await page.getByTestId('name-save').click();
    await page.getByTestId('shot-row').filter({ hasText: 'Right' }).getByTestId('shot').filter({ hasText: 'Wide' }).click();
    await page.getByTestId('confirm').filter({ hasText: 'Right is on Live' }).waitFor();
    await page.keyboard.press('Space'); // a dialog is open: Space must not cut
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await fakeAtem(app, (a) => a.state.video.mixEffects[0].programInput), 2);
    await page.getByTestId('confirm').getByRole('button', { name: 'Cancel' }).click();
    await screenshot(page, '02-shots');

    // Exposure for the camera on Next.
    await page.getByTestId('exposure-toggle').click();
    await page.getByTestId('exposure-panel').waitFor();
    left.clearLog();
    await page.getByTestId('exp-gain').getByTitle('Brighter').click();
    await until(() => left.received.includes('81 01 04 39 03 FF') && left.received.some((h) => h.startsWith('81 01 04 4C 00 00')), 'manual gain');
    await page.getByTestId('auto-exposure').click();
    await until(() => left.received.includes('81 01 04 39 00 FF'), 'auto exposure');
    await screenshot(page, '03-exposure');

    // Keys, black and routing buttons.
    await page.getByTestId('key-button').filter({ hasText: 'LOWER THIRDS' }).click();
    await until(() => fakeAtem(app, (a) => a.state.video.mixEffects[0].upstreamKeyers[0].onAir), 'key 1 on');
    await page.getByTestId('key-button').filter({ hasText: 'ON AIR' }).waitFor();
    await page.getByTestId('key-button').filter({ hasText: 'LOGO' }).click();
    await until(() => fakeAtem(app, (a) => a.state.video.downstreamKeyers[0].onAir), 'DSK 1 on');
    await page.getByTestId('black').click();
    await until(() => fakeAtem(app, (a) => a.state.video.mixEffects[0].fadeToBlack.isFullyBlack), 'faded to black');
    await page.getByText('Faded to black').waitFor();
    await page.getByTestId('black').click();
    await page.getByTestId('route-button').filter({ hasText: 'Lobby: stream' }).click();
    await until(() => fakeAtem(app, (a) => a.state.video.auxilliaries[3] === 10010 && a.state.video.auxilliaries[4] === 10010), 'lobby routed');

    // Record and stream.
    await page.getByTestId('record').click();
    await page.locator('[data-testid=record][data-on=true]').waitFor();
    await page.getByTestId('stream').click();
    await page.locator('[data-testid=stream][data-on=true]').waitFor();
    await screenshot(page, '04-on-air');

    // --- Full switcher -----------------------------------------------------
    await page.getByTestId('tab-switcher').click();
    await page.getByTestId('bus-preview').getByRole('button', { name: 'IN5', exact: true }).click();
    await until(() => fakeAtem(app, (a) => a.state.video.mixEffects[0].previewInput === 5), 'preview 5 from the panel');
    // Space does nothing off Operate.
    await page.keyboard.press('Space');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await fakeAtem(app, (a) => a.state.video.mixEffects[0].programInput), 2);
    await page.getByTestId('style-dip').click();
    await until(() => fakeAtem(app, (a) => a.state.video.mixEffects[0].transitionProperties.nextStyle === 1), 'dip');
    await page.getByTestId('sel-key1').click();
    await until(() => fakeAtem(app, (a) => a.state.video.mixEffects[0].transitionProperties.nextSelection.includes(2)), 'key 1 in next transition');
    await page.getByTestId('macro').first().click();
    await until(() => fakeAtem(app, (a) => a.writes.some((w) => w[0] === 'macro')), 'macro run');
    await page.getByTestId('sw-cut').click();
    await until(() => fakeAtem(app, (a) => a.state.video.mixEffects[0].programInput === 5), 'cut from the panel');
    const bar = await page.getByTestId('tbar').boundingBox();
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height - 5);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2, { steps: 3 });
    await until(() => fakeAtem(app, (a) => a.writes.some((w) => w[0] === 'position' && w[2] > 2000)), 'T-bar moved');
    await page.mouse.up();
    await page.getByTestId('aux-2').selectOption('3');
    await until(() => fakeAtem(app, (a) => a.state.video.auxilliaries[1] === 3), 'aux 2 routed');
    await screenshot(page, '05-switcher');

    // --- Routing -----------------------------------------------------------
    await page.getByTestId('tab-routing').click();
    await page.getByTestId('screen-row').filter({ has: page.locator('input[value="Lobby TVs"]') }).getByTestId('screen-source').selectOption('7');
    await until(() => fakeAtem(app, (a) => a.state.video.auxilliaries[3] === 7 && a.state.video.auxilliaries[4] === 7), 'both lobby outputs together');
    await page.getByTestId('save-routing').click();
    await page.getByTestId('name-input').fill('Lobby: camera');
    await page.getByTestId('name-save').click();
    await page.getByTestId('routing-button').filter({ hasText: 'Lobby: camera' }).waitFor();
    await page.getByTestId('screen-summary').filter({ hasText: 'Lobby TVs is showing' }).waitFor();
    await screenshot(page, '06-routing');

    // --- Setup -------------------------------------------------------------
    await page.getByTestId('tab-setup').click();
    await page.getByTestId('setup-tabs').getByRole('button', { name: 'Key buttons' }).click();
    assert.equal(await page.getByTestId('key-setup-row').count(), 2);
    await page.getByTestId('setup-tabs').getByRole('button', { name: 'Sources' }).click();
    await page.getByTestId('add-source').selectOption('4');
    await until(() => JSON.parse(fs.readFileSync(configFile, 'utf8')).sources.length === 4, 'source added to the file');
    await page.getByTestId('setup-tabs').getByRole('button', { name: 'Cameras' }).click();
    assert.equal(await page.getByTestId('camera-setup-row').count(), 2);
    await screenshot(page, '07-setup-cameras');

    // A hand edit to the file is picked up.
    const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    cfg.cameras[1].name = 'Centre';
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
    await page.getByTestId('camera-setup-row').filter({ has: page.locator('input[value="Centre"]') }).waitFor({ timeout: 5000 });
    // A mistake in it is reported, and the app keeps running on the last good setup.
    fs.writeFileSync(configFile, '{ "atemHost": ');
    await page.getByTestId('config-banner').waitFor({ timeout: 5000 });
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
    await page.getByTestId('config-banner').waitFor({ state: 'detached', timeout: 5000 });

    // --- Status ------------------------------------------------------------
    await page.getByTestId('tab-status').click();
    await page.getByTestId('command-log').filter({ hasText: 'Cut on M/E 1' }).waitFor();
    await page.getByTestId('command-log').filter({ hasText: 'Aux 4' }).waitFor();
    await screenshot(page, '08-status');

    // Back on Operate, the Live and Next minis are gone and the big monitors back.
    await page.getByTestId('tab-operate').click();
    await page.getByTestId('monitor-live').waitFor();
    assert.deepEqual(errors, []);
});
