// Turns joystick and slider positions into camera drive commands, and limits
// how often they are sent.
//
// Safety rules (see PLAN.md section 8):
//   - Stop is always sent at once, never delayed or dropped.
//   - A drive that is not refreshed by the window within WATCHDOG_MS is stopped
//     here, so a frozen window cannot leave a camera moving.

import { PAN, TILT } from '../visca/commands.js';

export const DEAD_ZONE = 0.12;
export const MIN_INTERVAL_MS = 100; // at most 10 drive messages per second
export const WATCHDOG_MS = 1500; // the window refreshes every 400 ms while held

export const SPEED_MIN = 0.1;
export const SPEED_MAX = 1;
export const SPEED_DEFAULT = 0.5;

export function clampSpeed(scale) {
    const n = Number(scale);
    if (!Number.isFinite(n)) return SPEED_DEFAULT;
    return Math.min(SPEED_MAX, Math.max(SPEED_MIN, n));
}

// 0 inside the dead zone, then rising to 1. Squared so small movements of the
// stick give fine control.
function curve(value) {
    const a = Math.min(1, Math.abs(Number(value) || 0));
    if (a < DEAD_ZONE) return 0;
    const t = (a - DEAD_ZONE) / (1 - DEAD_ZONE);
    return t * t;
}

function level(value, max, scale) {
    return Math.max(1, Math.round(1 + (max - 1) * curve(value) * clampSpeed(scale)));
}

// x: -1 (left) .. 1 (right), y: -1 (down) .. 1 (up).
// Returns null when the stick is in the dead zone (meaning: stop).
export function joystickToDrive({ x, y }, { speedScale, panSpeedMax, tiltSpeedMax }) {
    const cx = curve(x);
    const cy = curve(y);
    if (cx === 0 && cy === 0) return null;
    return {
        panDir: cx === 0 ? PAN.NONE : x < 0 ? PAN.LEFT : PAN.RIGHT,
        tiltDir: cy === 0 ? TILT.NONE : y > 0 ? TILT.UP : TILT.DOWN,
        panSpeed: cx === 0 ? 1 : level(x, panSpeedMax, speedScale),
        tiltSpeed: cy === 0 ? 1 : level(y, tiltSpeedMax, speedScale),
    };
}

// value: -1 (zoom out, wide) .. 1 (zoom in, tele). Speed 0..zoomSpeedMax.
export function sliderToZoom(value, { speedScale, zoomSpeedMax }) {
    const c = curve(value);
    if (c === 0) return null;
    return {
        dir: value > 0 ? 'tele' : 'wide',
        speed: Math.round(zoomSpeedMax * c * clampSpeed(speedScale)),
    };
}

// App tracking: pan/tilt -1..1 straight to VISCA speeds (no stick curve; the
// framing controller already chose the speed). Null means hold still.
export function autoToDrive({ pan = 0, tilt = 0 }, { panSpeedMax, tiltSpeedMax }) {
    if (!pan && !tilt) return null;
    const speed = (v, max) => Math.max(1, Math.round(Math.min(1, Math.abs(v)) * max));
    return {
        panDir: !pan ? PAN.NONE : pan < 0 ? PAN.LEFT : PAN.RIGHT,
        tiltDir: !tilt ? TILT.NONE : tilt > 0 ? TILT.UP : TILT.DOWN,
        panSpeed: pan ? speed(pan, panSpeedMax) : 1,
        tiltSpeed: tilt ? speed(tilt, tiltSpeedMax) : 1,
    };
}

export function autoToZoom(zoom, { zoomSpeedMax }) {
    if (!zoom) return null;
    return { dir: zoom > 0 ? 'tele' : 'wide', speed: Math.round(Math.min(1, Math.abs(zoom)) * zoomSpeedMax) };
}

export function sameDrive(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

// One continuous movement (pan/tilt, zoom or focus) on one camera.
// send(drive) and sendStop() do the actual VISCA sending.
export class DriveChannel {
    constructor({
        send,
        sendStop,
        onWatchdog = () => {},
        minIntervalMs = MIN_INTERVAL_MS,
        watchdogMs = WATCHDOG_MS,
        now = () => Date.now(),
        timers = { setTimeout, clearTimeout },
    }) {
        this.send = send;
        this.sendStop = sendStop;
        this.onWatchdog = onWatchdog;
        this.minIntervalMs = minIntervalMs;
        this.watchdogMs = watchdogMs;
        this.now = now;
        this.timers = timers;
        this.lastSent = null; // the drive the camera is doing now (null = stopped)
        this.lastSentAt = -Infinity;
        this.pending = null;
        this.pendingTimer = null;
        this.watchdogTimer = null;
    }

    get moving() {
        return this.lastSent !== null || this.pending !== null;
    }

    update(drive) {
        if (!drive) {
            // Back in the dead zone. Stop if moving; if already stopped, send
            // nothing, so resting a finger on the centre does not flood the
            // camera or delay the next real movement.
            if (this.moving) this.stop();
            else this.#clearWatchdog();
            return;
        }
        this.#armWatchdog();
        if (sameDrive(drive, this.lastSent)) {
            this.#clearPending();
            return;
        }
        const wait = this.lastSentAt + this.minIntervalMs - this.now();
        if (wait <= 0) {
            this.#clearPending();
            this.#sendNow(drive);
            return;
        }
        this.pending = drive;
        if (!this.pendingTimer) {
            this.pendingTimer = this.timers.setTimeout(() => {
                this.pendingTimer = null;
                const next = this.pending;
                this.pending = null;
                if (next) this.#sendNow(next);
            }, wait);
        }
    }

    stop() {
        this.#clearPending();
        this.#clearWatchdog();
        this.lastSent = null;
        this.lastSentAt = this.now();
        return this.sendStop();
    }

    dispose() {
        this.#clearPending();
        this.#clearWatchdog();
    }

    #sendNow(drive) {
        this.lastSent = drive;
        this.lastSentAt = this.now();
        this.send(drive);
    }

    #clearPending() {
        this.pending = null;
        if (this.pendingTimer) {
            this.timers.clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
        }
    }

    #armWatchdog() {
        this.#clearWatchdog();
        this.watchdogTimer = this.timers.setTimeout(() => {
            this.watchdogTimer = null;
            this.stop();
            this.onWatchdog();
        }, this.watchdogMs);
    }

    #clearWatchdog() {
        if (this.watchdogTimer) {
            this.timers.clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }
}
