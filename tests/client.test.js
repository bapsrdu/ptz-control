// The phase 2 "done when": every control produces the expected bytes at the
// fake camera, in all four transport modes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeCamera } from '../sim/fake-camera.js';
import { ViscaClient } from '../src/main/visca/client.js';
import { MODES } from '../src/main/visca/transport.js';
import * as V from '../src/main/visca/commands.js';
import { bzbAdamo } from '../src/main/profiles/bzb-adamo.js';

function waitFor(predicate, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            if (predicate()) return resolve();
            if (Date.now() - start > timeoutMs) return reject(new Error('timed out waiting'));
            setTimeout(tick, 10);
        };
        tick();
    });
}

async function setup(mode, cameraOptions = {}) {
    const camera = await new FakeCamera({ mode, ...cameraOptions }).start();
    const client = new ViscaClient({ host: '127.0.0.1', port: camera.port, mode, commandTimeoutMs: 300, heartbeatMs: 60000 });
    client.start();
    await waitFor(() => (cameraOptions.silent ? client.transport?.isOpen : client.status.state === 'online'));
    camera.clearLog();
    return { camera, client };
}

for (const mode of MODES) {
    test(`${mode}: every control reaches the camera as the right bytes`, async (t) => {
        const { camera, client } = await setup(mode);
        t.after(async () => { client.stop(); await camera.stop(); });

        const { PAN, TILT } = V;
        await client.command(V.panTiltDrive(1, { panDir: PAN.LEFT, tiltDir: TILT.UP, panSpeed: 8, tiltSpeed: 4 }));
        await client.command(V.panTiltStop(1));
        await client.command(V.panTiltHome(1));
        await client.command(V.zoomTele(1, 3));
        await client.command(V.zoomStop(1));
        await client.command(V.focusManual(1));
        await client.command(V.focusNear(1));
        await client.command(V.focusStop(1));
        await client.command(V.focusAuto(1));
        await client.command(V.presetSave(1, 12));
        await client.command(V.presetRecall(1, 12));
        await client.command(V.presetClear(1, 12));
        await client.command(bzbAdamo.trackingCommand(1, true));
        await client.command(bzbAdamo.trackingCommand(1, false));

        assert.deepEqual(camera.received, [
            '81 01 06 01 08 04 01 01 FF',
            '81 01 06 01 01 01 03 03 FF',
            '81 01 06 04 FF',
            '81 01 04 07 23 FF',
            '81 01 04 07 00 FF',
            '81 01 04 38 03 FF',
            '81 01 04 08 03 FF',
            '81 01 04 08 00 FF',
            '81 01 04 38 02 FF',
            '81 01 04 3F 01 0C FF',
            '81 01 04 3F 02 0C FF',
            '81 01 04 3F 00 0C FF',
            '81 0A 01 32 00 00 02 00 FF',
            '81 0A 01 32 00 00 03 00 FF',
        ]);
        assert.equal(camera.state.tracking, false);
    });

    test(`${mode}: inquiries return the answer data`, async (t) => {
        const { camera, client } = await setup(mode);
        t.after(async () => { client.stop(); await camera.stop(); });
        const power = await client.inquiry(V.powerInquiry(1));
        assert.deepEqual([...power], [0x02]);
        camera.state.pan = 0x0123;
        camera.state.tilt = 0x0045;
        const pos = await client.inquiry(V.panTiltPositionInquiry(1));
        assert.equal(V.decodeNibbles(pos, 0), 0x0123);
        assert.equal(V.decodeNibbles(pos, 4), 0x0045);
    });
}

test('camera errors are reported, not swallowed', async (t) => {
    const { camera, client } = await setup('udp-sony');
    t.after(async () => { client.stop(); await camera.stop(); });
    // Manual focus moves are refused while the camera is in auto focus.
    await assert.rejects(client.command(V.focusFar(1)), /not executable/);
});

test('a silent camera times out and is marked not responding', async (t) => {
    const { camera, client } = await setup('udp-raw', { silent: true });
    t.after(async () => { client.stop(); await camera.stop(); });
    await assert.rejects(client.command(V.panTiltHome(1)), /No reply/);
    await assert.rejects(client.command(V.panTiltHome(1)), /No reply/);
    assert.equal(client.status.state, 'not-responding');
});

test('queued joystick moves collapse to the newest, and Stop jumps the queue', async (t) => {
    const { camera, client } = await setup('tcp-raw');
    t.after(async () => { client.stop(); await camera.stop(); });
    const { PAN, TILT } = V;
    const drive = (s) => V.panTiltDrive(1, { panDir: PAN.RIGHT, tiltDir: TILT.NONE, panSpeed: s, tiltSpeed: 1 });
    const busy = client.command(V.panTiltHome(1)); // in flight
    const queuedZoom = client.command(V.zoomTele(1, 2));
    const first = client.command(drive(2), { key: 'pantilt' });
    client.command(drive(3), { key: 'pantilt' });
    client.command(drive(4), { key: 'pantilt' });
    const stop = client.command(V.panTiltStop(1), { key: 'pantilt', urgent: true });
    assert.deepEqual(await first, { replaced: true });
    await Promise.all([busy, queuedZoom, stop]);
    assert.deepEqual(camera.received, [
        '81 01 06 04 FF',
        '81 01 06 01 01 01 03 03 FF',
        '81 01 04 07 22 FF',
    ]);
});

test('TCP client reconnects after the camera restarts', async (t) => {
    const camera = await new FakeCamera({ mode: 'tcp-raw' }).start();
    const port = camera.port;
    const client = new ViscaClient({
        host: '127.0.0.1', port, mode: 'tcp-raw', commandTimeoutMs: 300, heartbeatMs: 100, reconnectMinMs: 50, reconnectMaxMs: 100,
    });
    client.start();
    t.after(async () => { client.stop(); await again?.stop(); });
    let again = null;
    await waitFor(() => client.status.state === 'online');
    await camera.stop();
    await waitFor(() => client.status.state === 'offline');
    await assert.rejects(client.command(V.panTiltHome(1)), /Not connected/);
    again = await new FakeCamera({ mode: 'tcp-raw', port }).start();
    await waitFor(() => client.status.state === 'online', 3000);
    await client.command(V.panTiltHome(1));
    assert.ok(again.received.includes('81 01 06 04 FF'));
});
