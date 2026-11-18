import test from 'node:test';
import assert from 'node:assert/strict';
import { FramingController, FRAMINGS, measure } from '../src/main/tracking/framing.js';

// A standing person: where their eyes are, and how big (eyes to shoulders,
// as a share of the picture height). facing: -1 left, 0 camera, 1 right.
function person({ x = 0.5, eyeY = 0.29, scale = 0.21, facing = 0, eyes = true } = {}) {
    const p = (px, py, vis = 0.99) => ({ x: px, y: py, visibility: vis });
    const sh = eyeY + scale;
    const w = scale * 0.9; // half the shoulder width
    const pts = {
        nose: p(x + facing * w * 0.6, eyeY + scale * 0.2),
        leftShoulder: p(x - w, sh), rightShoulder: p(x + w, sh),
        leftHip: p(x - w * 0.7, eyeY + scale * 2.8), rightHip: p(x + w * 0.7, eyeY + scale * 2.8),
        leftAnkle: p(x - w * 0.5, eyeY + scale * 7.2), rightAnkle: p(x + w * 0.5, eyeY + scale * 7.2),
    };
    if (eyes) {
        pts.leftEye = p(x - scale * 0.15 + facing * w * 0.4, eyeY);
        pts.rightEye = p(x + scale * 0.15 + facing * w * 0.4, eyeY);
    }
    return pts;
}

// Runs the controller over time. Returns every output.
function run(c, clock, frames, pts, dtMs = 100) {
    const outs = [];
    for (let i = 0; i < frames; i += 1) {
        clock.t += dtMs;
        outs.push(c.update(typeof pts === 'function' ? pts(i) : pts));
    }
    return outs;
}

function controller(framing = 'waist') {
    const clock = { t: 0 };
    return { c: new FramingController({ framing, now: () => clock.t }), clock };
}

test('a well framed person needs no movement', () => {
    for (const name of Object.keys(FRAMINGS)) {
        const { c, clock } = controller(name);
        const f = FRAMINGS[name];
        const outs = run(c, clock, 30, person({ eyeY: f.eyeLine, scale: f.scale }));
        assert.ok(outs.every((o) => o.pan === 0 && o.tilt === 0 && o.zoom === 0), name);
        assert.equal(c.status, 'following');
    }
});

test('the size is measured from the eyes to the shoulders', () => {
    const m = measure(person({ eyeY: 0.3, scale: 0.2 }));
    assert.ok(Math.abs(m.scale - 0.2) < 1e-9);
    assert.ok(Math.abs(m.eye.y - 0.3) < 1e-9);
    // With no eyes found, the nose stands in.
    const n = measure(person({ eyeY: 0.3, scale: 0.2, eyes: false }));
    assert.ok(Math.abs(n.eye.y - 0.3) < 0.02, `eye ${n.eye.y}`);
});

test('person to the right: pan right; to the left: pan left', () => {
    let { c, clock } = controller();
    assert.ok(run(c, clock, 3, person({ x: 0.75 })).at(-1).pan > 0);
    ({ c, clock } = controller());
    assert.ok(run(c, clock, 3, person({ x: 0.2 })).at(-1).pan < 0);
});

test('moves start gently and speed up', () => {
    // Not near the edge (near the edge it may start harder).
    const { c, clock } = controller('full');
    const outs = run(c, clock, 6, person({ x: 0.68, eyeY: 0.12, scale: 0.097 }));
    assert.ok(outs[0].pan > 0 && outs[0].pan <= 0.2, `first ${outs[0].pan}`);
    for (let i = 1; i < outs.length; i += 1) assert.ok(outs[i].pan >= outs[i - 1].pan);
});

test('small drift inside the dead zone: hold still; once moving, settle close to the mark', () => {
    const { c, clock } = controller('waist');
    assert.equal(run(c, clock, 5, person({ x: 0.55 })).at(-1).pan, 0, 'a small drift is allowed');
    assert.ok(run(c, clock, 3, person({ x: 0.7 })).at(-1).pan > 0);
    assert.ok(run(c, clock, 1, person({ x: 0.55 })).at(-1).pan > 0, 'keeps going until close');
    assert.equal(run(c, clock, 5, person({ x: 0.52 })).at(-1).pan, 0);
});

test('eyes go on the upper third, not the middle', () => {
    const { c, clock } = controller('waist');
    // Eyes in the middle of the picture: tilt down (negative), so they rise.
    assert.ok(run(c, clock, 3, person({ eyeY: 0.5 })).at(-1).tilt < 0);
    const b = controller('waist');
    assert.ok(run(b.c, b.clock, 3, person({ eyeY: 0.1 })).at(-1).tilt > 0);
});

