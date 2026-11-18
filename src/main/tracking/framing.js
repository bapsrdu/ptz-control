// App-side tracking: turns where the person is in the picture into camera
// movement, so they stay framed as Close, Waist or Full.
//
// The window finds the person (MediaPipe Pose) about 10 times a second and
// sends the key body points here. update() returns how fast to pan, tilt and
// zoom, each -1..1 (0 = hold still), which the camera manager sends through
// the same rate-limited, watchdog-protected movement path as the joystick.
//
// The framing rules follow standard broadcast practice, as worked out in
// Churchfront's CueVideo (Apache 2.0, Copyright 2026 Churchfront LLC; see
// NOTICE). Rewritten here in JavaScript for VISCA cameras, with changes:
//
// - The eyes sit on or near the upper third line, never the head in the
//   middle of the picture (on a full-length shot, higher up).
// - The shot size is measured by the head: the drop from the eyes to the
//   shoulders as a share of the picture height. It is visible in every shot
//   size and grows as the shot gets tighter.
// - Lead room: a person facing or walking one way gets more space on that
//   side, so they are not walking into the edge of the picture.
// - The camera does not chase every small move. The person can move a little
//   inside the frame; moves ease in and stop cleanly instead of hunting.
// - Near the edge of the picture the camera corrects harder.
// - The shot size is held calmly: a zoom starts only once the size has been
//   clearly wrong for 1.5 s, rests 2 s after each zoom, and never reverses
//   within 5 s, so turning, bending or nodding does not set it zooming.
//
// Points are fractions of the frame: x 0 (left) .. 1 (right), y 0 (top) .. 1.

export const FRAMINGS = Object.freeze({
    // eyeLine: where the eyes sit, down from the top. scale: eyes to
    // shoulders as a share of the picture height. leadRoom: how far off
    // centre a person facing one way sits. deadX/deadY: how far they can
    // drift before the camera moves.
    close: Object.freeze({ eyeLine: 0.29, scale: 0.36, leadRoom: 0.09, deadX: 0.08, deadY: 0.05 }),
    waist: Object.freeze({ eyeLine: 0.29, scale: 0.21, leadRoom: 0.11, deadX: 0.07, deadY: 0.05 }),
    full: Object.freeze({ eyeLine: 0.12, scale: 0.097, leadRoom: 0.13, deadX: 0.06, deadY: 0.04 }),
});

const MIN_VISIBILITY = 0.5;
const SEARCHING_AFTER_MS = 600; // a brief miss: hold still
const LOST_AFTER_MS = 5000; // a long miss: say so
const MAX = { pan: 0.7, tilt: 0.5 };
const GAIN = 1.4; // camera speed per frame of error
const ACCEL = 1.5; // how fast a move may speed up, per second
const ACCEL_URGENT = 3;
const DECEL = 3;
const WALK_PAN = 0.15; // panning this fast for WALK_MS counts as following a walk
const WALK_MS = 700;
const ZOOM = { start: 0.3, done: 0.08, waitMs: 1500, restMs: 2000, noReverseMs: 5000 };

function visible(p) {
    return p && p.visibility >= MIN_VISIBILITY && p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05;
}

