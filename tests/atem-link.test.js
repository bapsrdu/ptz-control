import test from 'node:test';
import assert from 'node:assert/strict';
import { AtemLink } from '../src/main/atem/link.js';
import { FakeAtem } from '../sim/fake-atem.js';

function waitFor(predicate, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            if (predicate()) return resolve();
            if (Date.now() - start > timeoutMs) return reject(new Error('timed out'));
            setTimeout(tick, 10);
        };
        tick();
    });
}

test('connects, describes the switcher, and only ever writes the lower-thirds key', async (t) => {
    let fake;
    const link = new AtemLink({ createAtem: () => (fake = new FakeAtem()) });
    t.after(() => link.dispose());
    assert.equal(link.status.state, 'off');
    link.configure({ host: '192.0.2.10' });
    assert.equal(link.status.state, 'connecting');
    await waitFor(() => link.connected);

    const summary = link.summary();
    assert.equal(summary.model, 'Fake ATEM 2 M/E');
    assert.equal(summary.meCount, 2);
    assert.equal(summary.outputs.length, 12);
    assert.equal(summary.dskCount, 2);
    assert.deepEqual(summary.inputs.slice(0, 2), [{ id: 1, name: 'Input 1' }, { id: 2, name: 'Input 2' }]);

    let changes = 0;
    link.on('change', () => { changes += 1; });
    fake.cut(1, 4);
    await waitFor(() => changes > 0);

    assert.deepEqual(await link.setKeyer({ type: 'dsk', index: 1 }, true), { ok: true });
    assert.deepEqual(await link.setKeyer({ type: 'usk', me: 1, index: 0 }, false), { ok: true });
    assert.match((await link.setKeyer(null, true)).message, /Choose the lower-thirds key/);
    assert.deepEqual(fake.writes, [['dsk', 1, true], ['usk', 1, 0, false]]);
    assert.equal(fake.state.video.mixEffects[1].programInput, 4, 'program untouched');
});

test('clearing the address disconnects', async (t) => {
    const link = new AtemLink({ createAtem: () => new FakeAtem() });
    t.after(() => link.dispose());
    link.configure({ host: '192.0.2.10' });
    await waitFor(() => link.connected);
    link.configure({ host: '' });
    assert.equal(link.status.state, 'off');
    assert.equal(link.state, null);
    assert.match((await link.setKeyer({ type: 'dsk', index: 0 }, true)).message, /not connected/);
});
