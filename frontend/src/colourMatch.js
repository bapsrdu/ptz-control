// Measuring camera pictures and nudging cameras to match one another.
//
// The measurements follow Churchfront's CueVideo camera snapshots (Apache
// 2.0; see NOTICE): average colour, the colour cast from the mid-tones
// (red / green and blue / green, about 1 when neutral), brightness 0..255,
// and the share of the picture clipped to white or crushed to black.
//
// Pure functions, so they can be tested without a window.

// rgba: pixel bytes (RGBA), as from getImageData.
export function measurePixels(rgba) {
    let r = 0;
    let g = 0;
    let b = 0;
    let clipped = 0;
    let crushed = 0;
    let nr = 0;
    let ng = 0;
    let nb = 0;
    let nn = 0;
    const n = Math.floor(rgba.length / 4);
    if (!n) return null;
    for (let i = 0; i < n * 4; i += 4) {
        const R = rgba[i];
        const G = rgba[i + 1];
        const B = rgba[i + 2];
        r += R;
        g += G;
        b += B;
        const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        if (y > 250) clipped += 1;
        else if (y < 8) crushed += 1;
        if (y > 40 && y < 220) {
            nr += R;
            ng += G;
            nb += B;
            nn += 1;
        }
    }
    const out = {
        rgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
        brightness: Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) / n),
        clipped: (clipped / n) * 100,
        crushed: (crushed / n) * 100,
        rg: null,
        bg: null,
        cast: null,
    };
    if (nn > 50 && ng > 0) {
        out.rg = nr / ng;
        out.bg = nb / ng;
        out.cast = out.rg - out.bg > 0.06 ? 'warm' : out.bg - out.rg > 0.06 ? 'cool' : 'neutral';
    }
    return out;
}

// Measures a canvas (a camera's video) from a 160 x 90 copy.
export function measureCanvas(canvas, scratch) {
    if (!canvas?.width) return null;
    const c = scratch ?? document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, 160, 90);
    return measurePixels(ctx.getImageData(0, 0, 160, 90).data);
}

export const TOLERANCE = { colour: 0.02, brightness: 5 };

// How close a camera's picture is to the reference: true when it matches.
export function matches(ref, tgt) {
    if (!ref || !tgt) return false;
    const colourOk = ref.rg === null || tgt.rg === null
        || (Math.abs(ref.rg - tgt.rg) < TOLERANCE.colour && Math.abs(ref.bg - tgt.bg) < TOLERANCE.colour);
    return colourOk && Math.abs(ref.brightness - tgt.brightness) < TOLERANCE.brightness;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const COLOUR_GAIN = 120; // red/blue gain steps per 1.0 of ratio difference
const COLOUR_STEP = 12; // largest change per round

// One round of fine-tuning a camera towards the reference picture.
// settings: the target's camera settings (from readExposure).
// Returns the changes to send: [{ type: 'direct', setting, value } | other
// exposure actions], empty when it already matches.
export function nextAdjustment(ref, tgt, settings) {
    if (!ref || !tgt || !settings) return [];
    const changes = [];

    // Colour: red and blue gain, in manual white balance.
    if (ref.rg !== null && tgt.rg !== null && Number.isInteger(settings.rGain) && Number.isInteger(settings.bGain)) {
        const dr = ref.rg - tgt.rg;
        const db = ref.bg - tgt.bg;
        if (Math.abs(dr) >= TOLERANCE.colour || Math.abs(db) >= TOLERANCE.colour) {
            if (settings.wbMode !== 'manual') changes.push({ type: 'wbMode', value: 'manual' });
            const step = (d) => (Math.abs(d) < TOLERANCE.colour ? 0 : clamp(Math.round(d * COLOUR_GAIN), -COLOUR_STEP, COLOUR_STEP) || Math.sign(d));
            const r = clamp(settings.rGain + step(dr), 0, 255);
            const b = clamp(settings.bGain + step(db), 0, 255);
            if (r !== settings.rGain) changes.push({ type: 'direct', setting: 'rGain', value: r });
            if (b !== settings.bGain) changes.push({ type: 'direct', setting: 'bGain', value: b });
        }
    }

    // Brightness: one step at a time, with whatever the exposure mode allows.
    const d = ref.brightness - tgt.brightness;
    if (Math.abs(d) >= TOLERANCE.brightness) {
        const dir = Math.sign(d);
        const mode = settings.aeMode;
        if (mode === 'manual' && Number.isInteger(settings.iris)) {
            changes.push({ type: 'direct', setting: 'iris', value: clamp(settings.iris + dir, 0, 0x1f) });
        } else if (mode === 'bright' && Number.isInteger(settings.bright)) {
            changes.push({ type: 'direct', setting: 'bright', value: clamp(settings.bright + dir, 0, 0x1f) });
        } else if (mode === 'auto' || mode === 'shutter' || mode === 'iris') {
            if (!settings.expCompOn) changes.push({ type: 'expCompOn', value: true });
            const now = Number.isInteger(settings.expComp) ? settings.expComp : 7;
            const next = clamp(now + dir, 0, 14);
            if (next !== now || !settings.expCompOn) changes.push({ type: 'direct', setting: 'expComp', value: next });
        }
    }
    return changes;
}
