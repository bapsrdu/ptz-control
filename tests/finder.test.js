import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { FakeCamera } from '../sim/fake-camera.js';
import { findDevices, guessProfile, hostsIn, localNetworks } from '../src/main/tools/finder.js';

test('local networks: IPv4, not loopback or self-assigned', () => {
    const nets = localNetworks({
        lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
        eth0: [{ family: 'IPv4', address: '192.168.1.23', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
        wifi: [{ family: 'IPv4', address: '169.254.3.4', internal: false }, { family: 4, address: '10.0.5.9', internal: false }],
        dup: [{ family: 'IPv4', address: '192.168.1.99', internal: false }],
    });
    assert.deepEqual(nets, ['192.168.1', '10.0.5']);
    assert.equal(hostsIn('10.0.5').length, 254);
    assert.equal(hostsIn('10.0.5')[0], '10.0.5.1');
});

test('profile guess', () => {
    assert.equal(guessProfile({ mode: 'udp-raw', port: 1259 }), 'bzb-adamo');
    assert.equal(guessProfile({ mode: 'udp-sony', port: 52381, title: 'BZBGEAR camera' }), 'bzb-adamo');
    assert.equal(guessProfile({ mode: 'udp-sony', port: 52381, title: 'Other' }), 'generic-visca');
});

for (const mode of ['udp-raw', 'udp-sony', 'tcp-raw']) {
    test(`finds a camera speaking ${mode}`, async (t) => {
        const cam = await new FakeCamera({ mode }).start();
        t.after(() => cam.stop());
        const out = await findDevices({ hosts: ['127.0.0.1'], probes: [{ mode, port: cam.port }], atemPort: 1, waitMs: 400, tcpWaitMs: 400, titles: false });
        assert.deepEqual(out.found, [{ kind: 'camera', host: '127.0.0.1', port: cam.port, mode, name: null, profile: 'generic-visca' }]);
    });
}

test('finds an ATEM by its hello, and nothing where nothing answers', async (t) => {
    const atem = dgram.createSocket('udp4');
    atem.on('message', (msg, r) => {
        if (msg[0] === 0x10 && msg[1] === 0x14) atem.send(Buffer.from([0x10, 0x14, 0x12, 0x34, 0, 0, 0, 0, 0, 0, 0, 0, 0x02, 0, 0, 0, 0, 0, 0, 0]), r.port, r.address);
    });
    await new Promise((r) => atem.bind(0, '127.0.0.1', r));
    t.after(() => atem.close());
    const out = await findDevices({ hosts: ['127.0.0.1'], probes: [{ mode: 'udp-raw', port: 9 }], atemPort: atem.address().port, waitMs: 400, titles: false });
    assert.deepEqual(out.found.map((f) => [f.kind, f.host]), [['atem', '127.0.0.1']]);
});
