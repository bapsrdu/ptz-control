// Reads the fixed RTP header (RFC 3550) and returns the payload.
export function parseRtp(packet) {
    if (packet.length < 12 || packet[0] >> 6 !== 2) return null;
    const padding = packet[0] & 0x20;
    const extension = packet[0] & 0x10;
    const csrcCount = packet[0] & 0x0f;
    let offset = 12 + csrcCount * 4;
    if (extension) {
        if (packet.length < offset + 4) return null;
        offset += 4 + packet.readUInt16BE(offset + 2) * 4;
    }
    let end = packet.length;
    if (padding) end -= packet[packet.length - 1];
    if (offset > end) return null;
    return {
        marker: Boolean(packet[1] & 0x80),
        payloadType: packet[1] & 0x7f,
        seq: packet.readUInt16BE(2),
        timestamp: packet.readUInt32BE(4),
        payload: packet.subarray(offset, end),
    };
}

export function buildRtp({ payload, seq, timestamp, marker = false, payloadType = 96, ssrc = 0x12345678 }) {
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = (marker ? 0x80 : 0) | payloadType;
    header.writeUInt16BE(seq & 0xffff, 2);
    header.writeUInt32BE(timestamp >>> 0, 4);
    header.writeUInt32BE(ssrc >>> 0, 8);
    return Buffer.concat([header, payload]);
}
