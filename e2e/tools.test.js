// Settings backup and the camera web page recorder, driven through the window.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { FakeCamera } from '../sim/fake-camera.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), name));

async function launch(userData, env = {}) {
    const app = await electron.launch({ args: [root, '--no-sandbox'], env: { ...process.env, PTZ_USER_DATA: userData, ...env } });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForSelector('header');
    return { app, page };
}

async function until(check, what, timeoutMs = 8000) {
    const start = Date.now();
    for (;;) {
        if (await check()) return;
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 50));
    }
}

test('settings and shot pictures go to a file and back onto a new computer', async (t) => {
    const cam = await new FakeCamera({ mode: 'udp-raw' }).start();
    t.after(() => cam.stop());

    // First computer: one camera with a shot that has a picture.
    const first = tmp('ptz-backup-a-');
    fs.writeFileSync(path.join(first, 'settings.json'), JSON.stringify({
        cameras: [{ id: 'cam-1', name: 'Left', host: '127.0.0.1', port: cam.port, mode: 'udp-raw', atemInput: 3, presets: [{ id: 'shot-1', name: 'Pulpit', number: 1, thumb: true }] }],
        atem: { host: '192.0.2.10', watched: [{ type: 'me', index: 1 }] },
    }));
    const a = await launch(first);
    // Make a real JPEG for the shot picture with the window's canvas.
    const jpeg = await a.page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 320; c.height = 180;
        const g = c.getContext('2d');
        g.fillStyle = '#e33'; g.fillRect(0, 0, 160, 180);
        g.fillStyle = '#3e3'; g.fillRect(160, 0, 160, 180);
        return c.toDataURL('image/jpeg', 0.8).split(',')[1];
    });
    fs.mkdirSync(path.join(first, 'shots'), { recursive: true });
    fs.writeFileSync(path.join(first, 'shots', 'shot-1.jpg'), Buffer.from(jpeg, 'base64'));

    const file = path.join(tmp('ptz-backup-file-'), 'backup.json');
    await a.app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
    await a.page.getByRole('button', { name: 'Settings' }).click();
    await a.page.getByTestId('app-version').getByText(/version \d+\.\d+\.\d+/).waitFor();
    await a.page.getByRole('button', { name: 'Save settings to a file' }).click();
    await a.page.getByRole('status').getByText('Settings saved to').waitFor();
    await a.app.close();

    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.kind, 'ptz-control-settings');
    assert.equal(saved.settings.cameras[0].name, 'Left');
    assert.equal(saved.settings.atem.host, '192.0.2.10');
    assert.ok(saved.pictures['shot-1'].length > 100);

    // Second computer: empty, loads the file from the welcome screen.
    const second = tmp('ptz-backup-b-');
    const b = await launch(second);
    t.after(() => b.app.close());
    await b.page.getByText('Welcome').waitFor();
    await b.app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, file);
    await b.page.getByRole('button', { name: 'Or load settings saved on another computer' }).click();
    await b.page.locator('[data-testid=camera-tile][data-state=online]').waitFor();
    await b.page.getByRole('button', { name: 'Pulpit' }).waitFor();
    // The shot's picture came across too.
    assert.equal(fs.readFileSync(path.join(second, 'shots', 'shot-1.jpg')).toString('base64'), jpeg);

    // A file that is not a settings file is refused in plain words.
    const junk = path.join(tmp('ptz-junk-'), 'junk.json');
    fs.writeFileSync(junk, '{"hello": 1}');
    await b.app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, junk);
    await b.page.getByRole('button', { name: 'Settings' }).click();
    b.page.once('dialog', (d) => d.accept());
    await b.page.getByRole('button', { name: 'Load settings from a file' }).click();
    await b.page.getByRole('alert').getByText('not a Universal PTZ Controller settings file').waitFor();
});

// --- A pretend camera web page: HTTP plus a WebSocket, like the BZB page. ----

