// Booth Video: the Electron main process. Owns the setup file, the switcher
// connection and every camera, and answers the window over IPC (preload.cjs).
//
// Features adapted from Churchfront's CueVideo (Apache 2.0; see NOTICE),
// rewritten for Windows and Mac, VISCA cameras and RTSP preview video.

import { app, BrowserWindow, ipcMain, protocol, shell, safeStorage, clipboard } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConfigStore } from './config.js';
import { CameraManager } from '../src/main/cameras/manager.js';
import { getProfile, videoUrlFor } from '../src/main/profiles/index.js';
import { VideoService } from '../src/main/video/service.js';
import { AtemSwitcher } from '../src/main/atem/switcher.js';
import { TallySync } from '../src/main/atem/tally-sync.js';
import { FramingController } from '../src/main/tracking/framing.js';
import { findDevices } from '../src/main/tools/finder.js';

let createAtem;
if (process.env.PTZ_FAKE_ATEM) {
    const { FakeAtem } = await import('../sim/fake-atem.js');
    createAtem = () => (globalThis.ptzFakeAtem = new FakeAtem());
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Its own name and settings folder, apart from Universal PTZ Controller's
// (they share package.json when run from the source folder).
app.setName('Booth Video');
if (process.env.PTZ_USER_DATA) app.setPath('userData', process.env.PTZ_USER_DATA);
else app.setPath('userData', path.join(app.getPath('appData'), 'Booth Video'));
if (process.platform === 'win32') app.setAppUserModelId('app.boothvideo');

function logFatal(kind, error) {
    const detail = error?.stack || String(error);
    console.error(`[${kind}]`, detail);
    try {
        fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), `${new Date().toISOString()} [${kind}] ${detail}\n\n`);
    } catch {}
}
process.on('uncaughtException', (e) => logFatal('uncaughtException', e));
process.on('unhandledRejection', (e) => logFatal('unhandledRejection', e));

if (!app.requestSingleInstanceLock()) app.quit();

protocol.registerSchemesAsPrivileged([
    { scheme: 'ptz-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
const RENDERER_DIR = path.join(ROOT, 'dist-booth');
const ASSET_DIR = path.join(RENDERER_DIR, 'mediapipe');
const ASSET_TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.tflite': 'application/octet-stream', '.binarypb': 'application/octet-stream' };

let win = null;
const store = new ConfigStore(app.getPath('userData'));
const LOGIN_FILE = () => path.join(app.getPath('userData'), 'camera-login.bin');
const testWebPort = process.env.PTZ_WEB_PORT ? Number(process.env.PTZ_WEB_PORT) : null;
const video = new VideoService();
const atem = new AtemSwitcher({ createAtem });
const manager = new CameraManager({
    webPort: testWebPort,
    webLogin: () => readLogin(),
    onModeDetected: (id, mode) => store.update((c) => {
        const cam = c.cameras.find((x) => x.id === id);
        if (cam) cam.mode = mode;
        return c;
    }),
});
const tallySync = new TallySync(manager);
// Auto tracking: cameraId -> { size, controller, status }. One camera at a
// time, so the person detector does not overload the computer.
const tracking = new Map();

const camera = (id) => store.get().cameras.find((c) => c.id === id) ?? null;
const unknownCamera = { ok: false, message: 'That camera is no longer set up.' };

// --- The camera web login (BZB web page), kept out of the setup file. ---------

function readLogin() {
    const user = store.get().cameraLoginUser;
    if (!user) return null;
    try {
        const buf = fs.readFileSync(LOGIN_FILE());
        const password = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null;
        return password ? { username: user, password } : null;
    } catch {
        return null;
    }
}

function loginSaved() {
    return Boolean(store.get().cameraLoginUser) && fs.existsSync(LOGIN_FILE());
}

// --- State for the window ------------------------------------------------------

function snapshot() {
    return {
        config: store.get(),
        configPath: store.file,
        fileError: store.fileError,
        loadedAt: store.loadedAt,
        cameras: manager.statuses(),
        video: video.statuses(),
        atem: atem.view(),
        tracking: Object.fromEntries([...tracking].map(([id, t]) => [id, { size: t.size, status: t.status }])),
        loginSaved: loginSaved(),
        version: app.getVersion(),
        platform: process.platform,
    };
}

let pushTimer = null;
function pushState() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
        pushTimer = null;
        if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
    }, 16);
}

