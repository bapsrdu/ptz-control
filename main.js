// Electron main process: owns the settings file and every camera connection,
// and answers the window's requests over IPC (see preload.cjs).

import { app, BrowserWindow, ipcMain, protocol, net } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as S from './src/main/store/settings.js';
import { CameraManager } from './src/main/cameras/manager.js';
import { detectMode } from './src/main/visca/detect.js';
import { describeProfiles, videoUrlFor, getProfile } from './src/main/profiles/index.js';
import { VideoService } from './src/main/video/service.js';
import { ShotImages } from './src/main/store/shot-images.js';
import { AtemLink } from './src/main/atem/link.js';
import { computeOnAir, keyerState } from './src/main/atem/tally.js';
import { TallySync } from './src/main/atem/tally-sync.js';

// Tests run the app against a pretend switcher.
let createAtem;
if (process.env.PTZ_FAKE_ATEM) {
    const { FakeAtem } = await import('./sim/fake-atem.js');
    createAtem = () => (globalThis.ptzFakeAtem = new FakeAtem());
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tests point this at a temporary folder so they never touch real settings.
if (process.env.PTZ_USER_DATA) app.setPath('userData', process.env.PTZ_USER_DATA);

// This runs during live services. Log unexpected errors and keep going rather
// than closing the window on the operator.
function logFatal(kind, error) {
    const detail = error?.stack || String(error);
    console.error(`[${kind}]`, detail);
    try {
        fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), `${new Date().toISOString()} [${kind}] ${detail}\n\n`);
    } catch {}
}
process.on('uncaughtException', (e) => logFatal('uncaughtException', e));
process.on('unhandledRejection', (e) => logFatal('unhandledRejection', e));

if (!app.requestSingleInstanceLock()) {
    // A second copy would fight the first over the cameras.
    app.quit();
}

// Shot pictures are shown as <img src="ptz-shot://shots/<id>.jpg">.
protocol.registerSchemesAsPrivileged([{ scheme: 'ptz-shot', privileges: { standard: true, secure: true } }]);

let win = null;
const store = new S.SettingsStore(app.getPath('userData'));
const shotImages = new ShotImages(app.getPath('userData'));
const video = new VideoService();
const atem = new AtemLink({ createAtem });
const tracking = new Map(); // cameraId -> last tracking state set from this app
const manager = new CameraManager({
    onModeDetected: (id, mode) => store.apply(S.setCameraMode, id, mode),
});

function snapshot() {
    return {
        settings: store.get(),
        statuses: manager.statuses(),
        tracking: Object.fromEntries(tracking),
        video: video.statuses(),
        atem: atemView,
        profiles: describeProfiles(),
    };
}

let pushTimer = null;
function pushState() {
    // Several changes often arrive together; send one update for them.
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
        pushTimer = null;
        if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
    }, 16);
}

function syncVideo(cameras) {
    video.sync(cameras.map((c) => ({ id: c.id, url: videoUrlFor(c) })));
}

// --- ATEM: what is live, tally lights, lower thirds ---------------------------

let atemView = { status: atem.status, summary: null, live: [], next: [], liveInputs: [], lowerThirds: null };
let atemSummary = null;
const tallySync = new TallySync(manager);

function refreshAtem({ summary = false } = {}) {
    const settings = store.get();
    const state = atem.state;
    if (summary || !atemSummary) atemSummary = atem.summary();
    if (!state) atemSummary = null;
    const { live, next } = computeOnAir(state, settings.atem.watched);
    const cameras = settings.cameras;
    atemView = {
        status: atem.status,
        summary: atemSummary,
        live: cameras.filter((c) => c.atemInput && live.has(c.atemInput)).map((c) => c.id),
        next: cameras.filter((c) => c.atemInput && next.has(c.atemInput)).map((c) => c.id),
        liveInputs: [...live].sort((a, b) => a - b),
        lowerThirds: settings.atem.lowerThirds ? keyerState(state, settings.atem.lowerThirds) : null,
    };

    // Tally lights. Leave them alone entirely if no ATEM is set up.
    const wanted = new Map();
    if (settings.atem.host) {
        const follow = settings.atem.tally && atem.connected;
        for (const c of cameras) {
            if (!getProfile(c.profile).features.tally) continue;
            const colour = !follow ? 'off' : atemView.live.includes(c.id) ? 'red' : atemView.next.includes(c.id) ? 'green' : 'off';
            wanted.set(c.id, colour);
        }
    }
    tallySync.update(wanted);
    pushState();
}

