// App-side tracking: turns where the person is in the picture into camera
// movement, so they stay framed as Close, Waist or Full.
//
// The window finds the person (MediaPipe Pose) about 10 times a second and
// sends the key body points here. update() returns how fast to pan, tilt and
// zoom, each -1..1 (0 = hold still), which the camera manager sends through
// the same rate-limited, watchdog-protected movement path as the joystick.
//
// Points are fractions of the frame: x 0 (left) .. 1 (right), y 0 (top) .. 1.

export const FRAMINGS = Object.freeze({
    // where the top of the head and the chosen bottom line should sit
    close: { top: 0.14, bottom: 0.86, bottomAt: 'chest' },
    waist: { top: 0.12, bottom: 0.92, bottomAt: 'hips' },
    full: { top: 0.08, bottom: 0.94, bottomAt: 'feet' },
});

// Start moving when the error is bigger than START, keep going until it is
// smaller than STOP. The gap stops the camera twitching around the target.
const START = { x: 0.08, y: 0.08, zoom: 0.14 };
const STOP = { x: 0.03, y: 0.035, zoom: 0.05 };
const GAIN = { x: 2.2, y: 1.8, zoom: 1.2 };
const MAX = { x: 0.55, y: 0.45, zoom: 0.5 };
const MIN_VISIBILITY = 0.5;
const LOST_AFTER_MS = 1200;

function visible(p) {
    return p && p.visibility >= MIN_VISIBILITY && p.x >= -0.05 && p.x <= 1.05 && p.y >= -0.05 && p.y <= 1.05;
}

function mid(a, b) {
    if (visible(a) && visible(b)) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (visible(a)) return { x: a.x, y: a.y };
    if (visible(b)) return { x: b.x, y: b.y };
    return null;
}

// Body measurements from the pose. `p` holds the named points the window
// sends: nose, shoulders, hips, ankles (each { x, y, visibility }).
export function measure(p) {
    if (!p) return null;
    const nose = visible(p.nose) ? p.nose : null;
    const shoulders = mid(p.leftShoulder, p.rightShoulder);
    if (!shoulders && !nose) return null;
    const hips = mid(p.leftHip, p.rightHip);
    const feet = mid(p.leftAnkle, p.rightAnkle);
    // Head height is about the nose-to-shoulder distance.
    const neck = nose && shoulders ? Math.max(0.02, shoulders.y - nose.y) : 0.08;
    const headTop = (nose ? nose.y : shoulders.y - neck) - neck * 0.95;
    const centerX = shoulders ? shoulders.x : nose.x;
    const chest = shoulders ? shoulders.y + neck * 0.9 : null;
    return { headTop, centerX, neck, shoulders, hips, feet, chest };
}

// The line that should sit at the framing's bottom, if it can be seen or
// sensibly estimated. Null when it is out of the picture.
function bottomLine(m, framing) {
    if (framing.bottomAt === 'chest') return m.chest;
    if (framing.bottomAt === 'hips') return m.hips ? m.hips.y : null;
    if (m.feet) return m.feet.y;
    return null;
}

function axis(error, active, key) {
    const a = Math.abs(error);
    const moving = active ? a > STOP[key] : a > START[key];
    if (!moving) return { speed: 0, moving: false };
    const speed = Math.min(MAX[key], (a - STOP[key]) * GAIN[key]) * Math.sign(error);
    return { speed, moving: true };
}

export class FramingController {
    constructor({ framing = 'waist', now = () => Date.now() } = {}) {
        this.setFraming(framing);
        this.now = now;
        this.active = { x: false, y: false, zoom: false };
        this.lastSeen = -Infinity;
        this.status = 'searching';
    }

    setFraming(framing) {
        if (!FRAMINGS[framing]) throw new RangeError(`Unknown framing ${framing}`);
        this.framingName = framing;
        this.framing = FRAMINGS[framing];
    }

    reset() {
        this.active = { x: false, y: false, zoom: false };
        this.lastSeen = -Infinity;
        this.status = 'searching';
    }

    // points: the pose points, or null when nobody was found in this frame.
    // Returns { pan, tilt, zoom } (-1..1; pan + is right, tilt + is up,
    // zoom + is in) and sets this.status to 'following' | 'searching'.
    update(points) {
        const m = measure(points);
        const t = this.now();
        if (!m) {
            // Hold still. After a moment, report that we have lost them.
            this.active = { x: false, y: false, zoom: false };
            if (t - this.lastSeen > LOST_AFTER_MS) this.status = 'searching';
            return { pan: 0, tilt: 0, zoom: 0 };
        }
        this.lastSeen = t;
        this.status = 'following';
        const f = this.framing;

        // Left/right: keep the body centred.
        const x = axis(m.centerX - 0.5, this.active.x, 'x');

        // Up/down and zoom: put the head top and the bottom line where the
        // framing wants them. If the bottom line is out of the picture, frame
        // by the head alone and zoom out until the bottom line appears.
        const bottom = bottomLine(m, f);
        let yError;
        let zoomError;
        if (bottom !== null && bottom <= 1.02) {
            const want = (f.top + f.bottom) / 2;
            const have = (m.headTop + bottom) / 2;
            yError = have - want; // + means the person sits too low: tilt down
            const span = Math.max(0.02, bottom - m.headTop);
            zoomError = Math.log((f.bottom - f.top) / span); // + means too small: zoom in
        } else {
            yError = m.headTop - f.top;
            zoomError = -0.5; // cut off at the bottom: zoom out
        }
        // A head at the very top edge means zoom out too, whatever else.
        if (m.headTop < 0.01) zoomError = Math.min(zoomError, -0.4);

        const y = axis(yError, this.active.y, 'y');
        // Only zoom while the person is roughly centred, so zooming in never
        // pushes them out of the side of the picture.
        const centred = Math.abs(m.centerX - 0.5) < 0.18;
        const z = centred ? axis(zoomError, this.active.zoom, 'zoom') : { speed: 0, moving: false };

        this.active = { x: x.moving, y: y.moving, zoom: z.moving };
        // (0 - 0 is -0 in JavaScript; keep a plain 0 for "hold still".)
        return { pan: x.speed, tilt: y.speed === 0 ? 0 : -y.speed, zoom: z.speed };
    }
}