function syncCameras(config) {
    manager.sync(config.cameras);
    video.sync(config.cameras.map((c) => ({ id: c.id, url: videoUrlFor(c) })));
    for (const id of [...tracking.keys()]) if (!config.cameras.some((c) => c.id === id)) stopTracking(id);
}

// Tally lights follow the operator's M/E: red on Live, green on Next.
function refreshTally() {
    const config = store.get();
    const view = atem.view();
    const wanted = new Map();
    if (config.atemHost) {
        const me = view.connected ? view.mes[Math.min(config.me - 1, view.mes.length - 1)] : null;
        for (const c of config.cameras) {
            if (!getProfile(c.profile).features.tally) continue;
            let colour = 'off';
            if (me && c.atemInput) {
                const t = view.tally?.[c.atemInput];
                if (t ? t.program : me.program === c.atemInput) colour = 'red';
                else if (t ? t.preview : me.preview === c.atemInput) colour = 'green';
            }
            wanted.set(c.id, colour);
        }
    }
    tallySync.update(wanted);
}

store.on('change', (config) => {
    syncCameras(config);
    atem.configure({ host: config.atemHost });
    refreshTally();
    pushState();
});
atem.on('status', () => { refreshTally(); pushState(); });
atem.on('change', () => { refreshTally(); pushState(); });
atem.on('log', pushState);
manager.on('status', (id, status) => {
    if (status.state !== 'online') tallySync.forget(id);
    else refreshTally();
    pushState();
});
manager.on('notice', (id, message) => notice(id, 'info', message));
video.on('status', pushState);
video.on('frame', (cameraId, frame) => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    win.webContents.send('video:frame', cameraId, { codec: frame.codec, key: frame.key, data: frame.data });
});

function notice(cameraId, level, message) {
    if (win && !win.isDestroyed()) win.webContents.send('notice', { cameraId, level, message });
}

// --- Setup ------------------------------------------------------------------

ipcMain.handle('state:get', () => snapshot());

// The window sends the whole setup back after an edit in Setup.
ipcMain.handle('config:set', (_e, next) => {
    if (!next || typeof next !== 'object') return { ok: false, message: 'Nothing to save.' };
    store.update(() => next);
    return { ok: true };
});

ipcMain.handle('config:show', () => {
    shell.showItemInFolder(store.file);
    return { ok: true };
});

ipcMain.handle('clipboard:write', (_e, text) => {
    clipboard.writeText(String(text ?? ''));
    return { ok: true };
});

ipcMain.handle('login:save', (_e, user, password) => {
    user = String(user ?? '').trim();
    if (!user || !password) return { ok: false, message: 'Enter both the user name and the password.' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: 'This computer cannot store passwords safely.' };
    try {
        fs.writeFileSync(LOGIN_FILE(), safeStorage.encryptString(String(password)));
    } catch (err) {
        return { ok: false, message: `Could not save it: ${err.message}` };
    }
    store.update((c) => ({ ...c, cameraLoginUser: user }));
    // Reconnect the cameras so their web page connection uses the new login.
    manager.sync([]);
    syncCameras(store.get());
    pushState();
    return { ok: true };
});

ipcMain.handle('login:clear', () => {
    try { fs.rmSync(LOGIN_FILE(), { force: true }); } catch {}
    store.update((c) => ({ ...c, cameraLoginUser: '' }));
    manager.sync([]);
    syncCameras(store.get());
    pushState();
    return { ok: true };
});

