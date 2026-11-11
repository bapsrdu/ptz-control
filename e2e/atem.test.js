// The ATEM link, driven through the real window, with a pretend switcher
// (PTZ_FAKE_ATEM) and pretend cameras.

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

const RED_ON = '81 01 7E 01 0A 00 02 00 FF';
const RED_OFF = '81 01 7E 01 0A 00 03 00 FF';
const GREEN_ON = '81 01 7E 01 0A 00 00 02 FF';
const GREEN_OFF = '81 01 7E 01 0A 00 00 03 FF';

async function until(check, what, timeoutMs = 5000) {
    const start = Date.now();
    for (;;) {
        const value = await check();
        if (value) return value;
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 50));
    }
}

const lastTally = (cam) => {
    const t = cam.received.filter((h) => h.startsWith('81 01 7E 01 0A 00'));
    return { red: t.filter((h) => h === RED_ON || h === RED_OFF).at(-1), green: t.filter((h) => h === GREEN_ON || h === GREEN_OFF).at(-1) };
};

test('LIVE and NEXT, tally lights, live-camera guard and lower thirds', async (t) => {
    const cams = await Promise.all([0, 1, 2].map(() => new FakeCamera({ mode: 'udp-raw' }).start()));
    const streams = await Promise.all([0, 1, 2].map(() => new FakeRtspServer().start()));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-atem-'));
    const names = ['Left', 'Centre', 'Right'];
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        cameras: cams.map((c, i) => ({
            name: names[i], host: '127.0.0.1', port: c.port, mode: 'udp-raw', previewUrl: streams[i].url,
            atemInput: 3 + i, presets: [{ name: 'Pulpit', number: 1 }],
        })),
        // M/E 2 feeds the stream; outputs 1 and 2 are the left and right screens.
        atem: { host: '192.0.2.10', watched: [{ type: 'me', index: 1 }, { type: 'aux', index: 0 }, { type: 'aux', index: 1 }], lowerThirds: { type: 'dsk', index: 0 }, tally: true },
        ui: { speed: 1 },
    }));
    const app = await electron.launch({ args: [root, '--no-sandbox'], env: { ...process.env, PTZ_USER_DATA: dir, PTZ_FAKE_ATEM: '1' } });
    t.after(async () => {
        await app.close();
        await Promise.all([...cams, ...streams].map((c) => c.stop()));
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    const atem = (fn, ...args) => app.evaluate((_electron, [name, a]) => globalThis.ptzFakeAtem[name](...a), [fn, args]);

    await page.getByText('Fake ATEM 2 M/E').waitFor();
    // Every tile shows video.
    const canvases = page.getByTestId('camera-tiles').getByTestId('video-canvas');
    for (let i = 0; i < 3; i += 1) {
        await until(() => canvases.nth(i).evaluate((c) => {
            if (!c.width) return false;
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let sum = 0;
            for (let j = 0; j < d.length; j += 4 * 97) sum += d[j] + d[j + 1] + d[j + 2];
            return sum / (d.length / (4 * 97)) / 3 > 30;
        }), `video on tile ${i + 1}`, 15000);
    }
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=camera-tile]')].every((t) => t.dataset.state === 'online'));

    // Centre on M/E 2 program, Right on preview. The screens show M/E 1 (input 1).
    await atem('cut', 1, 4);
    await atem('preview', 1, 5);
    const tile = (name) => page.getByTestId('camera-tile').filter({ hasText: name });
    await tile('Centre').getByTestId('badge-live').waitFor();
    await tile('Right').getByTestId('badge-next').waitFor();
    assert.equal(await tile('Left').getByTestId('badge-live').count(), 0);
    await until(() => lastTally(cams[1]).red === RED_ON && lastTally(cams[2]).green === GREEN_ON, 'tally lights');
    assert.equal(lastTally(cams[1]).green, GREEN_OFF);

    // Left camera sent straight to the left screen: two cameras live at once.
    await atem('route', 0, 3);
    await tile('Left').getByTestId('badge-live').waitFor();
    await until(() => lastTally(cams[0]).red === RED_ON, 'Left tally red');
    await page.getByTestId('live-view').getByText('Left').waitFor();
    await page.getByTestId('live-view').getByText('Centre').waitFor();
    if (shots) {
        await page.screenshot({ path: path.join(shots, '08-atem-two-live.png') });
        // A full-HD control-room screen: the views should grow to use it.
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(shots, '08b-atem-1080p.png') });
        await page.setViewportSize({ width: 1280, height: 900 });
    }

    // A live camera can be moved straight away; a red note says it is live.
    await tile('Centre').click();
    await page.getByTestId('live-note').waitFor();
    cams[1].clearLog();
    const pad = await page.getByTestId('joystick').boundingBox();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.mouse.move(pad.x + pad.width - 5, pad.y + pad.height / 2, { steps: 3 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await until(() => cams[1].received.some((h) => h.startsWith('81 01 06 01') && h.endsWith('02 03 FF')), 'live camera moves without unlocking');
    if (shots) await page.screenshot({ path: path.join(shots, '09-live-camera.png') });

    // Recalling a shot on a live camera goes straight through, no question.
    cams[1].clearLog();
    let asked = false;
    page.once('dialog', (d) => { asked = true; d.dismiss(); });
    await page.getByTestId('shots-row').filter({ hasText: 'Centre' }).getByRole('button', { name: 'Pulpit' }).click();
    await until(() => cams[1].received.includes('81 01 04 3F 02 01 FF'), 'recall on a live camera');
    assert.equal(asked, false);

    // Off air again: the note goes away and tally turns off.
    await atem('cut', 1, 15);
    await page.getByTestId('live-note').waitFor({ state: 'detached' });
    await until(() => lastTally(cams[1]).red === RED_OFF, 'Centre tally off');

    // Lower thirds: the only thing the app may change on the ATEM.
    await page.getByTestId('lower-thirds').click();
    await page.getByTestId('lower-thirds').filter({ hasText: 'ON AIR' }).waitFor();
    await page.getByTestId('lower-thirds').click();
    await page.getByTestId('lower-thirds').filter({ hasText: 'off' }).waitFor();
    const writes = await app.evaluate(() => globalThis.ptzFakeAtem.writes);
    assert.deepEqual(writes, [['dsk', 0, true], ['dsk', 0, false]]);

    // Unticking the left screen in settings means Left is no longer live there.
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByTestId('atem-status').getByText('Connected to Fake ATEM 2 M/E').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '10-atem-settings.png'), fullPage: true });
    const out1 = page.getByRole('checkbox', { name: 'Output 1', exact: true });
    await out1.click();
    await until(async () => !(await out1.isChecked()), 'Output 1 unticked');
    await page.getByRole('button', { name: 'Back to controls' }).click();
    await page.waitForFunction(() => {
        const left = [...document.querySelectorAll('[data-testid=camera-tile]')].find((t) => t.textContent.includes('Left'));
        return left && !left.querySelector('[data-testid=badge-live]');
    });
    await until(() => lastTally(cams[0]).red === RED_OFF, 'Left tally off');
});
