// The two ways VISCA messages are wrapped on the network.
//
// "raw":  the plain VISCA bytes, exactly as on a serial cable. Messages are
//         separated by their 0xFF terminator.
// "sony": Sony's VISCA-over-IP framing. Every message gets an 8-byte header:
//           bytes 0-1  payload type (see PAYLOAD below)
//           bytes 2-3  payload length
//           bytes 4-7  sequence number
//         followed by the plain VISCA bytes.
//
// Which one a camera expects is not documented for the BZB camera, so the app
// detects it (see detect.js) and stores the answer with the camera.

export const FRAMINGS = Object.freeze(['raw', 'sony']);

export const PAYLOAD = Object.freeze({
    COMMAND: 0x0100,
    INQUIRY: 0x0110,
    REPLY: 0x0111,
    DEVICE_SETTING: 0x0120,
    CONTROL: 0x0200,
    CONTROL_REPLY: 0x0201,
});

export const SONY_HEADER_LENGTH = 8;
// The longest VISCA message is 16 bytes. Anything claiming more is not VISCA.
const MAX_PAYLOAD = 16;

export function encodeSony(payload, { type, seq }) {
    const out = Buffer.alloc(SONY_HEADER_LENGTH + payload.length);
    out.writeUInt16BE(type, 0);
    out.writeUInt16BE(payload.length, 2);
    out.writeUInt32BE(seq >>> 0, 4);
    payload.copy(out, SONY_HEADER_LENGTH);
    return out;
}

function isKnownPayloadType(type) {
    return Object.values(PAYLOAD).includes(type);
}

// Collects bytes from a stream (TCP) or datagrams (UDP) and hands back whole
// messages. Each message is { payload: Buffer, type?: number, seq?: number }.
export class RawDecoder {
    constructor() {
        this.buffer = Buffer.alloc(0);
    }

    push(chunk) {
        this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
        const out = [];
        for (;;) {
            // A VISCA message starts with a byte that has the top bit set.
            // Drop anything before that so one stray byte cannot jam the stream.
            let start = 0;
            while (start < this.buffer.length && (this.buffer[start] & 0x80) === 0) start += 1;
            if (start > 0) this.buffer = this.buffer.subarray(start);
            const end = this.buffer.indexOf(0xff, 1);
            if (end === -1) break;
            out.push({ payload: Buffer.from(this.buffer.subarray(0, end + 1)) });
            this.buffer = this.buffer.subarray(end + 1);
        }
        if (this.buffer.length > 64) this.buffer = Buffer.alloc(0);
        return out;
    }
}

export class SonyDecoder {
    constructor() {
        this.buffer = Buffer.alloc(0);
    }

    push(chunk) {
        this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
        const out = [];
        while (this.buffer.length >= SONY_HEADER_LENGTH) {
            const type = this.buffer.readUInt16BE(0);
            const length = this.buffer.readUInt16BE(2);
            if (!isKnownPayloadType(type) || length === 0 || length > MAX_PAYLOAD) {
                // Not a header. Step forward one byte and look again.
                this.buffer = this.buffer.subarray(1);
                continue;
            }
            if (this.buffer.length < SONY_HEADER_LENGTH + length) break;
            out.push({
                type,
                seq: this.buffer.readUInt32BE(4),
                payload: Buffer.from(this.buffer.subarray(SONY_HEADER_LENGTH, SONY_HEADER_LENGTH + length)),
            });
            this.buffer = this.buffer.subarray(SONY_HEADER_LENGTH + length);
        }
        return out;
    }
}

export function createDecoder(framing) {
    if (framing === 'raw') return new RawDecoder();
    if (framing === 'sony') return new SonyDecoder();
    throw new Error(`Unknown framing ${framing}`);
}
