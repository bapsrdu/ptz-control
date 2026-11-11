import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import net from 'node:net';
import { FakeCamera } from '../sim/fake-camera.js';
import { detectMode } from '../src/main/visca/detect.js';
import { MODES } from '../src/main/visca/transport.js';

for (const mode of MODES) {
    test(`finds a camera that speaks ${mode}`, async (t) => {
        const camera = await new FakeCamera({ mode }).start();
        t.after(() => camera.stop());
        const found = await detectMode({ host: '127.0.0.1', port: camera.port, timeoutMs: 300 });
        assert.equal(found.ok, true, found.message);
        assert.equal(found.mode, mode);
        assert.equal(found.poweredOn, true);
    });
}

async function freePort() {
    const s = net.createServer();
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    return port;
}

test('nothing listening gives a plain-words message', async () => {
    const port = await freePort();
    const found = await detectMode({ host: '127.0.0.1', port, timeoutMs: 200 });
    assert.equal(found.ok, false);
    assert.match(found.message, /did not answer at 127\.0\.0\.1 port \d+/);
    assert.equal(found.attempts.length, 4);
});

test('something answering with the wrong language is called out', async (t) => {
    // A UDP service that always replies with a VISCA syntax error.
    const socket = dgram.createSocket('udp4');
    await new Promise((r) => socket.bind(0, '127.0.0.1', r));
    socket.on('message', (_m, rinfo) => socket.send(Buffer.from([0x90, 0x60, 0x02, 0xff]), rinfo.port, rinfo.address));
    t.after(() => socket.close());
    const found = await detectMode({ host: '127.0.0.1', port: socket.address().port, timeoutMs: 200, modes: ['udp-sony', 'udp-raw'] });
    assert.equal(found.ok, false);
    assert.match(found.message, /did not understand the camera commands/);
});

test('an address that does not exist is called out', async () => {
    const found = await detectMode({ host: 'no-such-camera.invalid', port: 1259, timeoutMs: 200 });
    assert.equal(found.ok, false);
    assert.match(found.message, /not a known address/);
});
