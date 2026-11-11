// VISCA command builders. Every function returns a Buffer holding one complete
// VISCA message, starting with the address byte and ending with 0xFF.
//
// Byte values come from the BG-ADAMO-4KND manual's VISCA tables (section
// "Serial Port Communication and Control"), which match standard Sony VISCA.
// Camera-specific extras (tracking, tally) live in src/main/profiles/.

export const TERMINATOR = 0xff;

// Pan/tilt direction bytes in the Pan_tiltDrive command.
export const PAN = Object.freeze({ LEFT: 0x01, RIGHT: 0x02, NONE: 0x03 });
export const TILT = Object.freeze({ UP: 0x01, DOWN: 0x02, NONE: 0x03 });

function header(address) {
    if (!Number.isInteger(address) || address < 1 || address > 7) {
        throw new RangeError(`VISCA address must be 1 to 7, got ${address}`);
    }
    return 0x80 + address;
}

function clampInt(value, min, max) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

function msg(address, ...bytes) {
    return Buffer.from([header(address), ...bytes, TERMINATOR]);
}

// Splits a 16-bit value into the four 0p 0q 0r 0s nibbles VISCA uses for positions.
function nibbles16(value) {
    const v = value & 0xffff;
    return [(v >> 12) & 0x0f, (v >> 8) & 0x0f, (v >> 4) & 0x0f, v & 0x0f];
}

// --- Pan / tilt -------------------------------------------------------------

// panSpeed 1..0x18, tiltSpeed 1..0x14 on the BZB camera. Callers pass the
// profile's limits so other cameras can use their own ranges.
export function panTiltDrive(address, { panDir, tiltDir, panSpeed, tiltSpeed, maxPan = 0x18, maxTilt = 0x14 }) {
    if (!Object.values(PAN).includes(panDir)) throw new RangeError(`Bad pan direction ${panDir}`);
    if (!Object.values(TILT).includes(tiltDir)) throw new RangeError(`Bad tilt direction ${tiltDir}`);
    return msg(
        address,
        0x01, 0x06, 0x01,
        clampInt(panSpeed, 1, maxPan),
        clampInt(tiltSpeed, 1, maxTilt),
        panDir,
        tiltDir,
    );
}

export function panTiltStop(address, { panSpeed = 1, tiltSpeed = 1 } = {}) {
    return panTiltDrive(address, {
        panDir: PAN.NONE,
        tiltDir: TILT.NONE,
        panSpeed,
        tiltSpeed,
    });
}

export function panTiltHome(address) {
    return msg(address, 0x01, 0x06, 0x04);
}

// --- Zoom -------------------------------------------------------------------

export function zoomStop(address) {
    return msg(address, 0x01, 0x04, 0x07, 0x00);
}

// speed 0 (slow) .. 7 (fast). The manual says 0..F but standard VISCA and most
// cameras only use 0..7, and 0..7 is safe on all of them.
export function zoomTele(address, speed) {
    return msg(address, 0x01, 0x04, 0x07, 0x20 | clampInt(speed, 0, 7));
}

export function zoomWide(address, speed) {
    return msg(address, 0x01, 0x04, 0x07, 0x30 | clampInt(speed, 0, 7));
}

// --- Focus ------------------------------------------------------------------

export function focusAuto(address) {
    return msg(address, 0x01, 0x04, 0x38, 0x02);
}

export function focusManual(address) {
    return msg(address, 0x01, 0x04, 0x38, 0x03);
}

export function focusStop(address) {
    return msg(address, 0x01, 0x04, 0x08, 0x00);
}

export function focusFar(address) {
    return msg(address, 0x01, 0x04, 0x08, 0x02);
}

export function focusNear(address) {
    return msg(address, 0x01, 0x04, 0x08, 0x03);
}

// --- Presets ----------------------------------------------------------------

export const PRESET_MIN = 0;
export const PRESET_MAX = 254;

function presetNumber(n) {
    if (!Number.isInteger(n) || n < PRESET_MIN || n > PRESET_MAX) {
        throw new RangeError(`Preset number must be ${PRESET_MIN} to ${PRESET_MAX}, got ${n}`);
    }
    return n;
}

export function presetClear(address, n) {
    return msg(address, 0x01, 0x04, 0x3f, 0x00, presetNumber(n));
}

export function presetSave(address, n) {
    return msg(address, 0x01, 0x04, 0x3f, 0x01, presetNumber(n));
}

export function presetRecall(address, n) {
    return msg(address, 0x01, 0x04, 0x3f, 0x02, presetNumber(n));
}

// --- Power ------------------------------------------------------------------

export function powerOn(address) {
    return msg(address, 0x01, 0x04, 0x00, 0x02);
}

export function powerStandby(address) {
    return msg(address, 0x01, 0x04, 0x00, 0x03);
}

// --- Exposure and white balance ----------------------------------------------
// From the manual's CAM_AE, CAM_ExpComp, CAM_Back Light, CAM_Iris,
// CAM_Shutter, CAM_Bright and CAM_WB tables.

