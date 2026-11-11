import test from 'node:test';
import assert from 'node:assert/strict';
import { AtemStateUtil, Enums } from 'atem-connection';
import { computeOnAir, keyerState } from '../src/main/atem/tally.js';

// A switcher like Raleigh's: 2 M/Es, 20 inputs, 12 outputs, 2 DSKs.
function switcher() {
    const state = AtemStateUtil.Create();
    for (let id = 1; id <= 20; id += 1) {
        state.inputs[id] = { inputId: id, longName: `In ${id}`, shortName: `${id}`, internalPortType: Enums.InternalPortType.External };
    }
    for (const id of [10010, 10011, 10020, 10021]) {
        state.inputs[id] = { inputId: id, longName: `ME ${id}`, shortName: 'ME', internalPortType: Enums.InternalPortType.MEOutput };
    }
    state.inputs[6000] = { inputId: 6000, longName: 'SuperSource', shortName: 'SSRC', internalPortType: Enums.InternalPortType.SuperSource };
    for (const me of [0, 1]) {
        const m = AtemStateUtil.getMixEffect(state, me);
        m.programInput = 1;
        m.previewInput = 2;
        m.transitionProperties.selection = [Enums.TransitionSelection.Background];
    }
    state.video.auxilliaries[0] = 1;
    state.video.auxilliaries[1] = 1;
    return state;
}

const ME2 = { type: 'me', index: 1 };
const LEFT = { type: 'aux', index: 0 };
const RIGHT = { type: 'aux', index: 1 };
const sorted = (set) => [...set].sort((a, b) => a - b);

test('one camera on M/E 2 program, another on preview', () => {
    const s = switcher();
    s.video.mixEffects[1].programInput = 4;
    s.video.mixEffects[1].previewInput = 5;
    const { live, next } = computeOnAir(s, [ME2]);
    assert.deepEqual(sorted(live), [4]);
    assert.deepEqual(sorted(next), [5]);
});

test('two different cameras sent straight to the left and right screens', () => {
    const s = switcher();
    s.video.mixEffects[1].programInput = 15;
    s.video.auxilliaries[0] = 3;
    s.video.auxilliaries[1] = 5;
    const { live } = computeOnAir(s, [ME2, LEFT, RIGHT]);
    assert.deepEqual(sorted(live), [3, 5, 15]);
});

test('a screen showing an M/E program counts what is on that M/E', () => {
    const s = switcher();
    s.video.mixEffects[1].programInput = 4;
    s.video.mixEffects[0].programInput = 3;
    s.video.auxilliaries[0] = 10010; // M/E 1 program
    const { live } = computeOnAir(s, [LEFT]);
    assert.deepEqual(sorted(live), [3]);
});

test('a camera seen only through a key is live', () => {
    const s = switcher();
    s.video.mixEffects[1].programInput = 15;
    const usk = AtemStateUtil.getUpstreamKeyer(s.video.mixEffects[1], 0);
    usk.fillSource = 5;
    usk.cutSource = 5;
    usk.mixEffectKeyType = Enums.MixEffectKeyType.DVE;
    usk.onAir = true;
    const { live } = computeOnAir(s, [ME2]);
    assert.deepEqual(sorted(live), [5, 15]);
    usk.onAir = false;
    assert.deepEqual(sorted(computeOnAir(s, [ME2]).live), [15]);
});

test('a camera inside a SuperSource box on a screen is live', () => {
    const s = switcher();
    const ssrc = AtemStateUtil.getSuperSource(s, 0);
    const box = AtemStateUtil.getSuperSourceBox(ssrc, 1);
    box.enabled = true;
    box.source = 4;
    s.video.auxilliaries[1] = 6000;
    assert.ok(computeOnAir(s, [RIGHT]).live.has(4));
});

test('during a transition both sides are live', () => {
    const s = switcher();
    s.video.mixEffects[1].programInput = 3;
    s.video.mixEffects[1].previewInput = 4;
    s.video.mixEffects[1].transitionPosition.inTransition = true;
    const { live, next } = computeOnAir(s, [ME2]);
    assert.deepEqual(sorted(live), [3, 4]);
    assert.equal(next.size, 0);
});

test('nothing watched means nothing live', () => {
    const { live, next } = computeOnAir(switcher(), []);
    assert.equal(live.size + next.size, 0);
    assert.equal(computeOnAir(null, [ME2]).live.size, 0);
});

test('lower-thirds keyer state', () => {
    const s = switcher();
    const dsk = AtemStateUtil.getDownstreamKeyer(s, 1);
    dsk.onAir = true;
    assert.deepEqual(keyerState(s, { type: 'dsk', index: 1 }), { onAir: true, inTransition: false });
    const usk = AtemStateUtil.getUpstreamKeyer(s.video.mixEffects[1], 2);
    usk.onAir = false;
    assert.deepEqual(keyerState(s, { type: 'usk', me: 1, index: 2 }), { onAir: false, inTransition: false });
    assert.equal(keyerState(s, { type: 'dsk', index: 5 }), null);
});
