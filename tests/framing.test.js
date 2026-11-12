import test from 'node:test';
import assert from 'node:assert/strict';
import { FramingController, measure } from '../src/main/tracking/framing.js';

// A standing person, described by where their head top and feet are, and
// their centre line. Body proportions roughly like a real person.
function person({ x = 0.5, headTop = 0.12, feet = 0.94, visibleTo = 'feet' } = {}) {
    const h = feet - headTop;
    const at = (f) => headTop + h * f;
    const p = (px, py, vis = 0.99) => ({ x: px, y: py, visibility: vis });
    const hidden = (px, py) => p(px, py, 0.1);
    const nose = at(0.075);
    const show = { feet: 3, hips: 2, chest: 1 }[visibleTo];
    return {
        nose: p(x, nose),
        leftShoulder: p(x - 0.04, at(0.18)), rightShoulder: p(x + 0.04, at(0.18)),
        leftHip: (show >= 2 ? p : hidden)(x - 0.03, at(0.52)), rightHip: (show >= 2 ? p : hidden)(x + 0.03, at(0.52)),
        leftAnkle: (show >= 3 ? p : hidden)(x - 0.03, at(0.97)), rightAnkle: (show >= 3 ? p : hidden)(x + 0.03, at(0.97)),
    };
}

test('a well framed person needs no movement', () => {
    const c = new FramingController({ framing: 'full' });
    const out = c.update(person({ headTop: 0.08, feet: 0.94 / 0.97 * 0.97 }));
    assert.deepEqual(out, { pan: 0, tilt: 0, zoom: 0 });
    assert.equal(c.status, 'following');
});

test('person to the right: pan right; to the left: pan left', () => {
    const c = new FramingController({ framing: 'full' });
    assert.ok(c.update(person({ x: 0.75 })).pan > 0);
    c.reset();
    assert.ok(c.update(person({ x: 0.2 })).pan < 0);
});

test('small inside the dead zone: hold still, then keep going until close', () => {
    const c = new FramingController({ framing: 'full' });
    assert.equal(c.update(person({ x: 0.56 })).pan, 0, 'starting needs more than 0.08');
    assert.ok(c.update(person({ x: 0.7 })).pan > 0);
    assert.ok(c.update(person({ x: 0.56 })).pan > 0, 'once moving, continues until within 0.03');
    assert.equal(c.update(person({ x: 0.52 })).pan, 0);
});

test('too small: zoom in; too big: zoom out', () => {
    const c = new FramingController({ framing: 'full' });
    assert.ok(c.update(person({ headTop: 0.35, feet: 0.65 })).zoom > 0);
    c.reset();
    assert.ok(c.update(person({ headTop: 0.02, feet: 1.0 })).zoom < 0);
});

test('feet out of the picture in Full: zoom out', () => {
    const c = new FramingController({ framing: 'full' });
    assert.ok(c.update(person({ headTop: 0.1, feet: 1.4, visibleTo: 'hips' })).zoom < 0);
});

test('Waist frames to the hips and Close to the chest', () => {
    const waist = new FramingController({ framing: 'waist' });
    const m = measure(person({ headTop: 0.12, feet: 1.6, visibleTo: 'hips' }));
    assert.ok(m.hips.y > 0.5 && m.hips.y < 1);
    // The same person, seen to the hips: Waist wants hips near the bottom.
    const out = waist.update(person({ headTop: 0.12, feet: 1.6, visibleTo: 'hips' }));
    assert.ok(Math.abs(out.zoom) < 0.5);
    const close = new FramingController({ framing: 'close' });
    // Seen full length and small: Close wants a big zoom in.
    assert.ok(close.update(person({ headTop: 0.2, feet: 0.8 })).zoom > 0.3);
});

test('person too low in the picture: tilt down (negative tilt)', () => {
    const c = new FramingController({ framing: 'full' });
    const out = c.update(person({ headTop: 0.3, feet: 1.0 + 0.0 }));
    assert.ok(out.tilt < 0, `tilt ${out.tilt}`);
});

test('nobody found: hold still, and say so after a moment', () => {
    let t = 0;
    const c = new FramingController({ framing: 'waist', now: () => t });
    c.update(person());
    assert.equal(c.status, 'following');
    t = 500;
    assert.deepEqual(c.update(null), { pan: 0, tilt: 0, zoom: 0 });
    assert.equal(c.status, 'following', 'a brief miss is not lost');
    t = 2000;
    c.update(null);
    assert.equal(c.status, 'searching');
});

// A pretend camera that pans with a delay between moving and the picture
// showing it (video plus detection, about 0.4 s). The person walks across the
// stage and stops. The controller must catch up and settle without swinging
// back and forth.
test('follows a walking person with delayed video, without overshooting back and forth', () => {
    const dt = 0.1; // 10 frames a second
    const fov = 0.6; // radians across the picture
    const maxPanRate = 0.6; // radians per second at full speed
    const delaySteps = 4; // 0.4 s
    let cam = 0;
    const history = [];
    let t = 0;
    const c = new FramingController({ framing: 'full', now: () => t * 1000 });
    let reversals = 0;
    let lastSign = 0;
    let finalError = 1;
    for (let i = 0; i < 300; i += 1) {
        t = i * dt;
        // Walks right for 6 s at a steady pace, then stands still.
        const personAngle = t < 6 ? 0.08 * t : 0.48;
        history.push(cam);
        const seenCam = history[Math.max(0, history.length - 1 - delaySteps)];
        const x = 0.5 + (personAngle - seenCam) / fov;
        const out = c.update(person({ x, headTop: 0.08, feet: 0.9 }));
        cam += out.pan * maxPanRate * dt;
        const sign = Math.sign(out.pan);
        if (sign !== 0 && lastSign !== 0 && sign !== lastSign) reversals += 1;
        if (sign !== 0) lastSign = sign;
        finalError = Math.abs(personAngle - cam) / fov;
    }
    assert.ok(finalError < 0.05, `ends ${finalError.toFixed(3)} of a frame off centre`);
    assert.ok(reversals <= 1, `changed direction ${reversals} times`);
});
