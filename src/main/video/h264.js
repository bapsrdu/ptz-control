// H.264 helpers: splitting the bitstream into NAL units, and rebuilding whole
// frames ("access units") from RTP packets (RFC 6184).

export const NAL = Object.freeze({ SLICE: 1, IDR: 5, SEI: 6, SPS: 7, PPS: 8, AUD: 9, STAP_A: 24, FU_A: 28 });

export function nalType(nal) {
    return nal[0] & 0x1f;
}

export function isVcl(type) {
    return type >= 1 && type <= 5;
}

// Splits an Annex B stream (00 00 01 / 00 00 00 01 start codes) into NAL units.
export function splitAnnexB(buf) {
    const out = [];
    let start = -1;
    let i = 0;
    while (i + 2 < buf.length) {
        if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
            if (start !== -1) {
                let end = i;
                if (end > start && buf[end - 1] === 0) end -= 1; // 4-byte start code
                out.push(buf.subarray(start, end));
            }
            i += 3;
            start = i;
        } else {
            i += 1;
        }
    }
    if (start !== -1 && start < buf.length) out.push(buf.subarray(start));
    return out.filter((n) => n.length > 0);
}

const START_CODE = Buffer.from([0, 0, 0, 1]);

export function toAnnexB(nals) {
    const parts = [];
    for (const nal of nals) parts.push(START_CODE, nal);
    return Buffer.concat(parts);
}

// "avc1.PPCCLL" from the SPS, as WebCodecs wants it.
export function codecString(sps) {
    const hex = (b) => b.toString(16).padStart(2, '0').toUpperCase();
    return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
}

// Rebuilds frames from the RTP payloads of one H.264 stream.
//
// push() returns finished frames: { nals, timestamp, key }. A frame is finished
// when the RTP marker bit says so or the timestamp moves on. After any lost
// packet, frames are dropped until the next key frame, so the decoder never
// sees a broken picture.
export class H264Depacketizer {
    constructor({ sps = null, pps = null } = {}) {
        this.sps = sps;
        this.pps = pps;
        this.nals = [];
        this.timestamp = null;
        this.fu = null; // NAL being reassembled from FU-A fragments
        this.lastSeq = null;
        this.broken = false;
        this.waitForKey = true;
    }

    push(payload, { seq, timestamp, marker }) {
        const out = [];
        if (this.lastSeq !== null && seq !== ((this.lastSeq + 1) & 0xffff)) {
            // Lost packet(s): this frame is damaged.
            this.broken = true;
            this.fu = null;
        }
        this.lastSeq = seq;

        if (this.timestamp !== null && timestamp !== this.timestamp && this.nals.length) {
            const frame = this.#finish();
            if (frame) out.push(frame);
        }
        this.timestamp = timestamp;

        if (payload.length) {
            const type = nalType(payload);
            if (type >= 1 && type <= 23) {
                this.#add(payload);
            } else if (type === NAL.STAP_A) {
                let i = 1;
                while (i + 2 <= payload.length) {
                    const size = payload.readUInt16BE(i);
                    i += 2;
                    if (size === 0 || i + size > payload.length) {
                        this.broken = true;
                        break;
                    }
                    this.#add(payload.subarray(i, i + size));
                    i += size;
                }
            } else if (type === NAL.FU_A && payload.length > 2) {
                const header = payload[1];
                const startBit = header & 0x80;
                const endBit = header & 0x40;
                if (startBit) {
                    const nalHeader = (payload[0] & 0xe0) | (header & 0x1f);
                    this.fu = [Buffer.from([nalHeader]), payload.subarray(2)];
                } else if (this.fu) {
                    this.fu.push(payload.subarray(2));
                } else {
                    this.broken = true; // middle of a NAL whose start we missed
                }
                if (endBit && this.fu) {
                    this.#add(Buffer.concat(this.fu));
                    this.fu = null;
                }
            }
            // Other packet types (STAP-B, MTAP, FU-B) are not used by cameras.
        }

        if (marker && this.nals.length) {
            const frame = this.#finish();
            if (frame) out.push(frame);
        }
        return out;
    }

    #add(nal) {
        const type = nalType(nal);
        if (type === NAL.SPS) this.sps = Buffer.from(nal);
        else if (type === NAL.PPS) this.pps = Buffer.from(nal);
        else if (type === NAL.AUD) return;
        this.nals.push(Buffer.from(nal));
    }

    #finish() {
        const nals = this.nals;
        const broken = this.broken;
        this.nals = [];
        this.broken = false;
        this.fu = null;
        const key = nals.some((n) => nalType(n) === NAL.IDR);
        if (!nals.some((n) => isVcl(nalType(n)))) return null; // only SPS/PPS/SEI so far
        if (broken) {
            this.waitForKey = true;
            return null;
        }
        if (this.waitForKey && !key) return null;
        if (key) {
            this.waitForKey = false;
            // Make sure every key frame carries SPS and PPS, so a decoder can
            // start from it even if they were only sent in the SDP.
            const types = new Set(nals.map(nalType));
            const prefix = [];
            if (!types.has(NAL.SPS) && this.sps) prefix.push(this.sps);
            if (!types.has(NAL.PPS) && this.pps) prefix.push(this.pps);
            nals.unshift(...prefix);
        }
        return { nals, timestamp: this.timestamp, key };
    }
}