atem.on('status', () => refreshAtem({ summary: true }));
atem.on('change', () => refreshAtem({ summary: true }));

store.on('change', (settings) => {
    manager.sync(settings.cameras);
    syncVideo(settings.cameras);
    atem.configure(settings.atem);
    refreshAtem();
    for (const id of tracking.keys()) {
        if (!settings.cameras.some((c) => c.id === id)) tracking.delete(id);
    }
    pushState();
});
manager.on('status', (cameraId, status) => {
    // A camera that just came back may have forgotten its tally state.
    if (status.state !== 'online') tallySync.forget(cameraId);
    else refreshAtem();
    pushState();
});
video.on('status', pushState);
video.on('frame', (cameraId, frame) => {
    // Nobody can see a minimised window; the decoder restarts on the next key frame.
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    win.webContents.send('video:frame', cameraId, { codec: frame.codec, key: frame.key, data: frame.data });
});
manager.on('notice', (cameraId, message) => {
    if (win && !win.isDestroyed()) win.webContents.send('notice', { cameraId, message });
});

// --- Argument checks. The window is ours, but a bug there must not be able to
// send nonsense to a camera.

const isId = (v) => typeof v === 'string' && v.length > 0 && v.length < 100;
const unit = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
const speed = () => store.get().ui.speed;

function camera(id) {
    return store.get().cameras.find((c) => c.id === id) ?? null;
}

function preset(cameraId, presetId) {
    return camera(cameraId)?.presets.find((p) => p.id === presetId) ?? null;
}

const unknownCamera = { ok: false, message: 'That camera is no longer in the list.' };

// --- Camera list ------------------------------------------------------------

ipcMain.handle('state:get', () => snapshot());

ipcMain.handle('camera:add', (_e, input) => {
    const out = store.apply(S.addCamera, input ?? {});
    return out.ok ? { ok: true, camera: out.camera } : out;
});

ipcMain.handle('camera:update', (_e, id, input) => {
    if (!isId(id)) return unknownCamera;
    const out = store.apply(S.updateCamera, id, input ?? {});
    return out.ok ? { ok: true, camera: out.camera } : out;
});

ipcMain.handle('camera:remove', (_e, id) => {
    const cam = camera(id);
    if (!cam) return unknownCamera;
    const out = store.apply(S.removeCamera, id);
    if (out.ok) for (const p of cam.presets) shotImages.remove(p.id);
    return out;
});

ipcMain.handle('camera:move', (_e, id, delta) => (isId(id) ? store.apply(S.moveCamera, id, Number(delta) || 0) : unknownCamera));

// Checks the address the user typed, then looks for the camera on it.
ipcMain.handle('camera:test', async (_e, input, editingId) => {
    const check = S.validateCameraInput(
        { ...input, name: input?.name || 'Test' },
        { cameras: store.get().cameras, editingId: isId(editingId) ? editingId : null },
    );
    const fieldErrors = Object.fromEntries(Object.entries(check.errors).filter(([k]) => k === 'host' || k === 'port'));
    if (Object.keys(fieldErrors).length) return { ok: false, errors: fieldErrors, message: Object.values(fieldErrors)[0] };
    const found = await detectMode({ host: check.value.host, port: check.value.port });
    return { ...found, port: check.value.port };
});

ipcMain.handle('ui:set', (_e, patch) => store.apply(S.setUi, patch ?? {}));

ipcMain.handle('atem:set', (_e, patch) => store.apply(S.setAtem, patch ?? {}));

// The one write this app makes to the ATEM.
ipcMain.handle('atem:lowerThirds', (_e, on) => atem.setKeyer(store.get().atem.lowerThirds, Boolean(on)));

// --- Movement ---------------------------------------------------------------

ipcMain.on('ptz:move', (_e, id, v) => {
    if (isId(id)) manager.move(id, { x: unit(v?.x), y: unit(v?.y) }, speed());
});
ipcMain.on('ptz:stopMove', (_e, id) => {
    if (isId(id)) manager.stopMove(id);
});
ipcMain.on('ptz:zoom', (_e, id, value) => {
    if (isId(id)) manager.zoom(id, unit(value), speed());
});
ipcMain.on('ptz:stopZoom', (_e, id) => {
    if (isId(id)) manager.stopZoom(id);
});
ipcMain.on('ptz:focus', (_e, id, dir) => {
    if (isId(id)) manager.focus(id, dir === 'near' || dir === 'far' ? dir : null);
});
ipcMain.on('ptz:stopAll', () => manager.stopAll());

