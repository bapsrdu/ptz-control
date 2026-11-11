import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeCamera } from '../sim/fake-camera.js';
import { CameraManager } from '../src/main/cameras/manager.js';

function waitFor(predicate, timeoutMs = 3000) {
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

const fast = { clientOptions: { commandTimeoutMs: 300, heartbeatMs: 60000 }, detectOptions: { timeoutMs: 200 } };

test('a camera without a known transport is found and then controlled', async (t) => {
    const fake = await new FakeCamera({ mode: 'tcp-sony' }).start();
    let cameras = [{ id: 'c1', name: 'Left', host: '127.0.0.1', port: fake.port, profile: 'bzb-adamo', mode: null, presets: [] }];
    const manager = new CameraManager({
        ...fast,
        onModeDetected: (id, mode) => {
            cameras = cameras.map((c) => (c.id === id ? { ...c, mode } : c));
            manager.sync(cameras);
        },
    });
    t.after(async () => { await manager.dispose(); await fake.stop(); });
    manager.sync(cameras);
    await waitFor(() => manager.statuses().c1?.state === 'online');
    assert.equal(cameras[0].mode, 'tcp-sony');

    fake.clearLog();
    manager.move('c1', { x: 1, y: 0 }, 1);
    await waitFor(() => fake.received.length === 1);
    await manager.stopMove('c1');
    assert.deepEqual(await manager.recallPreset('c1', 4), { ok: true });
    assert.deepEqual(await manager.tracking('c1', true), { ok: true });
    assert.deepEqual(fake.received, [
        '81 01 06 01 18 01 02 03 FF',
        '81 01 06 01 01 01 03 03 FF',
        '81 01 06 01 01 01 03 03 FF',
        '81 01 04 07 00 FF',
        '81 01 04 3F 02 04 FF',
        '81 0A 01 32 00 00 02 00 FF',
    ]);
});

test('removing a moving camera sends Stop before letting go', async (t) => {
    const fake = await new FakeCamera({ mode: 'udp-raw' }).start();
    const manager = new CameraManager(fast);
    t.after(async () => { await manager.dispose(); await fake.stop(); });
    manager.sync([{ id: 'c1', name: 'Left', host: '127.0.0.1', port: fake.port, profile: 'bzb-adamo', mode: 'udp-raw', presets: [] }]);
    await waitFor(() => manager.statuses().c1?.state === 'online');
    fake.clearLog();
    manager.move('c1', { x: 0, y: -1 }, 1);
    await waitFor(() => fake.received.length === 1);
    manager.sync([]);
    await waitFor(() => fake.received.includes('81 01 06 01 01 01 03 03 FF'));
});

test('stopAll stops every camera', async (t) => {
    const fakes = await Promise.all([1, 2, 3].map(() => new FakeCamera({ mode: 'udp-sony' }).start()));
    const manager = new CameraManager(fast);
    t.after(async () => { await manager.dispose(); await Promise.all(fakes.map((f) => f.stop())); });
    manager.sync(fakes.map((f, i) => ({ id: `c${i}`, name: `Cam ${i}`, host: '127.0.0.1', port: f.port, profile: 'bzb-adamo', mode: 'udp-sony', presets: [] })));
    await waitFor(() => Object.values(manager.statuses()).every((s) => s.state === 'online'));
    fakes.forEach((f) => f.clearLog());
    await manager.stopAll();
    for (const f of fakes) assert.deepEqual(f.received, ['81 01 06 01 01 01 03 03 FF', '81 01 04 07 00 FF']);
});

test('a camera that cannot be found says why', async (t) => {
    const manager = new CameraManager(fast);
    t.after(() => manager.dispose());
    manager.sync([{ id: 'c1', name: 'Left', host: '127.0.0.1', port: 9, profile: 'bzb-adamo', mode: null, presets: [] }]);
    await waitFor(() => manager.statuses().c1?.state === 'offline', 5000);
    assert.match(manager.statuses().c1.message, /did not answer/);
    assert.match((await manager.home('c1')).message, /did not answer/);
});

test('exposure changes, reading them back, and power', async (t) => {
    const fake = await new FakeCamera({ mode: 'udp-raw' }).start();
    const manager = new CameraManager({ ...fast, clientOptions: { commandTimeoutMs: 300, heartbeatMs: 100 } });
    t.after(async () => { await manager.dispose(); await fake.stop(); });
    manager.sync([{ id: 'c1', name: 'Left', host: '127.0.0.1', port: fake.port, profile: 'bzb-adamo', mode: 'udp-raw', presets: [] }]);
    await waitFor(() => manager.statuses().c1?.power === 'on');

    assert.deepEqual(await manager.exposure('c1', { type: 'aeMode', value: 'bright' }), { ok: true });
    assert.deepEqual(await manager.exposure('c1', { type: 'step', setting: 'bright', dir: 'up' }), { ok: true });
    assert.deepEqual(await manager.exposure('c1', { type: 'backlight', value: true }), { ok: true });
    assert.deepEqual(await manager.exposure('c1', { type: 'wbMode', value: '5500K' }), { ok: true });
    assert.equal((await manager.exposure('c1', { type: 'aeMode', value: 'night' })).ok, false);
    assert.equal((await manager.exposure('c1', { type: 'rm -rf' })).ok, false);

    const read = await manager.readExposure('c1');
    assert.deepEqual(read.values, {
        aeMode: 'bright', expCompOn: false, expComp: 7, backlight: true, wbMode: '5500K', iris: 10, shutter: 8, bright: 13,
    });

    assert.deepEqual(await manager.power('c1', false), { ok: true });
    assert.equal(manager.statuses().c1.power, 'standby');
    assert.equal(fake.state.power, false);
    assert.match((await manager.home('c1')).message, /not executable/);
    await manager.power('c1', true);
    await waitFor(() => manager.statuses().c1.power === 'on');
    assert.ok(fake.received.includes('81 01 04 00 03 FF') && fake.received.includes('81 01 04 00 02 FF'));
});
