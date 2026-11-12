import { useEffect, useState } from 'react';
import { Home, Moon, PersonStanding, Power, Rabbit, SunMedium, Turtle } from 'lucide-react';
import Joystick from './Joystick.jsx';
import ZoomSlider from './ZoomSlider.jsx';
import HoldButton from './HoldButton.jsx';
import { useDrive } from '../useDrive.js';

const SPEED_DEFAULT = 0.5;

// Step 2: everything for framing the selected camera.
export default function FramePanel({ camera, profile, online, power = null, live = false, trackingOn, trackingSettings = null, speed, exposureOpen = false, onToggleExposure = () => {}, onError }) {
    const [focusMode, setFocusMode] = useState({}); // cameraId -> 'auto' | 'manual'
    const [localSpeed, setLocalSpeed] = useState(speed);

    const mode = focusMode[camera.id] ?? 'auto';
    const focus = useDrive({
        send: (id, dir) => window.ptz.focus(id, dir),
        stop: (id) => window.ptz.focus(id, null),
    });

    useEffect(() => setLocalSpeed(speed), [speed]);

    // Save the speed shortly after the slider stops moving.
    useEffect(() => {
        if (localSpeed === speed) return undefined;
        const t = setTimeout(() => window.ptz.setUi({ speed: localSpeed }), 200);
        return () => clearTimeout(t);
    }, [localSpeed, speed]);

    async function run(promise) {
        const out = await promise;
        if (!out?.ok) onError(out?.message || 'The camera did not accept that.');
        return out;
    }

    async function chooseFocus(next) {
        const out = await run(window.ptz.focusMode(camera.id, next));
        if (out?.ok) setFocusMode((m) => ({ ...m, [camera.id]: next }));
    }

    const standby = power === 'standby';
    const disabled = !online || standby;

    async function setPower(on) {
        if (!on && !window.confirm(`Put ${camera.name} in standby?${live ? `\n\n${camera.name} is live: it will turn away from the shot.` : '\n\nIt will turn to its rest position.'}`)) return;
        await run(window.ptz.power(camera.id, on));
    }
    const pill = (active) => `rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-accent text-zinc-900' : 'bg-panel-2 text-zinc-300 hover:bg-white/10'}`;

    return (
        <div className="flex flex-col gap-4">
            {standby && (
                <div data-testid="standby-banner" className="flex items-center gap-3 rounded-xl border border-edge bg-panel-2 px-4 py-2 text-sm">
                    <Moon size={18} className="shrink-0 text-zinc-400" />
                    <span><b>{camera.name} is in standby.</b> Wake it up to use it.</span>
                    <button type="button" onClick={() => setPower(true)} className="ml-auto shrink-0 rounded-lg bg-accent px-3 py-1 font-semibold text-zinc-900 hover:bg-sky-200">
                        Wake up
                    </button>
                </div>
            )}
            <div className="flex items-center gap-6">
                <Joystick cameraId={camera.id} disabled={disabled} />
                <ZoomSlider cameraId={camera.id} disabled={disabled} />

                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <span className="w-16 text-xs uppercase tracking-wide text-zinc-400">Focus</span>
                        <button type="button" disabled={disabled} className={pill(mode === 'auto')} onClick={() => chooseFocus('auto')}>Auto</button>
                        <button type="button" disabled={disabled} className={pill(mode === 'manual')} onClick={() => chooseFocus('manual')}>Manual</button>
                    </div>
                    {mode === 'manual' && (
                        <div className="flex items-center gap-2 pl-[4.5rem]">
                            <HoldButton disabled={disabled} className={pill(false)} onHold={() => focus.set(camera.id, 'near')} onRelease={focus.release}>Near</HoldButton>
                            <HoldButton disabled={disabled} className={pill(false)} onHold={() => focus.set(camera.id, 'far')} onRelease={focus.release}>Far</HoldButton>
                        </div>
                    )}

                    {profile?.features.tracking && (
                        <div className="flex items-center gap-2">
                            <span className="w-16 text-xs uppercase tracking-wide text-zinc-400">Tracking</span>
                            <button
                                type="button"
                                disabled={disabled}
                                aria-pressed={trackingOn}
                                className={`${pill(trackingOn)} flex items-center gap-1.5`}
                                onClick={() => run(window.ptz.tracking(camera.id, !trackingOn))}
                            >
                                <PersonStanding size={16} /> {trackingOn ? 'On' : 'Off'}
                            </button>
                            {profile.features.trackingSettings && (
                                <>
                                    <div className="flex overflow-hidden rounded-lg" role="group" aria-label="Tracking mode">
                                        {[['presenter', 'Presenter'], ['zone', 'Zone']].map(([value, label]) => (
                                            <button
                                                key={value}
                                                type="button"
                                                disabled={disabled || !trackingSettings}
                                                aria-pressed={trackingSettings?.mode === value}
                                                title={value === 'presenter' ? 'Follows the presenter everywhere' : 'Moves only between the zones set up on the camera'}
                                                className={`${pill(trackingSettings?.mode === value)} rounded-none`}
                                                onClick={() => run(window.ptz.trackingSettings(camera.id, { mode: value }))}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    {trackingSettings?.mode === 'zone' ? (
                                        <button
                                            type="button"
                                            disabled={!online}
                                            title="Zones are set up on the camera's own web page"
                                            className={pill(false)}
                                            onClick={() => run(window.ptz.openWebPage(camera.id))}
                                        >
                                            Set up zones
                                        </button>
                                    ) : (
                                        <select
                                            aria-label="Headroom"
                                            title="How much space to leave above the presenter's head"
                                            disabled={disabled || !trackingSettings}
                                            value={trackingSettings?.headroom ?? ''}
                                            onChange={(e) => run(window.ptz.trackingSettings(camera.id, { headroom: e.target.value }))}
                                            className="rounded-lg border border-edge bg-panel-2 px-2 py-1.5 text-sm text-zinc-200 disabled:opacity-40"
                                        >
                                            {!trackingSettings?.headroom && <option value="">Headroom</option>}
                                            <option value="low">Headroom: low</option>
                                            <option value="medium">Headroom: medium</option>
                                            <option value="high">Headroom: high</option>
                                        </select>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <span className="w-16 text-xs uppercase tracking-wide text-zinc-400">Picture</span>
                        <button type="button" disabled={!online || standby} aria-pressed={exposureOpen} className={`${pill(exposureOpen)} flex items-center gap-1.5`} onClick={onToggleExposure}>
                            <SunMedium size={16} /> Exposure
                        </button>
                        <button type="button" disabled={!online || standby} title={`Put ${camera.name} in standby`} className={`${pill(false)} flex items-center gap-1.5`} onClick={() => setPower(false)}>
                            <Power size={16} /> Standby
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="w-16 text-xs uppercase tracking-wide text-zinc-400">Position</span>
                        <button type="button" disabled={disabled} className={`${pill(false)} flex items-center gap-1.5`} onClick={() => run(window.ptz.home(camera.id))}>
                            <Home size={16} /> Home
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="w-16 text-xs uppercase tracking-wide text-zinc-400">Speed</span>
                        <Turtle size={18} className="text-zinc-400" />
                        <input
                            type="range"
                            aria-label="Movement speed"
                            min={0.1}
                            max={1}
                            step={0.05}
                            value={localSpeed}
                            onChange={(e) => setLocalSpeed(Number(e.target.value))}
                            className="w-32 accent-sky-300"
                        />
                        <Rabbit size={18} className="text-zinc-400" />
                        <span className="w-10 text-right text-sm tabular-nums text-zinc-300">{Math.round(localSpeed * 100)}%</span>
                        <button type="button" className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setLocalSpeed(SPEED_DEFAULT)}>Reset</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