ipcMain.handle('ptz:home', (_e, id) => (camera(id) ? manager.home(id) : unknownCamera));

ipcMain.handle('ptz:focusMode', (_e, id, mode) => {
    if (!camera(id)) return unknownCamera;
    return manager.focusMode(id, mode === 'manual' ? 'manual' : 'auto');
});

ipcMain.handle('ptz:tracking', async (_e, id, on) => {
    if (!camera(id)) return unknownCamera;
    const out = await manager.tracking(id, Boolean(on));
    if (out.ok) {
        tracking.set(id, Boolean(on));
        pushState();
    }
    return out;
});

// --- Shots ------------------------------------------------------------------

// Saves the camera's current position into the camera first, and only keeps
// the shot in the list if the camera accepted it.
ipcMain.handle('preset:save', async (_e, cameraId, name, picture) => {
    const cam = camera(cameraId);
    if (!cam) return unknownCamera;
    const number = S.nextPresetNumber(cam);
    if (number === null) return { ok: false, message: `${cam.name} has no free preset slots left. Delete a shot first.` };
    const sent = await manager.savePreset(cameraId, number);
    if (!sent.ok) return { ok: false, message: `The shot was not saved: ${sent.message}` };
    const out = store.apply(S.addPreset, cameraId, { name, number });
    if (!out.ok) return { ok: false, message: Object.values(out.errors)[0] };
    // The picture is a nice-to-have: a shot without one still works.
    if (picture && shotImages.save(out.preset.id, picture)) {
        store.apply(S.setPresetThumb, cameraId, out.preset.id, true);
    }
    return { ok: true, preset: out.preset };
});

ipcMain.handle('preset:recall', (_e, cameraId, presetId) => {
    const p = preset(cameraId, presetId);
    if (!p) return { ok: false, message: 'That shot no longer exists.' };
    return manager.recallPreset(cameraId, p.number);
});

ipcMain.handle('preset:rename', (_e, cameraId, presetId, name) => {
    const out = store.apply(S.renamePreset, cameraId, presetId, name);
    return out.ok ? { ok: true } : { ok: false, message: Object.values(out.errors)[0] };
});

ipcMain.handle('preset:delete', async (_e, cameraId, presetId) => {
    const p = preset(cameraId, presetId);
    if (!p) return { ok: false, message: 'That shot no longer exists.' };
    // Clearing it in the camera is tidy but not essential; an offline camera
    // must not stop the user removing a shot from the list.
    await manager.clearPreset(cameraId, p.number);
    const out = store.apply(S.removePreset, cameraId, presetId);
    if (out.ok) shotImages.remove(presetId);
    return out.ok ? { ok: true } : { ok: false, message: Object.values(out.errors)[0] };
});

// --- Window -----------------------------------------------------------------

function createWindow() {
    win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 1000,
        minHeight: 700,
        backgroundColor: '#0f1115',
        title: 'PTZ Control',
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

    // Any of these can leave a joystick "held". Stop every camera.
    win.on('blur', () => manager.stopAll());
    win.on('unresponsive', () => manager.stopAll());
    win.webContents.on('render-process-gone', () => manager.stopAll());
    win.webContents.on('did-start-navigation', () => manager.stopAll());
    win.on('closed', () => { win = null; });

    if (process.env.PTZ_DEV_URL) win.loadURL(process.env.PTZ_DEV_URL);
    else win.loadFile(path.join(__dirname, 'dist-renderer', 'index.html'));
}

app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
});

app.whenReady().then(() => {
    protocol.handle('ptz-shot', (request) => {
        const name = new URL(request.url).pathname.replace(/^\//, '').replace(/\.jpg$/, '');
        const file = shotImages.file(name);
        if (!file) return new Response('Not found', { status: 404 });
        return net.fetch(pathToFileURL(file).toString());
    });
    store.load();
    manager.sync(store.get().cameras);
    syncVideo(store.get().cameras);
    atem.configure(store.get().atem);
    refreshAtem();
    createWindow();
});

// Make sure every camera has been told to stop before the app exits.
let quitting = false;
app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    const timeout = new Promise((resolve) => setTimeout(resolve, 600));
    video.stopAll();
    atem.dispose();
    Promise.race([manager.stopAll(), timeout])
        .then(() => Promise.race([manager.dispose(), timeout]))
        .finally(() => app.exit(0));
});

app.on('window-all-closed', () => app.quit());
