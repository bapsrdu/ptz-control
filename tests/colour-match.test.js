import test from 'node:test';
import assert from 'node:assert/strict';
import { matches, measurePixels, nextAdjustment } from '../frontend/src/colourMatch.js';
import * as V from '../src/main/visca/commands.js';

function flat(r, g, b, n = 1000) {
    const px = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i += 1) px.set([r, g, b, 255], i * 4);
    return px;
}

test('measures brightness, cast, clipping', () => {
    const neutral = measurePixels(flat(120, 120, 120));
    assert.equal(neutral.brightness, 120);
    assert.equal(neutral.cast, 'neutral');
    assert.equal(measurePixels(flat(160, 120, 90)).cast, 'warm');
    assert.equal(measurePixels(flat(90, 120, 160)).cast, 'cool');
    assert.equal(measurePixels(flat(255, 255, 255)).clipped, 100);
    assert.equal(measurePixels(flat(2, 2, 2)).crushed, 100);
    assert.equal(measurePixels(flat(2, 2, 2)).cast, null, 'too dark to tell the colour');
});

test('fine-tune: warmer target gets less red and more blue, in manual white balance', () => {
    const ref = measurePixels(flat(120, 120, 120));
    const tgt = measurePixels(flat(140, 120, 100));
    const changes = nextAdjustment(ref, tgt, { wbMode: 'auto', rGain: 128, bGain: 128, aeMode: 'auto', expCompOn: false, expComp: 7 });
    assert.deepEqual(changes[0], { type: 'wbMode', value: 'manual' });
    const r = changes.find((c) => c.setting === 'rGain');
    const b = changes.find((c) => c.setting === 'bGain');
    assert.ok(r.value < 128 && r.value >= 116, `red ${r.value}`);
    assert.ok(b.value > 128 && b.value <= 140, `blue ${b.value}`);
});

test('fine-tune: brightness by the means the exposure mode allows', () => {
    const ref = measurePixels(flat(130, 130, 130));
    const dark = measurePixels(flat(100, 100, 100));
    assert.deepEqual(nextAdjustment(ref, dark, { aeMode: 'auto', expCompOn: false, expComp: 7 }),
        [{ type: 'expCompOn', value: true }, { type: 'direct', setting: 'expComp', value: 8 }]);
    assert.deepEqual(nextAdjustment(ref, dark, { aeMode: 'manual', iris: 10 }), [{ type: 'direct', setting: 'iris', value: 11 }]);
    assert.deepEqual(nextAdjustment(dark, ref, { aeMode: 'bright', bright: 12 }), [{ type: 'direct', setting: 'bright', value: 11 }]);
    assert.deepEqual(nextAdjustment(ref, ref, { aeMode: 'auto', rGain: 1, bGain: 1 }), []);
    assert.ok(matches(ref, measurePixels(flat(132, 131, 130))));
    assert.ok(!matches(ref, dark));
});

test('VISCA direct values', () => {
    assert.equal(V.toHex(V.direct(1, 'iris', 0x11)), '81 01 04 4B 00 00 01 01 FF');
    assert.equal(V.toHex(V.direct(1, 'rGain', 200)), '81 01 04 43 00 00 0C 08 FF');
    assert.equal(V.toHex(V.direct(1, 'gain', 3)), '81 01 04 4C 00 00 00 03 FF');
    assert.throws(() => V.direct(1, 'iris', 99));
    assert.throws(() => V.direct(1, 'nope', 1));
    assert.equal(V.clampDirect('expComp', 40), 14);
    assert.equal(V.toHex(V.inquiry(1, 'bGain')), '81 09 04 44 FF');
});
