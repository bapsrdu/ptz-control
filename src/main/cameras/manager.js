// Keeps one VISCA client per configured camera and turns the window's requests
// (move, zoom, recall a shot, ...) into VISCA commands.
//
// A camera saved without a known transport (the Test button never succeeded)
// is probed in the background until it answers, and the working transport is
// reported through onModeDetected so it can be saved.

import { EventEmitter } from 'node:events';
import { ViscaClient } from '../visca/client.js';
import { detectMode } from '../visca/detect.js';
import * as V from '../visca/commands.js';
import { getProfile } from '../profiles/index.js';
import { DriveChannel, joystickToDrive, sliderToZoom } from './motion.js';

const DETECT_RETRY_MS = 10000;
const ADDRESS = 1; // VISCA over IP cameras answer on address 1.

function linkKey(camera) {
    return `${camera.host}|${camera.port}|${camera.mode}|${camera.profile}`;
}

// Events: 'status' (cameraId, status), 'notice' (cameraId, message)
export class CameraManager extends EventEmitter {
    constructor({ onModeDetected = () => {}, clientOptions = {}, detectOptions = {}, driveOptions = {} } = {}) {
        super();
        this.onModeDetected = onModeDetected;
        this.clientOptions = clientOptions;
        this.detectOptions = detectOptions;
        this.driveOptions = driveOptions;
        this.entries = new Map(); // cameraId -> entry
    }

    // Brings the running connections in line with the camera list.
    sync(cameras) {
        const wanted = new Map(cameras.map((c) => [c.id, c]));
        for (const [id, entry] of this.entries) {
            const camera = wanted.get(id);
            if (!camera || linkKey(camera) !== entry.key) {
                this.#dispose(entry);
                this.entries.delete(id);
            } else {
                entry.camera = camera;
            }
        }
        for (const camera of cameras) {
            if (!this.entries.has(camera.id)) this.#create(camera);
        }
    }

    statuses() {
        const out = {};
        for (const [id, entry] of this.entries) out[id] = { ...entry.status };
        return out;
    }