function mid(a, b) {
    if (visible(a) && visible(b)) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (visible(a)) return { x: a.x, y: a.y };
    if (visible(b)) return { x: b.x, y: b.y };
    return null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Body measurements from the pose. `p` holds the named points the window
// sends: eyes, ears, nose, shoulders, hips, ankles (each { x, y, visibility }).
// Older windows send no eyes or ears; the nose stands in for the eyes.
export function measure(p) {
    if (!p) return null;
    const shoulders = mid(p.leftShoulder, p.rightShoulder);
    const nose = visible(p.nose) ? p.nose : null;
    const ears = mid(p.leftEar, p.rightEar);
    let eye = mid(p.leftEye, p.rightEye);
    if (!eye && nose) eye = { x: nose.x, y: nose.y - (shoulders ? (shoulders.y - nose.y) * 0.25 : 0.01) };
    if (!eye && ears) eye = { x: ears.x, y: ears.y };
    if (!eye && !shoulders) return null;
    const scale = eye && shoulders && shoulders.y > eye.y ? shoulders.y - eye.y : null;

    // Which way they face: the nose to one side of the shoulders (or ears).
    // +1 is towards the right of the picture.
    let facing = 0;
    const base = shoulders ?? ears;
    if (nose && base) {
        const width = visible(p.leftShoulder) && visible(p.rightShoulder)
            ? Math.abs(p.leftShoulder.x - p.rightShoulder.x)
            : 0.05;
        const d = nose.x - base.x;
        if (Math.abs(d) > Math.max(0.01, width * 0.25)) facing = Math.sign(d);
    }

    // The box around the body, for how close they are to the picture's edge.
    const all = ['nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar', 'leftShoulder', 'rightShoulder', 'leftHip', 'rightHip', 'leftAnkle', 'rightAnkle']
        .map((k) => p[k]).filter(visible);
    const xs = all.map((q) => q.x);
    const box = xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs) } : { x0: (eye ?? shoulders).x, x1: (eye ?? shoulders).x };

    return { eye, shoulders, scale, facing, box };
}

export class FramingController {
    constructor({ framing = 'waist', now = () => Date.now() } = {}) {
        this.setFraming(framing);
        this.now = now;
        this.reset();
    }

    setFraming(framing) {
        if (!FRAMINGS[framing]) throw new RangeError(`Unknown framing ${framing}`);
        if (framing !== this.framingName) this.zoomWrongSince = null;
        this.framingName = framing;
        this.framing = FRAMINGS[framing];
    }

    reset() {
        this.status = 'looking'; // until the person is first seen
        this.lastSeen = -Infinity;
        this.lastT = null;
        this.eye = null; // smoothed
        this.scale = null; // smoothed
        this.out = { pan: 0, tilt: 0 };
        this.panning = false;
        this.tilting = false;
        this.lead = 0;
        this.panDir = 0;
        this.panDirSince = 0;
        this.zooming = false;
        this.zoomDir = 0;
        this.zoomEnded = -Infinity;
        this.zoomWrongSince = null;
    }

