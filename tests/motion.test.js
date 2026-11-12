import test from 'node:test';
import assert from 'node:assert/strict';
import { joystickToDrive, sliderToZoom, DriveChannel } from '../src/main/cameras/motion.js';
import { PAN, TILT } from '../src/main/visca/commands.js';

const limits = { speedScale: 1, panSpeedMax: 0x18, tiltSpeedMax: 0x14 };

test('joystick dead zone means stop', () => {
    assert.equal(joystickToDrive({ x: 0.05, y: -0.1 }, limits), null);
});

test('joystick directions and full-speed limits', () => {
    assert.deepEqual(joystickToDrive({ x: 1, y: 0 }, limits), { panDir: PAN.RIGHT, tiltDir: TILT.NONE, panSpeed: 0x18, tiltSpeed: 1 });
    assert.deepEqual(joystickToDrive({ x: -1, y: 1 }, limits), { panDir: PAN.LEFT, tiltDir: TILT.UP, panSpeed: 0x18, tiltSpeed: 0x14 });
    assert.deepEqual(joystickToDrive({ x: 0, y: -1 }, limits), { panDir: PAN.NONE, tiltDir: TILT.DOWN, panSpeed: 1, tiltSpeed: 0x14 });
});

test('speed slider scales the top speed, and small pushes are slow', () => {
    const half = joystickToDrive({ x: 1, y: 0 }, { ...limits, speedScale: 0.5 });
    assert.equal(half.panSpeed, 13);
    const gentle = joystickToDrive({ x: 0.3, y: 0 }, limits);
    assert.ok(gentle.panSpeed <= 2, `expected a slow speed, got ${gentle.panSpeed}`);
});

test('zoom slider', () => {
    assert.equal(sliderToZoom(0.05, { speedScale: 1, zoomSpeedMax: 7 }), null);
    assert.deepEqual(sliderToZoom(1, { speedScale: 1, zoomSpeedMax: 7 }), { dir: 'tele', speed: 7 });
    assert.deepEqual(sliderToZoom(-1, { speedScale: 0.5, zoomSpeedMax: 7 }), { dir: 'wide', speed: 4 });
});

function channel(t) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const sent = [];
    const watchdogs = [];
    const ch = new DriveChannel({
        send: (d) => sent.push(d.speed),
        sendStop: () => sent.push('stop'),
        onWatchdog: () => watchdogs.push(Date.now()),
    });
    return { ch, sent, watchdogs, tick: (ms) => t.mock.timers.tick(ms) };
}

test('sends at most 10 drive messages a second, ending on the newest', (t) => {
    const { ch, sent, tick } = channel(t);
    for (let i = 1; i <= 20; i += 1) {
        ch.update({ speed: i });
        tick(10);
    }
    tick(200);
    // 200 ms of input: one at once, one per 100 ms after, and the final value.
    assert.deepEqual(sent, [1, 10, 20]);
    ch.dispose();
});

test('an unchanged position is not re-sent', (t) => {
    const { ch, sent, tick } = channel(t);
    ch.update({ speed: 5 });
    tick(150);
    ch.update({ speed: 5 });
    tick(150);
    ch.update({ speed: 5 });
    assert.deepEqual(sent, [5]);
    ch.dispose();
});

test('stop goes out at once and cancels a waiting move', (t) => {
    const { ch, sent, tick } = channel(t);
    ch.update({ speed: 1 });
    ch.update({ speed: 2 }); // waiting for the 100 ms gap
    ch.stop();
    tick(500);
    assert.deepEqual(sent, [1, 'stop']);
    assert.equal(ch.moving, false);
});

test('watchdog stops a drive that stops being refreshed', (t) => {
    const { ch, sent, watchdogs, tick } = channel(t);
    ch.update({ speed: 3 });
    tick(1000);
    ch.update({ speed: 3 }); // the window's keep-alive
    tick(1000);
    assert.deepEqual(sent, [3]);
    tick(600);
    assert.deepEqual(sent, [3, 'stop']);
    assert.equal(watchdogs.length, 1);
});

test('the dead zone sends nothing while already stopped, and the next move goes at once', (t) => {
    const { ch, sent } = channel(t);
    ch.update(null);
    ch.update(null);
    assert.deepEqual(sent, []);
    ch.update({ speed: 4 });
    assert.deepEqual(sent, [4]);
    ch.update(null);
    ch.update(null);
    assert.deepEqual(sent, [4, 'stop']);
});

test('app tracking speeds map straight to VISCA speeds', async () => {
    const { autoToDrive, autoToZoom } = await import('../src/main/cameras/motion.js');
    const lim = { panSpeedMax: 0x18, tiltSpeedMax: 0x14 };
    assert.equal(autoToDrive({ pan: 0, tilt: 0 }, lim), null);
    assert.deepEqual(autoToDrive({ pan: 0.5, tilt: 0 }, lim), { panDir: PAN.RIGHT, tiltDir: TILT.NONE, panSpeed: 12, tiltSpeed: 1 });
    assert.deepEqual(autoToDrive({ pan: -0.01, tilt: -1 }, lim), { panDir: PAN.LEFT, tiltDir: TILT.DOWN, panSpeed: 1, tiltSpeed: 0x14 });
    assert.equal(autoToZoom(0, { zoomSpeedMax: 7 }), null);
    assert.deepEqual(autoToZoom(-0.5, { zoomSpeedMax: 7 }), { dir: 'wide', speed: 4 });
});
