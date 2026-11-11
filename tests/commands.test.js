import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../src/main/visca/commands.js';
import { bzbAdamo } from '../src/main/profiles/bzb-adamo.js';

const hex = (b) => V.toHex(b);

// Expected values are copied from the BG-ADAMO-4KND manual's VISCA tables.
test('pan/tilt drive and stop match the manual', () => {
    const { PAN, TILT } = V;
    assert.equal(hex(V.panTiltDrive(1, { panDir: PAN.NONE, tiltDir: TILT.UP, panSpeed: 5, tiltSpeed: 6 })), '81 01 06 01 05 06 03 01 FF');
    assert.equal(hex(V.panTiltDrive(1, { panDir: PAN.LEFT, tiltDir: TILT.NONE, panSpeed: 0x18, tiltSpeed: 1 })), '81 01 06 01 18 01 01 03 FF');
    assert.equal(hex(V.panTiltDrive(1, { panDir: PAN.RIGHT, tiltDir: TILT.DOWN, panSpeed: 1, tiltSpeed: 0x14 })), '81 01 06 01 01 14 02 02 FF');
    assert.equal(hex(V.panTiltStop(1)), '81 01 06 01 01 01 03 03 FF');
    assert.equal(hex(V.panTiltHome(1)), '81 01 06 04 FF');
});

test('pan/tilt speeds are clamped to the camera limits', () => {
    const d = V.panTiltDrive(1, { panDir: V.PAN.LEFT, tiltDir: V.TILT.UP, panSpeed: 99, tiltSpeed: 0 });
    assert.equal(hex(d), '81 01 06 01 18 01 01 01 FF');
    assert.throws(() => V.panTiltDrive(1, { panDir: 7, tiltDir: 3, panSpeed: 1, tiltSpeed: 1 }));
});

test('zoom, focus, preset and power commands', () => {
    assert.equal(hex(V.zoomTele(1, 7)), '81 01 04 07 27 FF');
    assert.equal(hex(V.zoomWide(1, 0)), '81 01 04 07 30 FF');
    assert.equal(hex(V.zoomTele(1, 20)), '81 01 04 07 27 FF');
    assert.equal(hex(V.zoomStop(1)), '81 01 04 07 00 FF');
    assert.equal(hex(V.focusAuto(1)), '81 01 04 38 02 FF');
    assert.equal(hex(V.focusManual(1)), '81 01 04 38 03 FF');
    assert.equal(hex(V.focusFar(1)), '81 01 04 08 02 FF');
    assert.equal(hex(V.focusNear(1)), '81 01 04 08 03 FF');
    assert.equal(hex(V.focusStop(1)), '81 01 04 08 00 FF');
    assert.equal(hex(V.presetSave(1, 5)), '81 01 04 3F 01 05 FF');
    assert.equal(hex(V.presetRecall(1, 254)), '81 01 04 3F 02 FE FF');
    assert.equal(hex(V.presetClear(1, 0)), '81 01 04 3F 00 00 FF');
    assert.throws(() => V.presetSave(1, 255));
    assert.equal(hex(V.powerOn(1)), '81 01 04 00 02 FF');
    assert.equal(hex(V.powerStandby(1)), '81 01 04 00 03 FF');
    assert.equal(hex(V.powerInquiry(1)), '81 09 04 00 FF');
    assert.equal(hex(V.panTiltPositionInquiry(1)), '81 09 06 12 FF');
});

test('address byte follows the camera address', () => {
    assert.equal(hex(V.panTiltHome(3)), '83 01 06 04 FF');
    assert.throws(() => V.panTiltHome(0));
    assert.throws(() => V.panTiltHome(8));
});

test('BZB tracking and tally bytes match the manual', () => {
    assert.equal(hex(bzbAdamo.trackingCommand(1, true)), '81 0A 01 32 00 00 02 00 FF');
    assert.equal(hex(bzbAdamo.trackingCommand(1, false)), '81 0A 01 32 00 00 03 00 FF');
    assert.deepEqual(bzbAdamo.tallyCommands(1, { red: true, green: false }).map(hex), [
        '81 01 7E 01 0A 00 02 00 FF',
        '81 01 7E 01 0A 00 00 03 FF',
    ]);
    assert.equal(bzbAdamo.previewUrl('10.0.0.5'), 'rtsp://10.0.0.5:554/live/av1');
});

test('reply parsing', () => {
    assert.deepEqual(V.parseReply(Buffer.from([0x90, 0x41, 0xff])), { type: 'ack' });
    const done = V.parseReply(Buffer.from([0x90, 0x51, 0xff]));
    assert.equal(done.type, 'completion');
    assert.equal(done.data.length, 0);
    const answer = V.parseReply(Buffer.from([0x90, 0x50, 0x02, 0xff]));
    assert.deepEqual([...answer.data], [0x02]);
    assert.deepEqual(V.parseReply(Buffer.from([0x90, 0x60, 0x02, 0xff])), { type: 'error', code: 2, message: 'syntax error' });
    assert.equal(V.parseReply(Buffer.from([0x90, 0x61, 0x41, 0xff])).message, 'command not executable now');
    assert.equal(V.parseReply(Buffer.from([0x01, 0x11, 0xff])).type, 'invalid');
    assert.equal(V.parseReply(Buffer.from([0x90, 0x41])).type, 'invalid');
    assert.equal(V.decodeNibbles([0x01, 0x02, 0x03, 0x04]), 0x1234);
});
