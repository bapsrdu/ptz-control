import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigStore, normalize } from '../booth/config.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'booth-config-'));

test('normalize fills defaults and keeps hand-written entries', () => {
    const c = normalize({
        atemHost: ' 10.0.0.5 ',
        cameras: [{ host: '10.0.0.9', atemInput: 3, shots: [{ name: 'Pulpit', pan: 10, tilt: -5, zoom: 900 }, { name: 'Bright', exposure: { aeMode: 'manual', gain: 4 } }] }],
        keys: [{ label: 'Lower thirds', keyer: 1 }, { dsk: 2 }, { label: 'bad' }],
        sources: [{ input: 1 }, { input: 1 }, { input: 'x' }],
        ptzSpeed: 9,
    });
    assert.equal(c.atemHost, '10.0.0.5');
    assert.equal(c.me, 1);
    assert.equal(c.cameras[0].name, 'Cam 1');
    assert.equal(c.cameras[0].port, 1259);
    assert.ok(c.cameras[0].id);
    assert.deepEqual(c.cameras[0].shots.map((s) => [s.kind, s.name]), [['position', 'Pulpit'], ['exposure', 'Bright']]);
    assert.deepEqual(c.keys, [{ label: 'Lower thirds', me: 1, keyer: 1 }, { label: 'Key', dsk: 2 }]);
    assert.deepEqual(c.sources, [{ input: 1 }]);
    assert.equal(c.ptzSpeed, 2);
});

test('a mistake in the file runs on the last good setup and is kept aside before saving', () => {
    const dir = tmp();
    const a = new ConfigStore(dir);
    a.load();
    a.update((c) => ({ ...c, atemHost: '10.0.0.5' }));
    a.stop();
    assert.ok(fs.existsSync(path.join(dir, 'config.last-good.json')));
    fs.writeFileSync(path.join(dir, 'config.json'), '{ "atemHost": ');
    const b = new ConfigStore(dir);
    b.load();
    assert.equal(b.get().atemHost, '10.0.0.5');
    assert.match(b.fileError, /Not valid JSON/);
    b.update((c) => ({ ...c, me: 2 }));
    b.stop();
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('config.unreadable-')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).me, 2);
    assert.equal(b.fileError, null);
});

test('hand edits are picked up', async () => {
    const dir = tmp();
    const s = new ConfigStore(dir);
    s.load();
    const changed = new Promise((resolve) => s.once('change', resolve));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ atemHost: '10.1.1.1' }));
    const keepAlive = setInterval(() => {}, 100); // the store's own timer does not hold the process open
    const c = await changed;
    clearInterval(keepAlive);
    s.stop();
    assert.equal(c.atemHost, '10.1.1.1');
});
