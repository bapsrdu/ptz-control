// The operator's screen, built around three steps: pick what's next, frame
// it, take it live. Top: the Next and Live monitors and the source row.
// Bottom: saved shots, camera control under the tiles, and the take buttons.
// The camera controls always act on the camera on Next, so the Live camera
// cannot be moved by accident.
import { useCallback, useEffect, useState } from 'react';
import { Aperture, Flame, Footprints, Minus, Plus, Snowflake, Sun, SunDim, Video, VideoOff, X } from 'lucide-react';
import VideoView from '../../../frontend/src/components/VideoView.jsx';
import Joystick from '../../../frontend/src/components/Joystick.jsx';
import ZoomSlider from '../../../frontend/src/components/ZoomSlider.jsx';
import { Btn, Dialog, NameDialog, PanelButton, PanelLabel, Pill, StepLabel, Tag, useContextMenu } from './ui.jsx';
import {
    SIZES, cameraOn, isLive, keyIsOn, keyTarget, label, meIndex, mixState, routeActive, toggleKey, updateConfig, volunteerSources,
} from './lib.js';

export default function Operate({ state, tracker, notify }) {
    const [showExposure, setShowExposure] = useState(() => {
        try { return localStorage.getItem('showExposure') === '1'; } catch { return false; }
    });
    const m = mixState(state);
    const nextCam = cameraOn(state, m?.preview);
    const toggleExposure = () => {
        setShowExposure((v) => {
            try { localStorage.setItem('showExposure', v ? '0' : '1'); } catch {}
            return !v;
        });
    };
    return (
        <div className="flex h-full flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                <div className="flex min-h-0 flex-1 gap-3">
                    <BusMonitor state={state} title="Next" input={m?.preview} tone="preview" tracker={tracker} />
                    <BusMonitor state={state} title="Live" input={m?.program} tone="program" tracker={tracker} />
                </div>
                <div className="flex flex-col items-center gap-2">
                    <StepLabel n={1}>Pick what&apos;s next</StepLabel>
                    <SourceRow state={state} />
                </div>
            </div>
            <div className="h-px bg-line" />
            <div className="flex max-h-[360px] min-h-[290px] shrink-0 items-start gap-6 overflow-y-auto bg-surface p-4">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <NextCameraHeader state={state} camera={nextCam} />
                        <div className="flex-1" />
                        <Pill icon={Aperture} active={showExposure} onClick={toggleExposure} testid="exposure-toggle"
                            help={showExposure ? 'Hide exposure' : 'Show gain, shutter, iris and white balance for the camera on Next'}>
                            Exposure
                        </Pill>
                    </div>
                    <div className="flex min-h-0 flex-1 items-start gap-4">
                        {showExposure && <ExposurePanel state={state} camera={nextCam} notify={notify} />}
                        <ShotGrid state={state} notify={notify} />
                    </div>
                </div>
                <FramePanel state={state} camera={nextCam} notify={notify} />
                <TakePanel state={state} />
            </div>
        </div>
    );
}

// --- Monitors ------------------------------------------------------------------

function Picture({ state, input, large = true, onPick }) {
    const cam = cameraOn(state, input);
    if (cam) {
        return (
            <div className={`absolute inset-0 ${onPick ? 'cursor-crosshair' : ''}`} onClick={onPick}>
                <VideoView cameraId={cam.id} status={state.video?.[cam.id]} large={large} />
            </div>
        );
    }
    return (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-4xl font-bold text-muted">
            <span className="line-clamp-2">{label(state, input)}</span>
        </div>
    );
}