let finding = null;
ipcMain.handle('tools:findDevices', async () => {
    if (finding) return finding;
    const options = process.env.PTZ_FINDER ? JSON.parse(process.env.PTZ_FINDER) : {};
    finding = findDevices(options).then((found) => ({ ok: true, ...found }), (err) => ({ ok: false, message: err.message })).finally(() => { finding = null; });
    return finding;
});

ipcMain.handle('tools:openWebPage', (_e, id) => {
    const cam = camera(id);
    if (!cam) return unknownCamera;
    shell.openExternal(`http://${cam.host}${testWebPort ? `:${testWebPort}` : ''}/`);
    return { ok: true };
});

// --- Switcher -----------------------------------------------------------------

const ATEM_COMMANDS = {
    cut: (me) => atem.cut(me),
    auto: (me) => atem.auto(me),
    preview: (input, me) => atem.setPreview(input, me),
    program: (input, me) => atem.setProgram(input, me),
    ftb: (me) => atem.fadeToBlack(me),
    position: (p, me) => atem.setPosition(p, me),
    style: (style, me) => atem.setStyle(style, me),
    selection: (bits, me) => atem.setNextSelection(bits, me),
    mixRate: (frames, me) => atem.setMixRate(frames, me),
    keyOnAir: (keyer, on, me) => atem.setKeyOnAir(keyer, on, me),
    dskOnAir: (dsk, on) => atem.setDskOnAir(dsk, on),
    dskTie: (dsk, tie) => atem.setDskTie(dsk, tie),
    dskAuto: (dsk) => atem.dskAuto(dsk),
    macro: (index) => atem.runMacro(index),
    macroStop: () => atem.stopMacro(),
    aux: (aux, source) => atem.setAuxSource(aux, source),
    stream: (on) => atem.setStreaming(on),
    record: (on) => atem.setRecording(on),
};

ipcMain.handle('atem:cmd', (_e, name, ...args) => {
    const fn = ATEM_COMMANDS[name];
    if (!fn) return { ok: false, message: 'Unknown switcher command.' };
    const clean = args.map((a) => (typeof a === 'number' || typeof a === 'boolean' ? a : Number(a)));
    return fn(...clean);
});

// A routing button: several aux changes at once. set: [{ aux (from 1), source }]
ipcMain.handle('atem:route', async (_e, set) => {
    const list = Array.isArray(set) ? set : [];
    for (const c of list) {
        const out = await atem.setAuxSource(Number(c.aux) - 1, Number(c.source));
        if (!out.ok) return out;
    }
    return { ok: true };
});

// --- Cameras ------------------------------------------------------------------

const speed = () => store.get().ptzSpeed;

ipcMain.on('ptz:move', (_e, id, v) => {
    if (!camera(id)) return;
    stopTracking(id, 'moved by hand');
    manager.move(id, v, speed());
});
ipcMain.on('ptz:stopMove', (_e, id) => manager.stopMove(id));
ipcMain.on('ptz:zoom', (_e, id, value) => {
    if (!camera(id)) return;
    // Zooming by hand keeps tracking going, and it then holds the new size.
    const t = tracking.get(id);
    if (t) t.manualZoom = true;
    manager.zoom(id, value, speed());
});
ipcMain.on('ptz:stopZoom', (_e, id) => {
    manager.stopZoom(id);
    const t = tracking.get(id);
    if (t?.manualZoom) {
        t.manualZoom = false;
        if (t.controller.scale) t.controller.framing = { ...t.controller.framing, scale: t.controller.scale };
    }
});
ipcMain.on('ptz:stopAll', () => manager.stopAll());

