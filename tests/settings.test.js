import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as S from '../src/main/store/settings.js';

function withCameras(...inputs) {
    let s = S.defaultSettings();
    for (const input of inputs) {
        const out = S.addCamera(s, input);
        assert.equal(out.ok, true, JSON.stringify(out.errors));
        s = out.settings;
    }
    return s;
}

test('starts with no cameras', () => {
    const s = S.defaultSettings();
    assert.deepEqual(s.cameras, []);
    assert.equal(s.ui.selectedCameraId, null);
});

test('adding a camera fills in the profile port and selects it', () => {
    const s = withCameras({ name: ' Left ', host: '192.168.1.50' });
    assert.equal(s.cameras.length, 1);
    assert.equal(s.cameras[0].name, 'Left');
    assert.equal(s.cameras[0].port, 1259);
    assert.equal(s.cameras[0].profile, 'bzb-adamo');
    assert.equal(s.cameras[0].mode, null);
    assert.equal(s.ui.selectedCameraId, s.cameras[0].id);
});

test('camera form errors are in plain words', () => {
    const s = withCameras({ name: 'Left', host: '192.168.1.50' });
    const out = S.addCamera(s, { name: 'left', host: '192.168.1', port: '70000' });
    assert.equal(out.ok, false);
    assert.match(out.errors.name, /already has this name/);
    assert.match(out.errors.host, /does not look like an IP address/);
    assert.match(out.errors.port, /1 to 65535/);
    const clash = S.addCamera(s, { name: 'Centre', host: '192.168.1.50', port: 1259 });
    assert.match(clash.errors.host, /"Left" already uses/);
    assert.equal(S.addCamera(s, { name: 'Centre', host: 'cam-centre.local' }).ok, true);
});

test('editing the address forgets the detected transport', () => {
    let s = withCameras({ name: 'Left', host: '10.0.0.5' });
    const id = s.cameras[0].id;
    s = S.setCameraMode(s, id, 'udp-sony').settings;
    assert.equal(s.cameras[0].mode, 'udp-sony');
    s = S.updateCamera(s, id, { name: 'Left side' }).settings;
    assert.equal(s.cameras[0].mode, 'udp-sony');
    s = S.updateCamera(s, id, { host: '10.0.0.6' }).settings;
    assert.equal(s.cameras[0].mode, null);
});

test('remove and reorder', () => {
    let s = withCameras({ name: 'A', host: '10.0.0.1' }, { name: 'B', host: '10.0.0.2' }, { name: 'C', host: '10.0.0.3' });
    const [a, b, c] = s.cameras.map((x) => x.id);
    s = S.moveCamera(s, c, -1).settings;
    assert.deepEqual(s.cameras.map((x) => x.name), ['A', 'C', 'B']);
    s = S.moveCamera(s, a, -1).settings;
    assert.deepEqual(s.cameras.map((x) => x.name), ['A', 'C', 'B']);
    s = S.removeCamera(s, a).settings;
    assert.deepEqual(s.cameras.map((x) => x.name), ['C', 'B']);
    assert.equal(s.ui.selectedCameraId, c);
    assert.ok(b);
});

test('shots get the lowest free preset number from 1', () => {
    let s = withCameras({ name: 'A', host: '10.0.0.1' });
    const id = s.cameras[0].id;
    const cam = () => s.cameras[0];
    assert.equal(S.nextPresetNumber(cam()), 1);
    s = S.addPreset(s, id, { name: 'Home', number: 1 }).settings;
    s = S.addPreset(s, id, { name: 'Stage', number: S.nextPresetNumber(cam()) }).settings;
    assert.deepEqual(cam().presets.map((p) => [p.name, p.number]), [['Home', 1], ['Stage', 2]]);
    s = S.removePreset(s, id, cam().presets[0].id).settings;
    assert.equal(S.nextPresetNumber(cam()), 1);
    s = S.renamePreset(s, id, cam().presets[0].id, '  Pulpit ').settings;
    assert.equal(cam().presets[0].name, 'Pulpit');
    assert.equal(S.renamePreset(s, id, cam().presets[0].id, '  ').ok, false);
});

test('loading damaged or hand-edited settings never crashes', () => {
    const s = S.normalizeSettings({
        cameras: [
            { name: 'Good', host: '10.0.0.1', port: 1259, mode: 'tcp-raw', presets: [{ name: 'x', number: 3 }, { number: 3 }, { number: 999 }] },
            { name: 'Bad host', host: 'not an ip!', port: 1259 },
            'junk',
        ],
        ui: { speed: 50, selectedCameraId: 'missing' },
    });
    assert.equal(s.cameras.length, 1);
    assert.equal(s.cameras[0].mode, 'tcp-raw');
    assert.deepEqual(s.cameras[0].presets.map((p) => p.number), [3]);
    assert.equal(s.ui.speed, 1);
    assert.equal(s.ui.selectedCameraId, s.cameras[0].id);
    assert.deepEqual(S.normalizeSettings(null), S.defaultSettings());
});

test('store saves to disk and reloads', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptz-settings-'));
    const store = new S.SettingsStore(dir);
    store.load();
    store.apply(S.addCamera, { name: 'Left', host: '10.0.0.1' });
    const again = new S.SettingsStore(dir);
    assert.equal(again.load().cameras[0].name, 'Left');
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ broken');
    assert.deepEqual(new S.SettingsStore(dir).load().cameras, []);
    assert.ok(fs.readdirSync(dir).some((f) => f.includes('broken-')));
});

test('ATEM settings: address, watched list, lower-thirds key, camera inputs', () => {
    let s = withCameras({ name: 'Left', host: '10.0.0.1', atemInput: '3' });
    assert.equal(s.cameras[0].atemInput, 3);
    assert.deepEqual(s.atem, { host: '', port: 9910, watched: [], lowerThirds: null, tally: true });

    s = S.setAtem(s, { host: '10.0.0.240' }).settings;
    assert.deepEqual(s.atem.watched, [{ type: 'me', index: 0 }], 'a new ATEM watches M/E 1');

    s = S.setAtem(s, {
        watched: [{ type: 'me', index: 1 }, { type: 'aux', index: 0 }, { type: 'aux', index: 0 }, { type: 'bad', index: 2 }],
        lowerThirds: { type: 'usk', me: 1, index: 0 },
        tally: false,
    }).settings;
    assert.deepEqual(s.atem.watched, [{ type: 'me', index: 1 }, { type: 'aux', index: 0 }]);
    assert.deepEqual(s.atem.lowerThirds, { type: 'usk', me: 1, index: 0 });
    assert.equal(s.atem.tally, false);

    assert.match(S.setAtem(s, { host: '10.0.0' }).errors.host, /IP address/);
    assert.match(S.addCamera(s, { name: 'Right', host: '10.0.0.2', atemInput: 'x' }).errors.atemInput, /number/);
    const cleared = S.updateCamera(s, s.cameras[0].id, { atemInput: '' }).settings;
    assert.equal(cleared.cameras[0].atemInput, null);
    assert.deepEqual(S.normalizeSettings({ atem: { host: 'nope nope', watched: 'x' } }).atem.watched, []);
});