function fakeWebPage() {
    const wsMessages = [];
    let resolveVideo;
    const videoDone = { promise: new Promise((r) => { resolveVideo = r; }), resolve: () => resolveVideo() };
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!doctype html><title>Camera</title><p>Fake camera page</p><script>
                fetch('/cgi-bin/param.cgi?get_tracking').then((r) => r.text()).then(() => {
                    const ws = new WebSocket('ws://' + location.host + '/ws');
                    ws.onopen = () => ws.send(JSON.stringify({ cmd: 'track', mode: 'presenter' }));
                });
            </script>`);
        } else if (req.url.startsWith('/cgi-bin/')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"tracking":"on","mode":"presenter"}');
        } else {
            res.writeHead(404);
            res.end();
        }
    });
    // Just enough WebSocket (RFC 6455) for one short text message each way.
    server.on('upgrade', (req, socket) => {
        const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        socket.on('data', (buf) => {
            const len = buf[1] & 0x7f;
            const mask = buf.subarray(2, 6);
            const data = Buffer.from(buf.subarray(6, 6 + len).map((b, i) => b ^ mask[i % 4])).toString();
            wsMessages.push(data);
            const reply = Buffer.from('{"result":"ok"}');
            socket.write(Buffer.concat([Buffer.from([0x81, reply.length]), reply]));
            // Then stream "video" like the BZB page does: 300 binary frames of
            // 60 KB (18 MB), which must be counted, not kept.
            const video = Buffer.alloc(60000, 0x42);
            const head = Buffer.from([0x82, 126, (video.length >> 8) & 0xff, video.length & 0xff]);
            let sent = 0;
            const pump = () => {
                while (sent < 300 && socket.write(Buffer.concat([head, video]))) sent += 1;
                if (sent < 300) socket.once('drain', () => { sent += 1; pump(); });
                else videoDone.resolve();
            };
            pump();
        });
        socket.on('error', () => {});
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, wsMessages, videoDone: videoDone.promise })));
}

test('records a camera web page, including WebSocket messages', async (t) => {
    const cam = await new FakeCamera({ mode: 'udp-raw' }).start();
    const web = await fakeWebPage();
    const dir = tmp('ptz-record-');
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
        cameras: [{ name: 'Left', host: '127.0.0.1', port: cam.port, mode: 'udp-raw' }],
    }));
    const { app, page } = await launch(dir, { PTZ_WEB_PORT: String(web.port) });
    t.after(async () => { await app.close(); await cam.stop(); web.server.close(); });

    const file = path.join(tmp('ptz-record-file-'), 'recording.json');
    await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Open and record' }).click();
    await until(() => web.wsMessages.length > 0, 'the camera page to talk over its WebSocket');
    await web.videoDone;
    await page.waitForTimeout(800);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith('Recording')).close());
    await page.getByRole('status').getByText('Recording saved to').waitFor();

    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(rec.kind, 'ptz-control-web-recording');
    const cgi = rec.entries.find((e) => e.type === 'http' && e.url.includes('/cgi-bin/param.cgi?get_tracking'));
    assert.ok(cgi, 'HTTP request recorded');
    assert.equal(cgi.status, 200);
    assert.equal(cgi.responseBody, '{"tracking":"on","mode":"presenter"}');
    const ws = rec.entries.find((e) => e.type === 'websocket');
    assert.ok(ws, 'WebSocket recorded');
    assert.deepEqual(ws.frames.filter((f) => f.opcode === 1).map((f) => [f.dir, f.data]), [
        ['sent', '{"cmd":"track","mode":"presenter"}'],
        ['received', '{"result":"ok"}'],
    ]);
    // Video frames are counted, with only a few short samples kept.
    assert.ok(ws.binaryFrames.received >= 250, `counted ${ws.binaryFrames.received} video frames`);
    assert.ok(ws.frames.filter((f) => f.opcode !== 1).length <= 5);
    assert.ok(fs.statSync(file).size < 200 * 1024, `recording is ${fs.statSync(file).size} bytes`);
});
