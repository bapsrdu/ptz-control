import test from 'node:test';
import assert from 'node:assert/strict';
import { AtemSwitcher, describeSelection } from '../src/main/atem/switcher.js';
import { FakeAtem } from '../sim/fake-atem.js';

async function connected() {
    let fake;
    const sw = new AtemSwitcher({ createAtem: () => (fake = new FakeAtem()) });
    const ready = new Promise((resolve) => sw.on('status', (s) => s.state === 'connected' && resolve()));
    sw.configure({ host: 'fake' });
    await ready;
    return { sw, fake };
}

test('commands reach the switcher and are logged', async () => {
    const { sw, fake } = await connected();
    assert.deepEqual((await sw.setPreview(5, 0)), { ok: true });
    assert.equal(fake.state.video.mixEffects[0].previewInput, 5);
    await sw.cut(0);
    assert.equal(fake.state.video.mixEffects[0].programInput, 5);
    await sw.setStyle(1, 0);
    await sw.setNextSelection(0b11, 0);
    await sw.setKeyOnAir(0, true, 0);
    await sw.setAuxSource(3, 7);
    await sw.setStreaming(true);
    const v = sw.view();
    assert.equal(v.mes[0].program, 5);
    assert.equal(v.mes[0].style, 1);
    assert.equal(v.mes[0].nextSelection, 3);
    assert.equal(v.mes[0].keys[0].onAir, true);
    assert.equal(v.aux[3], 7);
    assert.equal(v.streaming, true);
    assert.equal(v.macros.length, 2);
    assert.ok(v.busSources.includes(1) && !v.busSources.includes(10010) && !v.busSources.includes(8001));
    assert.deepEqual(sw.log.map((e) => e.command), ['CPvI', 'DCut', 'CTTp', 'CTTp', 'CKOn', 'CAuS', 'StrS']);
    assert.equal(sw.log[0].detail, 'Next on M/E 1: Input 5');
    sw.dispose();
});

test('nothing is sent while the switcher is offline, and that is logged', async () => {
    const sw = new AtemSwitcher();
    const out = await sw.cut(0);
    assert.equal(out.ok, false);
    assert.equal(sw.log[0].sent, false);
    assert.equal(sw.view().connected, false);
});

test('a transition must take something', async () => {
    const { sw } = await connected();
    assert.equal((await sw.setNextSelection(0, 0)).ok, false);
    assert.equal(describeSelection(0b101), 'background and key 2');
    sw.dispose();
});