ipcMain.handle('ptz:focusOnce', (_e, id) => (camera(id) ? manager.focusOnce(id) : unknownCamera));
ipcMain.handle('ptz:focusMode', (_e, id, mode) => (camera(id) ? manager.focusMode(id, mode === 'manual' ? 'manual' : 'auto') : unknownCamera));
ipcMain.handle('ptz:home', (_e, id) => {
    if (!camera(id)) return unknownCamera;
    stopTracking(id);
    return manager.home(id);
});
ipcMain.handle('ptz:recallPreset', (_e, id, n) => {
    if (!camera(id)) return unknownCamera;
    stopTracking(id);
    return manager.recallPreset(id, Number(n));
});
ipcMain.handle('ptz:clearPreset', (_e, id, n) => (camera(id) ? manager.clearPreset(id, Number(n)) : unknownCamera));
ipcMain.handle('ptz:readExposure', (_e, id) => (camera(id) ? manager.readExposure(id) : unknownCamera));
ipcMain.handle('ptz:exposure', (_e, id, action) => (camera(id) ? manager.exposure(id, action) : unknownCamera));
ipcMain.handle('ptz:applyExposure', (_e, id, values) => (camera(id) ? manager.applyExposure(id, values ?? {}) : unknownCamera));

// Shots saved in the setup file: a position (pan, tilt, zoom) or an exposure.
// replacing: the id of a shot to update in place.
ipcMain.handle('shot:save', async (_e, id, { name = '', kind = 'position', replacing = null } = {}) => {
    const cam = camera(id);
    if (!cam) return unknownCamera;
    let shot;
    if (kind === 'exposure') {
        const out = await manager.readExposure(id);
        if (!out.ok || !out.values?.aeMode) return { ok: false, message: 'The camera did not report its settings, so the shot was not saved. Check it is answering and try again.' };
        shot = { kind, exposure: out.values };
    } else {
        const out = await manager.readPosition(id);
        if (!out.ok) return { ok: false, message: 'The camera did not report where it is pointing, so the shot was not saved. Check it is answering and try again.' };
        shot = { kind: 'position', ...out.position };
    }
    store.update((c) => {
        const cc = c.cameras.find((x) => x.id === id);
        if (!cc) return c;
        const existing = replacing ? cc.shots.find((s) => s.id === replacing) : null;
        if (existing) {
            Object.assign(existing, shot, { name: existing.name, id: existing.id });
        } else {
            const n = cc.shots.filter((s) => s.kind === shot.kind).length + 1;
            cc.shots.push({ ...shot, name: String(name).trim() || (kind === 'exposure' ? `Exposure ${n}` : `Shot ${n}`) });
        }
        return c;
    });
    return { ok: true };
});

ipcMain.handle('shot:go', (_e, id, shotId) => {
    const cam = camera(id);
    const shot = cam?.shots.find((s) => s.id === shotId);
    if (!shot) return unknownCamera;
    if (shot.kind === 'exposure') return manager.applyExposure(id, shot.exposure ?? {});
    stopTracking(id);
    return manager.goTo(id, shot);
});

// --- Auto tracking ----------------------------------------------------------------

function stopTracking(id, why = null) {
    if (!tracking.has(id)) return;
    tracking.delete(id);
    manager.autoStop(id);
    if (why) notice(id, 'info', `Tracking stopped: ${why}.`);
    pushState();
}

ipcMain.handle('track:start', (_e, id, { size = 'waist' } = {}) => {
    const cam = camera(id);
    if (!cam) return unknownCamera;
    if (!videoUrlFor(cam)) return { ok: false, message: 'Tracking needs this camera\'s video. Set its video address in Setup.' };
    const existing = tracking.get(id);
    if (existing) {
        existing.controller.setFraming(size);
        existing.size = size;
        pushState();
        return { ok: true };
    }
    for (const other of [...tracking.keys()]) {
        stopTracking(other);
        notice(other, 'info', `Tracking moved to ${cam.name}. It follows with one camera at a time.`);
    }
    let controller;
    try {
        controller = new FramingController({ framing: size });
    } catch {
        return { ok: false, message: 'Unknown shot size.' };
    }
    // The camera's own tracking must not steer at the same time.
    if (getProfile(cam.profile).features.tracking) manager.tracking(id, false);
    tracking.set(id, { size, controller, status: controller.status });
    pushState();
    return { ok: true };
});

