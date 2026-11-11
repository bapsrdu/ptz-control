import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSony, RawDecoder, SonyDecoder, PAYLOAD } from '../src/main/visca/framing.js';

test('Sony header layout', () => {
    const framed = encodeSony(Buffer.from([0x81, 0x09, 0x04, 0x00, 0xff]), { type: PAYLOAD.INQUIRY, seq: 0x01020304 });
    assert.equal(framed.toString('hex'), '0110000501020304' + '81090400ff');
});

test('raw decoder splits messages and handles partial chunks', () => {
    const d = new RawDecoder();
    assert.deepEqual(d.push(Buffer.from([0x90, 0x41])), []);
    const out = d.push(Buffer.from([0xff, 0x90, 0x51, 0xff, 0x90]));
    assert.deepEqual(out.map((m) => m.payload.toString('hex')), ['9041ff', '9051ff']);
    assert.deepEqual(d.push(Buffer.from([0x50, 0x02, 0xff])).map((m) => m.payload.toString('hex')), ['905002ff']);
});

test('raw decoder skips junk before a message', () => {
    const d = new RawDecoder();
    const out = d.push(Buffer.from([0x01, 0x11, 0x00, 0x04, 0x90, 0x60, 0x02, 0xff]));
    assert.deepEqual(out.map((m) => m.payload.toString('hex')), ['906002ff']);
});

test('Sony decoder reassembles split headers and resyncs after junk', () => {
    const d = new SonyDecoder();
    const a = encodeSony(Buffer.from([0x90, 0x41, 0xff]), { type: PAYLOAD.REPLY, seq: 7 });
    const b = encodeSony(Buffer.from([0x90, 0x51, 0xff]), { type: PAYLOAD.REPLY, seq: 7 });
    const all = Buffer.concat([Buffer.from([0xaa, 0xbb]), a, b]);
    assert.deepEqual(d.push(all.subarray(0, 6)), []);
    const out = d.push(all.subarray(6));
    assert.deepEqual(out.map((m) => [m.type, m.seq, m.payload.toString('hex')]), [
        [PAYLOAD.REPLY, 7, '9041ff'],
        [PAYLOAD.REPLY, 7, '9051ff'],
    ]);
});