    #create(camera) {
        const entry = {
            camera,
            key: linkKey(camera),
            profile: getProfile(camera.profile),
            client: null,
            detectTimer: null,
            disposed: false,
            status: { state: 'connecting', message: '' },
        };
        entry.channels = this.#channels(entry);
        this.entries.set(camera.id, entry);
        if (camera.mode) this.#startClient(entry);
        else this.#detectLoop(entry);
    }

    #channels(entry) {
        const id = entry.camera.id;
        const common = {
            ...this.driveOptions,
            onWatchdog: () => this.emit('notice', id, 'Movement stopped because the controls stopped updating.'),
        };
        const send = (payload, opts) => this.#send(entry, payload, opts);
        return {
            panTilt: new DriveChannel({
                ...common,
                send: (d) => send(V.panTiltDrive(ADDRESS, {
                    ...d,
                    maxPan: entry.profile.panSpeedMax,
                    maxTilt: entry.profile.tiltSpeedMax,
                }), { key: 'pantilt' }),
                sendStop: () => send(V.panTiltStop(ADDRESS), { key: 'pantilt', urgent: true }),
            }),
            zoom: new DriveChannel({
                ...common,
                send: (d) => send(d.dir === 'tele' ? V.zoomTele(ADDRESS, d.speed) : V.zoomWide(ADDRESS, d.speed), { key: 'zoom' }),
                sendStop: () => send(V.zoomStop(ADDRESS), { key: 'zoom', urgent: true }),
            }),
            focus: new DriveChannel({
                ...common,
                send: (d) => send(d.dir === 'far' ? V.focusFar(ADDRESS) : V.focusNear(ADDRESS), { key: 'focus' }),
                sendStop: () => send(V.focusStop(ADDRESS), { key: 'focus', urgent: true }),
            }),
        };
    }

    #startClient(entry) {
        const { camera } = entry;
        const client = new ViscaClient({
            host: camera.host,
            port: camera.port,
            mode: camera.mode,
            address: ADDRESS,
            ...this.clientOptions,
        });
        entry.client = client;
        client.on('status', (status) => this.#setStatus(entry, { ...status, power: entry.status.power ?? null }));
        client.on('power', (power) => {
            if (entry.status.power !== power) this.#setStatus(entry, { ...entry.status, power });
        });
        client.start();
    }

    async #detectLoop(entry) {
        if (entry.disposed) return;
        this.#setStatus(entry, { state: 'connecting', message: 'Looking for the camera...' });
        const { camera } = entry;
        const found = await detectMode({ host: camera.host, port: camera.port, address: ADDRESS, ...this.detectOptions });
        if (entry.disposed) return;
        if (found.ok) {
            // Saving the mode changes the camera's link key, so sync() will
            // replace this entry with one that has a running client.
            this.onModeDetected(camera.id, found.mode);
            return;
        }
        this.#setStatus(entry, { state: 'offline', message: found.message });
        entry.detectTimer = setTimeout(() => this.#detectLoop(entry), DETECT_RETRY_MS);
        entry.detectTimer.unref?.();
    }

    #dispose(entry) {
        entry.disposed = true;
        clearTimeout(entry.detectTimer);
        // Stop anything that may be moving before letting go of the camera.
        for (const ch of Object.values(entry.channels)) {
            if (ch.moving) ch.stop();
            ch.dispose();
        }
        const client = entry.client;
        entry.client = null;
        if (client) {
            // Give the stop commands a moment to go out before closing.
            setTimeout(() => client.stop(), 300).unref?.();
        }
    }

    #setStatus(entry, status) {
        entry.status = { ...status };
        this.emit('status', entry.camera.id, entry.status);
    }

    #send(entry, payload, opts) {
        if (!entry.client) return Promise.resolve({ ok: false, message: notReady(entry) });
        return entry.client.command(payload, opts).then(
            () => ({ ok: true }),
            (err) => ({ ok: false, message: err.message }),
        );
    }

    #entry(id) {
        return this.entries.get(id) ?? null;
    }

    // --- Actions from the window. Each resolves to { ok, message? }. --------

    move(id, vector, speedScale) {
        const entry = this.#entry(id);
        if (!entry) return;
        entry.channels.panTilt.update(joystickToDrive(vector, {
            speedScale,
            panSpeedMax: entry.profile.panSpeedMax,
            tiltSpeedMax: entry.profile.tiltSpeedMax,
        }));
    }

    stopMove(id) {
        return this.#entry(id)?.channels.panTilt.stop();
    }

    zoom(id, value, speedScale) {
        const entry = this.#entry(id);
        if (!entry) return;
        entry.channels.zoom.update(sliderToZoom(value, { speedScale, zoomSpeedMax: entry.profile.zoomSpeedMax }));
    }

    stopZoom(id) {
        return this.#entry(id)?.channels.zoom.stop();
    }

    // dir: 'near' | 'far' | null (stop). Manual focus only.
    focus(id, dir) {
        const entry = this.#entry(id);
        if (!entry) return;
        entry.channels.focus.update(dir === 'near' || dir === 'far' ? { dir } : null);
    }

    // Sends Stop for pan/tilt and zoom to every camera, moving or not. Used on
    // window blur, camera removal and quit, where being sure matters more
    // than a few extra messages.
    stopAll() {
        const sends = [];
        for (const entry of this.entries.values()) {
            sends.push(entry.channels.panTilt.stop(), entry.channels.zoom.stop());
            if (entry.channels.focus.moving) sends.push(entry.channels.focus.stop());
        }
        return Promise.all(sends);
    }

    async focusMode(id, mode) {
        const entry = this.#entry(id);
        if (!entry) return { ok: false, message: 'Unknown camera.' };
        if (mode === 'auto') entry.channels.focus.stop();
        return this.#send(entry, mode === 'auto' ? V.focusAuto(ADDRESS) : V.focusManual(ADDRESS));
    }

    async home(id) {
        const entry = this.#entry(id);
        if (!entry) return { ok: false, message: 'Unknown camera.' };
        entry.channels.panTilt.stop();
        return this.#send(entry, V.panTiltHome(ADDRESS));
    }

    async recallPreset(id, number) {
        const entry = this.#entry(id);
        if (!entry) return { ok: false, message: 'Unknown camera.' };
        entry.channels.panTilt.stop();
        entry.channels.zoom.stop();
        return this.#send(entry, V.presetRecall(ADDRESS, number));
    }

    async savePreset(id, number) {
        const entry = this.#entry(id);
        if (!entry) return { ok: false, message: 'Unknown camera.' };
        return this.#send(entry, V.presetSave(ADDRESS, number));
    }

    async clearPreset(id, number) {
        const entry = this.#entry(id);
        if (!entry) return { ok: false, message: 'Unknown camera.' };
        return this.#send(entry, V.presetClear(ADDRESS, number));
    }

    async tracking(id, on) {
        const entry = this.#entry(id);
        if (!entry) return { ok: false, message: 'Unknown camera.' };
        if (!entry.profile.trackingCommand) return { ok: false, message: 'This camera has no auto tracking.' };
        return this.#send(entry, entry.profile.trackingCommand(ADDRESS, on));
    }

    // Tally lights. red/green: true on, false off. Cameras without tally
    // lights ignore this.
    async tally(id, { red, green }) {
        const entry = this.#entry(id);
        if (!entry?.profile.tallyCommands) return { ok: false, message: 'This camera has no tally lights.' };
        const [redCmd, greenCmd] = entry.profile.tallyCommands(ADDRESS, { red, green });
        const results = await Promise.all([
            this.#send(entry, redCmd, { key: 'tally-red' }),
            this.#send(entry, greenCmd, { key: 'tally-green' }),
        ]);
        return results.find((r) => !r.ok) ?? { ok: true };
    }

    // Power: on = wake, off = standby. The heartbeat confirms the new state.
    async power(id, on) {
        const entry = this.#entry(id);
        if (!entry) return { ok: false, message: 'Unknown camera.' };
        if (!on) {
            entry.channels.panTilt.stop();
            entry.channels.zoom.stop();
        }
        const out = await this.#send(entry, on ? V.powerOn(ADDRESS) : V.powerStandby(ADDRESS));
        if (out.ok) this.#setStatus(entry, { ...entry.status, power: on ? 'on' : 'standby' });
        return out;
    }

    // One exposure or white balance change. action is one of:
    //   { type: 'aeMode', value: 'auto' | 'manual' | 'shutter' | 'iris' | 'bright' }
    //   { type: 'expCompOn', value: true | false }
    //   { type: 'step', setting: 'expComp' | 'iris' | 'shutter' | 'bright', dir: 'up' | 'down' | 'reset' }
    //   { type: 'backlight', value: true | false }
    //   { type: 'wbMode', value: one of V.WB_MODES }
    //   { type: 'wbOnePushTrigger' }
    async exposure(id, action) {
        const entry = this.#entry(id);
        if (!entry) return { ok: false, message: 'Unknown camera.' };
        let payload;
        try {
            switch (action?.type) {
                case 'aeMode': payload = V.aeMode(ADDRESS, action.value); break;
                case 'expCompOn': payload = V.expCompOn(ADDRESS, Boolean(action.value)); break;
                case 'step': payload = V.step(ADDRESS, action.setting, action.dir); break;
                case 'backlight': payload = V.backlight(ADDRESS, Boolean(action.value)); break;
                case 'wbMode': payload = V.wbMode(ADDRESS, action.value); break;
                case 'wbOnePushTrigger': payload = V.wbOnePushTrigger(ADDRESS); break;
                default: return { ok: false, message: 'Unknown exposure setting.' };
            }
        } catch (err) {
            return { ok: false, message: err.message };
        }
        return this.#send(entry, payload);
    }

    // Reads the camera's current exposure and white balance. Anything the
    // camera does not answer comes back as null.
    async readExposure(id) {
        const entry = this.#entry(id);
        if (!entry?.client) return { ok: false, message: entry ? notReady(entry) : 'Unknown camera.' };
        const ask = async (name) => {
            try {
                return await entry.client.inquiry(V.inquiry(ADDRESS, name));
            } catch {
                return null;
            }
        };
        const byte = (data) => (data && data.length ? data[0] : null);
        const level = (data) => (data && data.length >= 4 ? V.decodeNibbles(data, 2, 2) : null);
        const onOff = (data) => (byte(data) === 0x02 ? true : byte(data) === 0x03 ? false : null);
        const nameOf = (table, value) => Object.keys(table).find((k) => table[k] === value) ?? null;

        const values = {
            aeMode: nameOf(V.AE_MODES, byte(await ask('aeMode'))),
            expCompOn: onOff(await ask('expCompOn')),
            expComp: level(await ask('expComp')),
            backlight: onOff(await ask('backlight')),
            wbMode: nameOf(V.WB_MODES, byte(await ask('wbMode'))),
            iris: level(await ask('iris')),
            shutter: level(await ask('shutter')),
            bright: level(await ask('bright')),
        };
        return { ok: true, values };
    }

    async dispose() {
        await this.stopAll();
        for (const entry of this.entries.values()) {
            entry.disposed = true;
            clearTimeout(entry.detectTimer);
            for (const ch of Object.values(entry.channels)) ch.dispose();
            entry.client?.stop();
        }
        this.entries.clear();
    }
}

function notReady(entry) {
    return entry.status.message || `${entry.camera.name} is not connected yet.`;
}