    #hold() {
        this.out = { pan: 0, tilt: 0 };
        this.panning = false;
        this.tilting = false;
        if (this.zooming) {
            this.zooming = false;
            this.zoomEnded = this.now();
        }
        return { pan: 0, tilt: 0, zoom: 0 };
    }

    // points: the pose points, or null when nobody was found in this frame.
    // Returns { pan, tilt, zoom } (-1..1; pan + is right, tilt + is up,
    // zoom + is in) and sets this.status to 'looking' | 'following' |
    // 'searching' (a brief miss) | 'lost'.
    update(points) {
        const t = this.now();
        const dt = this.lastT === null ? 0.1 : clamp((t - this.lastT) / 1000, 0.03, 0.3);
        this.lastT = t;
        const m = measure(points);

        if (!m) {
            this.eye = null;
            if (this.status !== 'looking') {
                const gone = t - this.lastSeen;
                this.status = gone > LOST_AFTER_MS ? 'lost' : gone > SEARCHING_AFTER_MS ? 'searching' : 'following';
            }
            return this.#hold();
        }
        this.lastSeen = t;
        this.status = 'following';
        const f = this.framing;

        // Smooth out the detector's jitter: a little across, more up and down.
        const eyeNow = m.eye ?? { x: m.shoulders.x, y: m.shoulders.y - (this.scale ?? f.scale) };
        this.eye = this.eye
            ? { x: this.eye.x + (eyeNow.x - this.eye.x) * 0.6, y: this.eye.y + (eyeNow.y - this.eye.y) * 0.5 }
            : eyeNow;
        if (m.scale) this.scale = this.scale ? this.scale + (m.scale - this.scale) * 0.15 : m.scale;
        const eye = this.eye;

        // Lead room: walking one way (the camera has been panning that way a
        // while) wins over which way they face. Eased so the frame does not
        // jump when they turn.
        const dir = this.panDir !== 0 && t - this.panDirSince > WALK_MS ? this.panDir : m.facing;
        this.lead += (-dir * f.leadRoom - this.lead) * Math.min(1, 0.6 * dt);
        const markX = 0.5 + this.lead;
        const ex = eye.x - markX; // right of the mark: pan right
        const ey = f.eyeLine - eye.y; // eyes above the line: tilt up

        // How close their body is to the side they are heading for, 0
        // (comfortable) to 1 (touching it). On a tight shot (body wider than
        // half the picture) their head counts instead.
        const width = m.box.x1 - m.box.x0;
        const gap = width < 0.5 ? (ex > 0 ? 1 - m.box.x1 : m.box.x0) : (ex > 0 ? 1 - eye.x : eye.x) - 0.1;
        const urgency = clamp((0.2 - gap) / 0.2, 0, 1);

        // Move while they are off the mark; settle once they are close to it.
        if (Math.abs(ex) > f.deadX || urgency > 0) this.panning = true;
        else if (Math.abs(ex) < f.deadX * 0.5) this.panning = false;
        if (Math.abs(ey) > f.deadY) this.tilting = true;
        else if (Math.abs(ey) < f.deadY * 0.5) this.tilting = false;

        // Speed: a pull towards the mark (stronger near the edge). Speed-ups
        // are limited so moves start smoothly; slowing down is quicker.
        const rate = (e, on, prev, max) => {
            if (!on) return 0;
            const want = clamp(Math.min(2.5, GAIN * (1 + 1.5 * urgency)) * e, -max, max);
            const step = (Math.abs(want) < Math.abs(prev) || want * prev < 0 ? DECEL : urgency > 0.3 ? ACCEL_URGENT : ACCEL) * dt;
            return prev + clamp(want - prev, -step, step);
        };
        const pan = rate(ex, this.panning, this.out.pan, MAX.pan);
        const tilt = rate(ey, this.tilting, this.out.tilt, MAX.tilt);
        this.out = { pan, tilt };

        // Which way the camera is following, for lead room.
        const d = pan > WALK_PAN ? 1 : pan < -WALK_PAN ? -1 : 0;
        if (d !== this.panDir) {
            this.panDir = d;
            this.panDirSince = t;
        }

        const zoom = this.#zoom(t, ex);
        // (0 * -1 is -0 in JavaScript; keep a plain 0 for "hold still".)
        return { pan: pan || 0, tilt: tilt || 0, zoom: zoom || 0 };
    }

    // Hold the shot size calmly as they come nearer or move away.
    #zoom(t, ex) {
        if (!this.scale) {
            if (this.zooming) {
                this.zooming = false;
                this.zoomEnded = t;
            }
            return 0;
        }
        // Eyes at the very top edge: zoom out whatever the size says.
        const r = this.eye.y < 0.02 ? -0.5 : Math.log(this.framing.scale / this.scale); // + means too small: zoom in
        const dir = r > 0 ? 1 : -1;
        if (this.zooming) {
            if (Math.abs(r) < ZOOM.done || dir !== this.zoomDir) {
                this.zooming = false;
                this.zoomEnded = t;
                this.zoomWrongSince = null;
            }
        } else if (Math.abs(r) > ZOOM.start) {
            if (this.zoomWrongSince === null) this.zoomWrongSince = t;
            const rested = t - this.zoomEnded > ZOOM.restMs;
            const reversing = dir !== this.zoomDir && t - this.zoomEnded < ZOOM.noReverseMs;
            // Zooming in while they are near the side would push them out of it.
            const offSide = dir > 0 && Math.abs(ex) > 0.2;
            if (t - this.zoomWrongSince >= ZOOM.waitMs && rested && !reversing && !offSide) {
                this.zooming = true;
                this.zoomDir = dir;
            }
        } else {
            this.zoomWrongSince = null;
        }
        if (!this.zooming) return 0;
        // Faster when far off, gentle near the size.
        return dir * clamp(Math.abs(r) * 0.5, 0.1, 0.6);
    }
}