function BusMonitor({ state, title, input, tone, tracker }) {
    const m = mixState(state);
    const cam = cameraOn(state, input);
    const t = cam ? state.tracking?.[cam.id] : null;
    // Live shows a fade the way the switcher's output does: Next comes in over Live.
    let incoming = null;
    if (title === 'Live' && m?.inTransition && (m.runningSelection & 1)) {
        incoming = { input: m.preview, amount: Math.max(0, Math.min(1, m.position)), dip: m.runningStyle === 1 };
    }
    // Clicking a person on Next follows them. On Live, a click only changes who
    // an already-tracking camera follows, so a stray click cannot start moving the live shot.
    const canPick = cam && (title === 'Next' || t);
    const pick = async (e) => {
        if (!canPick) return;
        const r = e.currentTarget.getBoundingClientRect();
        const point = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
        if (!t) {
            const out = await window.booth.trackStart(cam.id, { size: 'waist' });
            if (!out?.ok) return;
        }
        tracker.follow(cam.id, point);
        window.ptz.trackRestart(cam.id);
    };
    const box = tracker.overlay?.cameraId === cam?.id ? tracker.overlay?.box : null;
    return (
        <div className="flex min-w-0 flex-1 items-center justify-center">
            <div
                data-testid={`monitor-${title.toLowerCase()}`}
                className={`relative aspect-video max-h-full w-full overflow-hidden bg-black ${tone === 'program' ? 'outline-program' : 'outline-preview'} outline-3`}
            >
                <Picture state={state} input={input} onPick={canPick ? pick : undefined} />
                {incoming && (
                    <div className="pointer-events-none absolute inset-0 bg-black" data-testid="fade-overlay"
                        style={{ opacity: incoming.dip ? (incoming.amount < 0.5 ? incoming.amount * 2 : 1) : incoming.amount }}>
                        {(!incoming.dip || incoming.amount >= 0.5) && <Picture state={state} input={incoming.input} />}
                        {incoming.dip && incoming.amount >= 0.5 && <div className="absolute inset-0 bg-black" style={{ opacity: (1 - incoming.amount) * 2 }} />}
                    </div>
                )}
                {box && (
                    <div data-testid="track-box" className="pointer-events-none absolute rounded border-2 border-white/80"
                        style={{ left: `${Math.max(0, box.x0) * 100}%`, top: `${Math.max(0, box.y0) * 100}%`, width: `${(Math.min(1, box.x1) - Math.max(0, box.x0)) * 100}%`, height: `${(Math.min(1, box.y1) - Math.max(0, box.y0)) * 100}%` }} />
                )}
                <span className={`caps absolute left-3 top-3 flex h-6 items-center rounded px-2.5 text-[13px] ${tone === 'program' ? 'bg-program text-white' : 'bg-preview text-zinc-950'}`}>
                    {title}
                </span>
                {t && <TrackingBadge status={t.status} onStop={() => window.booth.trackStop(cam.id)} />}
                {cam && (
                    <span className="absolute bottom-3 left-3 flex h-7 items-center rounded-full bg-black/60 px-3 text-[15px] font-semibold text-white">
                        {label(state, input)}
                    </span>
                )}
            </div>
        </div>
    );
}

const TRACK_WORDS = { looking: 'Looking for someone', following: 'Following', searching: 'Lost sight, holding', lost: 'Lost them, looking' };

function TrackingBadge({ status, onStop }) {
    const ok = status === 'following';
    return (
        <button type="button" data-testid="tracking-badge" title="Stop auto tracking" onClick={onStop}
            className={`caps absolute right-3 top-3 flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] ${ok ? 'bg-accent text-zinc-950' : 'bg-warning text-zinc-950'}`}>
            <Footprints size={12} /> {TRACK_WORDS[status] ?? status} <X size={11} />
        </button>
    );
}