ipcMain.handle('track:stop', (_e, id) => {
    stopTracking(id);
    return { ok: true };
});

ipcMain.handle('track:stopAll', () => {
    for (const id of [...tracking.keys()]) stopTracking(id);
    return { ok: true };
});

function onObservation(id, points) {
    const t = tracking.get(id);
    if (!t) return;
    const config = store.get();
    const out = t.controller.update(points && typeof points === 'object' ? points : null);
    const k = config.trackSpeed;
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    manager.autoDrive(id, {
        pan: clamp(out.pan * k),
        tilt: config.trackTilt ? clamp(out.tilt * k) : 0,
        zoom: t.manualZoom ? null : config.trackZoom ? out.zoom : 0,
    });
    if (t.status !== t.controller.status) {
        t.status = t.controller.status;
        pushState();
    }
}
ipcMain.on('track:observe', (_e, id, points) => onObservation(id, points));
ipcMain.on('track:restart', (_e, id) => {
    const t = tracking.get(id);
    if (!t) return;
    manager.autoStop(id);
    t.controller.reset();
    t.status = t.controller.status;
    pushState();
});
ipcMain.on('track:unavailable', (_e, id, message) => {
    if (!tracking.has(id)) return;
    stopTracking(id);
    notice(id, 'error', String(message || 'Tracking could not start.').slice(0, 300));
});

if (process.env.PTZ_TEST_HOOKS) globalThis.ptzTest = { observe: onObservation, store, atem };

// --- Window ---------------------------------------------------------------------

function createWindow() {
    win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 720,
        backgroundColor: '#141518',
        title: 'Booth Video',
        icon: path.join(ROOT, 'booth', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    win.removeMenu();
    win.once('ready-to-show', () => win.show());
    // Any of these can leave a joystick or arrow key "held". Stop every camera.
    win.on('blur', () => manager.stopAll());
    win.on('unresponsive', () => manager.stopAll());
    win.webContents.on('render-process-gone', () => manager.stopAll());
    win.webContents.on('did-start-navigation', () => manager.stopAll());
    win.on('closed', () => { win = null; });
    if (process.env.PTZ_DEV_URL) win.loadURL(process.env.PTZ_DEV_URL);
    else win.loadFile(path.join(RENDERER_DIR, 'index.html'));
}

app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
});

app.whenReady().then(() => {
    protocol.handle('ptz-asset', async (request) => {
        const url = new URL(request.url);
        const name = path.basename(url.pathname);
        const type = ASSET_TYPES[path.extname(name)];
        if (url.hostname !== 'mediapipe' || !type || name !== decodeURIComponent(url.pathname).replace(/^\//, '')) {
            return new Response('Not found', { status: 404 });
        }
        try {
            const body = await fs.promises.readFile(path.join(ASSET_DIR, name));
            return new Response(body, { headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' } });
        } catch {
            return new Response('Not found', { status: 404 });
        }
    });
    const config = store.load();
    syncCameras(config);
    atem.configure({ host: config.atemHost });
    refreshTally();
    createWindow();
});

// Quitting stops every camera (tracking included) before the app exits.
let quitting = false;
app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    for (const id of [...tracking.keys()]) tracking.delete(id);
    const timeout = new Promise((resolve) => setTimeout(resolve, 600));
    video.stopAll();
    store.stop();
    atem.dispose();
    Promise.race([manager.stopAll(), timeout])
        .then(() => Promise.race([manager.dispose(), timeout]))
        .finally(() => app.exit(0));
});

app.on('window-all-closed', () => app.quit());