export const AE_MODES = Object.freeze({ auto: 0x00, manual: 0x03, shutter: 0x0a, iris: 0x0b, bright: 0x0d });

export function aeMode(address, mode) {
    if (!(mode in AE_MODES)) throw new RangeError(`Unknown exposure mode ${mode}`);
    return msg(address, 0x01, 0x04, 0x39, AE_MODES[mode]);
}

export function expCompOn(address, on) {
    return msg(address, 0x01, 0x04, 0x3e, on ? 0x02 : 0x03);
}

// Up/down/reset for the stepped settings: exposure compensation, iris,
// shutter and brightness.
const STEP_CODES = Object.freeze({ expComp: 0x0e, iris: 0x0b, shutter: 0x0a, bright: 0x0d });
const STEP_DIRS = Object.freeze({ reset: 0x00, up: 0x02, down: 0x03 });

export function step(address, setting, dir) {
    if (!(setting in STEP_CODES)) throw new RangeError(`Unknown setting ${setting}`);
    if (!(dir in STEP_DIRS)) throw new RangeError(`Unknown direction ${dir}`);
    return msg(address, 0x01, 0x04, STEP_CODES[setting], STEP_DIRS[dir]);
}

export function backlight(address, on) {
    return msg(address, 0x01, 0x04, 0x33, on ? 0x02 : 0x03);
}

// White balance modes and their bytes (CAM_WB table).
export const WB_MODES = Object.freeze({
    auto: 0x00, '3000K': 0x01, '3500K': 0x07, '4000K': 0x02, '4500K': 0x08, '5000K': 0x04,
    '5500K': 0x09, '6000K': 0x0a, '6500K': 0x06, '7000K': 0x0b, onePush: 0x03, manual: 0x05,
});

export function wbMode(address, mode) {
    if (!(mode in WB_MODES)) throw new RangeError(`Unknown white balance ${mode}`);
    return msg(address, 0x01, 0x04, 0x35, WB_MODES[mode]);
}

// Standard VISCA "one push WB trigger": measures white now (point the camera
// at something white first). Not in the BZB manual's table: verify on site.
export function wbOnePushTrigger(address) {
    return msg(address, 0x01, 0x04, 0x10, 0x05);
}

// --- Inquiries --------------------------------------------------------------

export function powerInquiry(address) {
    return msg(address, 0x09, 0x04, 0x00);
}

export function zoomPositionInquiry(address) {
    return msg(address, 0x09, 0x04, 0x47);
}

export function panTiltPositionInquiry(address) {
    return msg(address, 0x09, 0x06, 0x12);
}

export const INQUIRIES = Object.freeze({
    aeMode: [0x04, 0x39],
    expCompOn: [0x04, 0x3e],
    expComp: [0x04, 0x4e],
    backlight: [0x04, 0x33],
    wbMode: [0x04, 0x35],
    iris: [0x04, 0x4b],
    shutter: [0x04, 0x4a],
    bright: [0x04, 0x4d],
});

export function inquiry(address, name) {
    const code = INQUIRIES[name];
    if (!code) throw new RangeError(`Unknown inquiry ${name}`);
    return msg(address, 0x09, ...code);
}

export function isInquiry(buf) {
    return buf.length >= 2 && buf[1] === 0x09;
}

// --- Replies ----------------------------------------------------------------

// Classifies one reply message from a camera.
//   ack        y0 4z FF          command accepted
//   completion y0 5z FF          command finished, or inquiry answer with data
//   error      y0 6z ee FF       ee = 02 syntax, 03 buffer full, 04 cancelled,
//                                05 no socket, 41 not executable
export function parseReply(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 3 || buf[buf.length - 1] !== TERMINATOR) {
        return { type: 'invalid' };
    }
    const first = buf[0];
    if ((first & 0x8f) !== 0x80 || first === 0x80) {
        return { type: 'invalid' };
    }
    const kind = buf[1] & 0xf0;
    if (kind === 0x40 && buf.length === 3) return { type: 'ack' };
    if (kind === 0x50) return { type: 'completion', data: buf.subarray(2, buf.length - 1) };
    if (kind === 0x60 && buf.length === 4) {
        return { type: 'error', code: buf[2], message: errorMessage(buf[2]) };
    }
    return { type: 'invalid' };
}

export function errorMessage(code) {
    switch (code) {
        case 0x01: return 'message length error';
        case 0x02: return 'syntax error';
        case 0x03: return 'command buffer full';
        case 0x04: return 'command cancelled';
        case 0x05: return 'no socket';
        case 0x41: return 'command not executable now';
        default: return `error 0x${code.toString(16).padStart(2, '0')}`;
    }
}

// Decodes the 0p 0q 0r 0s nibbles of an inquiry answer into a number.
export function decodeNibbles(data, offset = 0, count = 4) {
    let v = 0;
    for (let i = 0; i < count; i += 1) v = (v << 4) | (data[offset + i] & 0x0f);
    return v;
}

export { nibbles16 };

export function toHex(buf) {
    return Buffer.from(buf).toString('hex').toUpperCase().match(/../g)?.join(' ') ?? '';
}