function SourceRow({ state }) {
    const sources = volunteerSources(state);
    const m = mixState(state);
    if (!sources.length) {
        return <div className="flex h-24 items-center text-sm text-muted">No sources set up yet. Add them in Setup.</div>;
    }
    return (
        <div className="flex h-24 gap-2" data-testid="source-row">
            {sources.map((s) => {
                const cam = cameraOn(state, s.input);
                const live = m?.program === s.input;
                const next = m?.preview === s.input;
                return (
                    <button
                        key={s.input}
                        type="button"
                        data-testid="source-tile"
                        title={`Put ${label(state, s.input)} on Next`}
                        onClick={() => window.booth.atem('preview', s.input, meIndex(state))}
                        className={`relative aspect-video h-full shrink-0 overflow-hidden bg-raised active:brightness-125 ${
                            live ? 'outline-3 outline-program' : next ? 'outline-3 outline-preview' : 'outline outline-line'
                        }`}
                    >
                        {cam && <VideoView cameraId={cam.id} status={state.video?.[cam.id]} />}
                        <span className={`absolute bottom-1.5 left-1.5 flex h-6 max-w-[90%] items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-white ${cam ? 'bg-black/60' : ''}`}>
                            <span className="truncate">{label(state, s.input)}</span>
                            {live ? <Tag tone="program">Live</Tag> : next ? <Tag tone="preview">Next</Tag> : null}
                            {cam && state.tracking?.[cam.id] && <Footprints size={11} className="text-accent" />}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

function NextCameraHeader({ state, camera }) {
    const m = mixState(state);
    return (
        <div data-testid="next-camera" title="Exposure and saved shots act on the camera on Next."
            className={`flex h-8 items-center gap-2 rounded-lg bg-sunken px-3 ${camera ? 'border-2 border-preview text-ink' : 'border border-line text-muted'}`}>
            {camera ? <Video size={14} /> : <VideoOff size={14} />}
            <span className="text-base font-bold">{camera?.name ?? 'No camera on Next'}</span>
            {camera ? <Tag tone="preview">On next</Tag> : <span className="text-[13px] text-subtle">{label(state, m?.preview)}</span>}
        </div>
    );
}

// --- Step 2: frame the camera on Next ---------------------------------------

function FramePanel({ state, camera, notify }) {
    const status = camera ? state.cameras?.[camera.id] : null;
    const online = status?.state === 'online';
    return (
        <div className="flex shrink-0 flex-col gap-3">
            <StepLabel n={2}>{camera ? `Frame ${camera.name}` : 'Frame'}</StepLabel>
            <div className={`relative flex items-center gap-4 ${camera ? '' : 'pointer-events-none opacity-35'}`}>
                <Joystick cameraId={camera?.id} disabled={!camera} />
                <ZoomSlider cameraId={camera?.id} disabled={!camera} />
                <div className="flex w-36 flex-col gap-2">
                    <PanelButton title="Focus" width={144} height={30} size={12} testid="focus"
                        help="Focus once now" onClick={async () => {
                            const out = await window.booth.focusOnce(camera.id);
                            if (!out?.ok) notify(out?.message);
                        }} />
                    {camera && <TrackButton state={state} camera={camera} notify={notify} />}
                    {camera && !online && <div className="text-[11px] font-semibold text-warning">{status?.message || 'Not answering'}</div>}
                </div>
            </div>
            {!camera && (
                <div className="-mt-2 self-center rounded-lg bg-raised px-3 py-2 text-[13px] font-semibold">Put a camera on Next to frame it</div>
            )}
            <SpeedDial state={state} />
        </div>
    );
}

// How fast the joystick, zoom and arrow keys move every camera.
function SpeedDial({ state }) {
    const [v, setV] = useState(state.config.ptzSpeed);
    useEffect(() => setV(state.config.ptzSpeed), [state.config.ptzSpeed]);
    const save = (x) => updateConfig(state, (c) => ({ ...c, ptzSpeed: Math.round(x * 20) / 20 }));
    return (
        <div className="flex items-center gap-2 text-subtle" title="Camera speed for the joystick, zoom and arrow keys. Slow it down for fine framing on a tight shot.">
            <span className="text-[11px]">Slow</span>
            <input type="range" min={0.25} max={2} step={0.05} value={v} data-testid="speed-dial"
                onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => save(v)} onKeyUp={() => save(v)}
                className="w-36 accent-accent" />
            <span className="text-[11px]">Fast</span>
            <span className="w-10 font-mono text-[11px] text-muted">{v.toFixed(2).replace(/0$/, '')}×</span>
            {Math.abs(v - 1) > 0.01 && <button type="button" className="text-[11px] hover:text-ink" onClick={() => { setV(1); save(1); }}>Reset</button>}
        </div>
    );
}

function TrackButton({ state, camera, notify }) {
    const t = state.tracking?.[camera.id];
    const toggle = async () => {
        const out = t ? await window.booth.trackStop(camera.id) : await window.booth.trackStart(camera.id, { size: 'waist' });
        if (!out?.ok) notify(out?.message);
    };
    const speed = (d) => updateConfig(state, (c) => ({ ...c, trackSpeed: Math.min(4, Math.max(0.5, Math.round((c.trackSpeed + d) * 4) / 4)) }));
    return (
        <div className="flex flex-col gap-1">
            <button type="button" data-testid="track" onClick={toggle}
                title={t ? 'Stop following. Moving the joystick or recalling a shot also stops it.' : 'Follow the person in the middle of the shot. Or click someone on the Next picture.'}
                className={`caps flex h-[30px] items-center justify-center gap-1.5 rounded text-[11px] ${t ? 'bg-accent text-zinc-950' : 'border border-line-strong text-ink'}`}>
                <Footprints size={12} /> {t ? 'Tracking' : 'Track'}
            </button>
            {t ? (
                <>
                    <div className="flex gap-0.5">
                        {SIZES.map((z) => (
                            <button key={z.id} type="button" data-testid={`size-${z.id}`} title={`Frame ${z.name.toLowerCase()}`}
                                onClick={() => window.booth.trackStart(camera.id, { size: z.id })}
                                className={`h-6 flex-1 rounded text-[11px] font-semibold ${t.size === z.id ? 'bg-accent text-zinc-950' : 'bg-sunken text-muted'}`}>
                                {z.short}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-muted" title="How quickly tracking follows. Raise it if the camera falls behind, lower it if it overshoots.">
                        <span>Speed</span><span className="flex-1" />
                        <button type="button" className="rounded bg-sunken px-1.5" onClick={() => speed(-0.25)}><Minus size={10} /></button>
                        <span className="w-9 text-center font-mono text-ink">{state.config.trackSpeed}×</span>
                        <button type="button" className="rounded bg-sunken px-1.5" onClick={() => speed(0.25)}><Plus size={10} /></button>
                    </div>
                    <div className={`text-[11px] font-semibold ${t.status === 'following' ? 'text-accent' : 'text-warning'}`} data-testid="track-status">
                        {[TRACK_WORDS[t.status], t.status === 'following' ? SIZES.find((z) => z.id === t.size)?.name : null].filter(Boolean).join(' · ')}
                    </div>
                </>
            ) : (
                <div className="text-[11px] text-subtle">Or click a person on Next</div>
            )}
        </div>
    );
}

// --- Shots ------------------------------------------------------------------------

// Every camera's positions in one grid: a row per camera, its shots and
// named camera presets across. Tap one to send that camera there. The
// camera's name puts it on Next. + saves where that camera is now.
// Right-click a shot to update, rename or delete it. A camera on Live asks
// before it moves.
function ShotGrid({ state, notify }) {
    const [menu, menuElement] = useContextMenu();
    const [naming, setNaming] = useState(null); // { camera, shot? }
    const [confirm, setConfirm] = useState(null); // { text, run }
    const [lastUsed, setLastUsed] = useState({});
    const cams = state.config.cameras.filter((c) => c.host);
    const m = mixState(state);

    const go = (cam, run) => {
        if (isLive(state, cam.atemInput)) setConfirm({ title: `${cam.name} is on Live. Move it anyway?`, text: 'Everyone watching will see the camera move.', action: 'Move it on Live', run });
        else run();
    };
    const result = (out) => { if (out && !out.ok) notify(out.message); };
    const renameShot = (cam, shot, name) => name && updateConfig(state, (c) => {
        const s = c.cameras.find((x) => x.id === cam.id)?.shots.find((x) => x.id === shot.id);
        if (s) s.name = name;
        return c;
    });
    const deleteShot = (cam, shot) => updateConfig(state, (c) => {
        const cc = c.cameras.find((x) => x.id === cam.id);
        if (cc) cc.shots = cc.shots.filter((x) => x.id !== shot.id);
        return c;
    });

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5" data-testid="shot-grid">
            <PanelLabel>Shots</PanelLabel>
            {!cams.length && <div className="text-xs text-subtle">No cameras set up yet. Add them in Setup.</div>}
            <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
                {cams.map((cam) => {
                    const live = isLive(state, cam.atemInput);
                    const next = m?.preview === cam.atemInput;
                    const shots = cam.shots.filter((s) => s.kind === 'position');
                    const presets = Object.keys(cam.presetNames).map(Number).sort((a, b) => a - b);
                    return (
                        <div key={cam.id} className="flex items-center gap-1.5" data-testid="shot-row">
                            <button type="button" title={`Put ${cam.name} on Next`} onClick={() => cam.atemInput && window.booth.atem('preview', cam.atemInput, meIndex(state))}
                                className={`flex h-10 w-[82px] shrink-0 flex-col items-start justify-center rounded-lg bg-sunken px-2 ${live ? 'border-2 border-program' : next ? 'border-2 border-preview' : 'border border-line'}`}>
                                <span className="w-full truncate text-left text-[13px] font-bold">{cam.name}</span>
                                <span className={`caps text-[9px] ${live ? 'text-program' : 'text-preview'}`}>{live ? 'Live' : next ? 'Next' : ' '}</span>
                            </button>
                            <div className="flex gap-1.5 overflow-x-auto">
                                {shots.map((s) => (
                                    <ShotCell key={s.id} title={s.name} used={lastUsed[cam.id] === s.id} live={live}
                                        onClick={() => go(cam, async () => { result(await window.booth.goShot(cam.id, s.id)); setLastUsed((u) => ({ ...u, [cam.id]: s.id })); })}
                                        onContextMenu={(e) => menu(e, [
                                            { label: 'Update to where the camera is now', run: async () => result(await window.booth.saveShot(cam.id, { kind: 'position', replacing: s.id })) },
                                            { label: 'Rename…', run: () => setNaming({ camera: cam, shot: s }) },
                                            '-',
                                            { label: 'Delete…', danger: true, run: () => setConfirm({ title: `Delete ${s.name}?`, action: 'Delete', run: () => deleteShot(cam, s) }) },
                                        ])} />
                                ))}
                                {presets.map((n) => (
                                    <ShotCell key={`p${n}`} title={cam.presetNames[n]} subtitle="On camera" used={lastUsed[cam.id] === `p${n}`} live={live}
                                        onClick={() => go(cam, async () => { result(await window.booth.recallPreset(cam.id, n)); setLastUsed((u) => ({ ...u, [cam.id]: `p${n}` })); })}
                                        onContextMenu={(e) => menu(e, [{
                                            label: 'Delete from camera…', danger: true, run: () => setConfirm({
                                                title: `Delete "${cam.presetNames[n]}" from ${cam.name}?`, text: 'This removes it from the camera itself, for every controller that uses it. It cannot be undone.', action: 'Delete from camera',
                                                run: async () => {
                                                    result(await window.booth.clearPreset(cam.id, n));
                                                    updateConfig(state, (c) => { const cc = c.cameras.find((x) => x.id === cam.id); if (cc) delete cc.presetNames[n]; return c; });
                                                },
                                            }),
                                        }])} />
                                ))}
                                <button type="button" data-testid="save-shot" title={`Save where ${cam.name} is now as a new shot`} onClick={() => setNaming({ camera: cam })}
                                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-line-strong text-accent hover:bg-raised">
                                    <Plus size={14} strokeWidth={3} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
            {menuElement}
            {naming && (
                <NameDialog
                    title={naming.shot ? 'Rename shot' : `Save a shot on ${naming.camera.name}`}
                    note={naming.shot ? null : 'Pan, tilt and zoom, where the camera is pointing now.'}
                    initial={naming.shot?.name ?? ''}
                    placeholder="Pulpit"
                    onClose={() => setNaming(null)}
                    onSave={async (name) => {
                        if (naming.shot) renameShot(naming.camera, naming.shot, name);
                        else result(await window.booth.saveShot(naming.camera.id, { name, kind: 'position' }));
                    }}
                />
            )}
            {confirm && (
                <Dialog title={confirm.title} onClose={() => setConfirm(null)} testid="confirm" actions={<>
                    <Btn onClick={() => setConfirm(null)}>Cancel</Btn>
                    <Btn kind="danger" testid="confirm-yes" onClick={() => { confirm.run(); setConfirm(null); }}>{confirm.action}</Btn>
                </>}>{confirm.text}</Dialog>
            )}
        </div>
    );
}

function ShotCell({ title, subtitle, used, live, onClick, onContextMenu }) {
    return (
        <button type="button" data-testid="shot" onClick={onClick} onContextMenu={onContextMenu}
            className={`flex h-10 w-[104px] shrink-0 flex-col items-center justify-center rounded-lg border px-1.5 active:brightness-125 ${used ? 'border-accent bg-accent text-zinc-950' : 'border-line bg-raised text-ink'} ${live && !used ? 'opacity-75' : ''}`}>
            <span className="w-full truncate text-[13px] font-semibold">{title}</span>
            {subtitle && <span className="caps text-[8px] opacity-70">{subtitle}</span>}
        </button>
    );
}

// --- Exposure ----------------------------------------------------------------------

// BZB white balance presets, coolest last; Booth steps through them.
const KELVINS = ['3000K', '3500K', '4000K', '4500K', '5000K', '5500K', '6000K', '6500K', '7000K'];
const WB_TEXT = { auto: 'Auto', onePush: 'One push', manual: 'Manual' };

function ExposurePanel({ state, camera, notify }) {
    const [values, setValues] = useState(null);
    const [naming, setNaming] = useState(false);
    const [lastUsed, setLastUsed] = useState(null);
    const id = camera?.id;
    const read = useCallback(async () => {
        if (!id) return;
        const out = await window.booth.readExposure(id);
        if (out?.ok) setValues(out.values);
    }, [id]);
    useEffect(() => { setValues(null); setLastUsed(null); read(); }, [read]);

    if (!camera) {
        return (
            <div className="flex w-[200px] shrink-0 flex-col gap-3">
                <PanelLabel>Exposure</PanelLabel>
                <div className="text-xs text-subtle">Put a camera on Next</div>
            </div>
        );
    }
    const send = async (...actions) => {
        for (const a of actions) {
            const out = await window.booth.exposure(id, a);
            if (!out?.ok) { notify(out?.message); break; }
        }
        await read();
    };
    // One mode for all three: touching any puts the camera in manual, and the
    // other two are set to what the camera had, so the picture does not jump.
    const step = (setting, brighter, brighterIsUp) => {
        if (!values) return;
        const up = brighter === brighterIsUp;
        const max = { gain: 15, shutter: 21, iris: 17 }[setting];
        const now = values[setting] ?? 0;
        const v = Math.max(0, Math.min(max, now + (up ? 1 : -1)));
        const actions = [];
        if (values.aeMode !== 'manual') {
            actions.push({ type: 'aeMode', value: 'manual' });
            for (const k of ['iris', 'shutter', 'gain']) if (k !== setting && values[k] !== null) actions.push({ type: 'direct', setting: k, value: values[k] });
        }
        actions.push({ type: 'direct', setting, value: v });
        send(...actions);
    };
    const wbIndex = KELVINS.indexOf(values?.wbMode);
    const warmer = (w) => {
        const i = wbIndex < 0 ? 4 : wbIndex;
        // A lower colour temperature setting makes the picture warmer.
        send({ type: 'wbMode', value: KELVINS[Math.max(0, Math.min(KELVINS.length - 1, i + (w ? -1 : 1)))] });
    };
    const manual = values?.aeMode === 'manual';
    const row = (name, setting, brighterIsUp) => (
        <div className="flex items-center gap-1" data-testid={`exp-${setting}`}>
            <span className="w-12 text-[11px] font-semibold text-subtle">{name}</span>
            <StepIcon icon={SunDim} help="Darker" onClick={() => step(setting, false, brighterIsUp)} />
            <span className="flex h-7 flex-1 items-center justify-center rounded bg-sunken text-[13px] font-semibold tabular-nums">
                {!values ? '…' : manual || (setting === 'iris' && values.aeMode === 'iris') || (setting === 'shutter' && values.aeMode === 'shutter') ? `Level ${values[setting] ?? '?'}` : 'Auto'}
            </span>
            <StepIcon icon={Sun} help="Brighter" onClick={() => step(setting, true, brighterIsUp)} />
        </div>
    );
    const shots = camera.shots.filter((s) => s.kind === 'exposure');
    return (
        <div className="flex shrink-0 gap-3" data-testid="exposure-panel">
            <div className="flex w-[200px] flex-col gap-1.5">
                <PanelLabel>Exposure</PanelLabel>
                {row('Gain', 'gain', true)}
                {row('Shutter', 'shutter', false)}
                {row('Iris', 'iris', true)}
                <div className="flex items-center gap-1" data-testid="exp-wb">
                    <span className="w-12 text-[11px] font-semibold text-subtle">White</span>
                    <StepIcon icon={Snowflake} help="Cooler (bluer)" onClick={() => warmer(false)} />
                    <select value={values?.wbMode ?? ''} onChange={(e) => send({ type: 'wbMode', value: e.target.value }, ...(e.target.value === 'onePush' ? [{ type: 'wbOnePushTrigger' }] : []))}
                        onKeyDown={(e) => e.stopPropagation()}
                        title="White balance: auto, a colour temperature, or one push (point the camera at something white first)"
                        className="h-7 min-w-0 flex-1 rounded bg-sunken text-center text-[13px] font-semibold text-ink outline-none">
                        {!values?.wbMode && <option value="">…</option>}
                        <option value="auto">Auto</option>
                        {KELVINS.map((k) => <option key={k} value={k}>{k.replace('K', ' K')}</option>)}
                        <option value="onePush">One push</option>
                        {values?.wbMode === 'manual' && <option value="manual">{WB_TEXT.manual}</option>}
                    </select>
                    <StepIcon icon={Flame} help="Warmer (more orange)" onClick={() => warmer(true)} />
                </div>
                <button type="button" data-testid="auto-exposure" disabled={values?.aeMode === 'auto'} onClick={() => send({ type: 'aeMode', value: 'auto' })}
                    title="Let the camera set gain, shutter and iris itself"
                    className={`h-7 rounded border text-xs font-semibold ${values?.aeMode === 'auto' ? 'border-accent bg-accent text-zinc-950' : 'border-line bg-raised text-ink'}`}>
                    {values?.aeMode === 'auto' ? 'Auto exposure on' : 'Auto exposure'}
                </button>
            </div>
            <div className="flex w-[140px] flex-col gap-1">
                <button type="button" className="flex items-center gap-1 text-[11px] font-bold text-accent" data-testid="save-exposure"
                    title={`Save ${camera.name}'s exposure now (gain, shutter, iris and white balance) as a shot`} onClick={() => setNaming(true)}>
                    <Plus size={11} /> Save exposure
                </button>
                <div className="flex flex-col gap-1 overflow-y-auto">
                    {shots.map((s) => (
                        <button key={s.id} type="button" data-testid="exposure-shot"
                            onClick={async () => { const out = await window.booth.goShot(camera.id, s.id); if (!out?.ok) notify(out?.message); setLastUsed(s.id); read(); }}
                            onContextMenu={(e) => { e.preventDefault(); updateConfig(state, (c) => { const cc = c.cameras.find((x) => x.id === camera.id); cc.shots = cc.shots.filter((x) => x.id !== s.id); return c; }); }}
                            title="Click to use. Right-click to delete."
                            className={`h-[30px] truncate rounded border px-1 text-xs font-semibold ${lastUsed === s.id ? 'border-accent bg-accent text-zinc-950' : 'border-line bg-raised'}`}>
                            {s.name}
                        </button>
                    ))}
                    {!shots.length && <div className="text-[11px] text-subtle">No exposure shots yet.</div>}
                </div>
            </div>
            {naming && (
                <NameDialog title={`Save ${camera.name}'s exposure`} note="Gain, shutter, iris and white balance, as the camera has them now." placeholder="Bright stage"
                    onClose={() => setNaming(false)}
                    onSave={async (name) => { const out = await window.booth.saveShot(camera.id, { name, kind: 'exposure' }); if (!out?.ok) notify(out?.message); }} />
            )}
        </div>
    );
}

function StepIcon({ icon: Icon, help, onClick }) {
    return (
        <button type="button" title={help} onClick={onClick} className="flex h-7 w-[30px] shrink-0 items-center justify-center rounded border border-line bg-raised hover:brightness-125">
            <Icon size={13} />
        </button>
    );
}

// --- Step 3: take it live --------------------------------------------------------

function TakePanel({ state }) {
    const m = mixState(state);
    const me = meIndex(state);
    const connected = state.atem?.connected;
    const fading = m?.inTransition;
    const ftb = m?.ftbInTransition;
    const black = m?.ftbBlack;
    return (
        <div className="flex w-[258px] shrink-0 flex-col gap-3" data-testid="take-panel">
            <StepLabel n={3}>Take it live</StepLabel>
            <div className="flex gap-2">
                <button type="button" data-testid="fade" disabled={!connected} onClick={() => window.booth.atem('auto', me)} title="Fade from Live to Next (Return)"
                    className={`relative flex h-[92px] w-[125px] flex-col items-center justify-center overflow-hidden rounded-lg border border-white/25 text-white active:brightness-125 disabled:opacity-40 ${fading ? 'bg-program/55' : 'bg-program'}`}>
                    <span className="text-2xl font-bold">{fading ? 'FADING' : 'FADE'}</span>
                    <span className="max-w-[115px] truncate text-[11px] opacity-85">
                        {fading ? `${label(state, m.program)} to ${label(state, m.preview)}` : `${((m?.mixRate ?? 30) / 30).toFixed(1)} s · Return`}
                    </span>
                    {fading && <span className="absolute bottom-0 left-0 h-[5px] bg-white" style={{ width: `${Math.round((m.position ?? 0) * 100)}%` }} />}
                </button>
                <button type="button" data-testid="cut" disabled={!connected} onClick={() => window.booth.atem('cut', me)} title="Switch to Next instantly (Space)"
                    className="flex h-[92px] w-[125px] flex-col items-center justify-center rounded-lg border border-line-strong bg-raised active:brightness-125 disabled:opacity-40">
                    <span className="text-2xl font-bold">CUT</span>
                    <span className="text-[11px] text-muted">Space</span>
                </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <PanelButton title="BLACK" subtitle={black ? 'IN BLACK' : ftb ? 'FADING' : 'OFF'} lit={black || ftb ? 'program' : null} blink={black}
                    width={125} height={48} testid="black" disabled={!connected}
                    help={black ? 'Fade back up from black' : 'Fade everything to black'} onClick={() => window.booth.atem('ftb', me)} />
                {state.config.keys.map((k) => {
                    const on = keyIsOn(state, k);
                    return (
                        <PanelButton key={`${k.label}${keyTarget(k)}`} title={k.label.toUpperCase()} subtitle={on ? 'ON AIR' : 'OFF'} lit={on ? 'program' : null}
                            width={125} height={48} size={13} testid="key-button" disabled={!connected}
                            help={on ? `Take ${k.label} off (${keyTarget(k)})` : `Put ${k.label} on (${keyTarget(k)})`} onClick={() => toggleKey(state, k)} />
                    );
                })}
            </div>
            {state.config.routes.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    <PanelLabel>Screens</PanelLabel>
                    <div className="flex flex-wrap gap-1.5">
                        {state.config.routes.map((r) => (
                            <PanelButton key={r.label} title={r.label} lit={routeActive(state, r) ? 'accent' : null} width={125} height={34} size={11}
                                testid="route-button" disabled={!connected} help="Send these pictures to the screens" onClick={() => window.booth.route(r.set)} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
