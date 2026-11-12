import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { BzbWeb } from '../src/main/cameras/bzb-web.js';
import { FakeBzbWeb } from '../sim/fake-bzb-web.js';

test('reads and changes tracking mode, headroom and on/off', async (t) => {
    const cam = await new FakeBzbWeb().start();
    t.after(() => cam.stop());
    const web = new BzbWeb({ host: '127.0.0.1', port: cam.port });
    assert.deepEqual(await web.getTracking(), { enabled: false, mode: 'presenter', headroom: 'low' });
    assert.deepEqual(await web.setTracking({ mode: 'zone' }), { enabled: false, mode: 'zone', headroom: 'low' });
    assert.deepEqual(await web.setTracking({ headroom: 'high', enabled: true }), { enabled: true, mode: 'zone', headroom: 'high' });
    // Exactly the commands the camera's own page sends.
    assert.deepEqual(cam.commands.filter((c) => c.SetEnv), [
        { SetEnv: { MonoTracking: { nTrackMode: 1 } } },
        { SetEnv: { MonoTracking: { nHeadRoom: 2 } } },
        { SetEnv: { MonoTracking: { bEnable: 1 } } },
    ]);
    await assert.rejects(web.setTracking({ mode: 'orbit' }), /Unknown tracking mode/);
});

test('logs in when the camera asks, with the default login', async (t) => {
    const cam = await new FakeBzbWeb({ requireLogin: true }).start();
    t.after(() => cam.stop());
    const web = new BzbWeb({ host: '127.0.0.1', port: cam.port });
    assert.equal((await web.getTracking()).mode, 'presenter');
    assert.equal(cam.loggedIn, true);
});

test('plain-words errors for a wrong login and nothing listening', async (t) => {
    const cam = await new FakeBzbWeb({ requireLogin: true, password: 'changed' }).start();
    t.after(() => cam.stop());
    await assert.rejects(new BzbWeb({ host: '127.0.0.1', port: cam.port }).getTracking(), /did not answer as expected/);

    const s = net.createServer();
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    await assert.rejects(new BzbWeb({ host: '127.0.0.1', port, timeoutMs: 500 }).getTracking(), /refused the connection|did not answer|Could not reach/);
});