test('lead room: someone facing right sits left of centre', () => {
    const { c, clock } = controller('waist');
    // Facing right, standing in the centre: the camera pans right a little,
    // which moves them left in the picture, leaving room on their right.
    const outs = run(c, clock, 40, person({ x: 0.5, facing: 1 }));
    assert.ok(outs.some((o) => o.pan > 0), 'pans to give lead room');
    assert.ok(c.lead < -0.05, `lead ${c.lead}`);
});

test('zoom waits until the size has been wrong for a while', () => {
    const { c, clock } = controller('waist');
    const small = person({ scale: 0.1 }); // too small for Waist
    const outs = run(c, clock, 30, small);
    assert.equal(outs[5].zoom, 0, 'no zoom straight away');
    assert.ok(outs.slice(0, 14).every((o) => o.zoom === 0), 'waits 1.5 s');
    assert.ok(outs.at(-1).zoom > 0, 'then zooms in');
});

test('a brief change of size (bending, turning) does not start a zoom', () => {
    const { c, clock } = controller('waist');
    const ok = person({ scale: 0.21 });
    const outs = run(c, clock, 60, (i) => (i % 20 < 8 ? person({ scale: 0.12 }) : ok));
    assert.ok(outs.every((o) => o.zoom === 0));
});

test('no zooming back the other way straight after a zoom', () => {
    const { c, clock } = controller('waist');
    run(c, clock, 25, person({ scale: 0.1 })); // zooms in
    assert.ok(c.zooming);
    // Suddenly far too big: the zoom in stops, and a zoom out must wait 5 s.
    const outs = run(c, clock, 90, person({ scale: 0.5 }));
    const firstOut = outs.findIndex((o) => o.zoom < 0);
    assert.ok(firstOut !== -1, 'zooms out in the end');
    assert.ok(firstOut * 100 >= 5000, `zoomed out after only ${firstOut * 100} ms`);
});

test('too small: zoom in; too big: zoom out', () => {
    let { c, clock } = controller('close');
    assert.ok(run(c, clock, 30, person({ scale: 0.15 })).at(-1).zoom > 0);
    ({ c, clock } = controller('full'));
    assert.ok(run(c, clock, 30, person({ eyeY: 0.12, scale: 0.3 })).at(-1).zoom < 0);
});

test('nobody found: hold still, and say so after a moment', () => {
    const { c, clock } = controller('waist');
    assert.equal(c.status, 'looking');
    run(c, clock, 1, null);
    assert.equal(c.status, 'looking');
    run(c, clock, 3, person({ x: 0.8 }));
    assert.equal(c.status, 'following');
    assert.deepEqual(run(c, clock, 2, null).at(-1), { pan: 0, tilt: 0, zoom: 0 });
    assert.equal(c.status, 'following', 'a brief miss is not lost');
    run(c, clock, 8, null);
    assert.equal(c.status, 'searching');
    run(c, clock, 50, null);
    assert.equal(c.status, 'lost');
});

// A pretend camera that pans with a delay between moving and the picture
// showing it (video plus detection, about 0.4 s). The person walks across the
// stage and stops. The controller must keep up and settle without swinging
// back and forth.
test('follows a walking person with delayed video, without hunting', () => {
    const dt = 0.1; // 10 frames a second
    const fov = 0.6; // radians across the picture
    const maxPanRate = 0.6; // radians per second at full speed
    const delaySteps = 4; // 0.4 s
    let cam = 0;
    const history = [];
    const { c, clock } = controller('full');
    let reversals = 0;
    let lastSign = 0;
    let worst = 0;
    let finalError = 1;
    for (let i = 0; i < 300; i += 1) {
        const t = i * dt;
        // Walks right for 6 s at a steady pace, then stands still facing the camera.
        const personAngle = t < 6 ? 0.08 * t : 0.48;
        history.push(cam);
        const seenCam = history[Math.max(0, history.length - 1 - delaySteps)];
        const x = 0.5 + (personAngle - seenCam) / fov;
        worst = Math.max(worst, Math.abs(x - 0.5));
        clock.t += dt * 1000;
        const out = c.update(person({ x, eyeY: 0.12, scale: 0.097 }));
        cam += out.pan * maxPanRate * dt;
        const sign = Math.sign(out.pan);
        if (sign !== 0 && lastSign !== 0 && sign !== lastSign) reversals += 1;
        if (sign !== 0) lastSign = sign;
        finalError = Math.abs(personAngle - cam) / fov;
    }
    assert.ok(worst < 0.4, `stays in the picture (worst ${worst.toFixed(2)} from centre)`);
    assert.ok(finalError < 0.06, `ends ${finalError.toFixed(3)} of a frame off centre`);
    assert.ok(reversals <= 1, `changed direction ${reversals} times`);
});
