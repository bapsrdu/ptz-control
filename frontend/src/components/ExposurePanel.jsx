import { useCallback, useEffect, useState } from 'react';
import { Minus, Plus, RotateCcw, SunMedium, X } from 'lucide-react';

const MODES = [
    { id: 'auto', label: 'Auto' },
    { id: 'manual', label: 'Manual' },
    { id: 'shutter', label: 'Shutter' },
    { id: 'iris', label: 'Iris' },
    { id: 'bright', label: 'Bright' },
];

const WB = [
    { id: 'auto', label: 'Auto' },
    { id: '3000K', label: '3000K (warm indoor light)' },
    { id: '3500K', label: '3500K' },
    { id: '4000K', label: '4000K' },
    { id: '4500K', label: '4500K' },
    { id: '5000K', label: '5000K' },
    { id: '5500K', label: '5500K (daylight)' },
    { id: '6000K', label: '6000K' },
    { id: '6500K', label: '6500K' },
    { id: '7000K', label: '7000K (cool)' },
    { id: 'onePush', label: 'One push (set from a white card)' },
    { id: 'manual', label: 'Manual' },
];

// Exposure and white balance for one camera. It reads the camera's current
// settings when opened and after every change, so it always shows what the
// camera is really doing.
export default function ExposurePanel({ camera, live, disabled, onClose, onError }) {
    const [values, setValues] = useState(null);
    const [busy, setBusy] = useState(false);

    const read = useCallback(async () => {
        const out = await window.ptz.readExposure(camera.id);
        if (out?.ok) setValues(out.values);
        else onError(out?.message || 'Could not read the camera settings.');
    }, [camera.id, onError]);

    useEffect(() => {
        setValues(null);
        read();
    }, [read]);

    async function change(action) {
        setBusy(true);
        const out = await window.ptz.exposure(camera.id, action);
        if (!out?.ok) onError(out?.message || 'The camera did not accept that.');
        await read();
        setBusy(false);
    }

    const mode = values?.aeMode;
    const off = disabled || busy || !values;
    const pill = (active) => `rounded-lg px-2.5 py-1.5 text-sm font-medium transition disabled:opacity-40 ${active ? 'bg-accent text-zinc-900' : 'bg-panel-2 text-zinc-300 hover:bg-white/10'}`;

    function stepper({ label, setting, value, show = (v) => v, reset = true }) {
        return (
            <div className="flex items-center gap-2" data-testid={`step-${setting}`}>
                <span className="w-28 text-sm text-zinc-300">{label}</span>
                <button type="button" aria-label={`${label} down`} disabled={off} onClick={() => change({ type: 'step', setting, dir: 'down' })} className={pill(false)}><Minus size={14} /></button>
                <span className="w-10 text-center text-sm tabular-nums">{value === null || value === undefined ? '–' : show(value)}</span>
                <button type="button" aria-label={`${label} up`} disabled={off} onClick={() => change({ type: 'step', setting, dir: 'up' })} className={pill(false)}><Plus size={14} /></button>
                {reset && (
                    <button type="button" aria-label={`Reset ${label}`} title="Reset" disabled={off} onClick={() => change({ type: 'step', setting, dir: 'reset' })} className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 disabled:opacity-40"><RotateCcw size={14} /></button>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4" data-testid="exposure-panel">
            <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-400">
                    <SunMedium size={14} /> Exposure · {camera.name}
                </h2>
                <button type="button" aria-label="Close exposure" onClick={onClose} className="rounded-md p-1 text-zinc-400 hover:bg-white/10"><X size={16} /></button>
            </div>
            {live && <p className="text-xs text-red-300">{camera.name} is live: changes here show on screen straight away.</p>}

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Exposure mode">
                {MODES.map((m) => (
                    <button key={m.id} type="button" disabled={off} aria-pressed={mode === m.id} className={pill(mode === m.id)} onClick={() => change({ type: 'aeMode', value: m.id })}>
                        {m.label}
                    </button>
                ))}
            </div>

            <div className="flex flex-col gap-2">
                {(mode === 'auto' || mode === 'shutter' || mode === 'iris') && (
                    <>
                        <div className="flex items-center gap-2">
                            <span className="w-28 text-sm text-zinc-300">Brighter / darker</span>
                            <button type="button" aria-label="Brighter or darker" disabled={off} aria-pressed={Boolean(values?.expCompOn)} className={pill(values?.expCompOn)} onClick={() => change({ type: 'expCompOn', value: !values?.expCompOn })}>
                                {values?.expCompOn ? 'On' : 'Off'}
                            </button>
                        </div>
                        {values?.expCompOn && stepper({ label: 'Adjust', setting: 'expComp', value: values?.expComp, show: (v) => (v - 7 > 0 ? `+${v - 7}` : String(v - 7)) })}
                    </>
                )}
                {(mode === 'manual' || mode === 'iris') && stepper({ label: 'Iris', setting: 'iris', value: values?.iris })}
                {(mode === 'manual' || mode === 'shutter') && stepper({ label: 'Shutter', setting: 'shutter', value: values?.shutter })}
                {mode === 'bright' && stepper({ label: 'Brightness', setting: 'bright', value: values?.bright })}
            </div>

            <div className="flex items-center gap-2">
                <span className="w-28 text-sm text-zinc-300">Backlight</span>
                <button type="button" aria-label="Backlight" disabled={off} aria-pressed={Boolean(values?.backlight)} className={pill(values?.backlight)} onClick={() => change({ type: 'backlight', value: !values?.backlight })}>
                    {values?.backlight ? 'On' : 'Off'}
                </button>
                <span className="text-xs text-zinc-500">For a bright window or screen behind the speaker.</span>
            </div>

            <label className="flex items-center gap-2">
                <span className="w-28 text-sm text-zinc-300">White balance</span>
                <select
                    name="wbMode"
                    disabled={off}
                    value={values?.wbMode ?? ''}
                    onChange={(e) => change({ type: 'wbMode', value: e.target.value })}
                    className="rounded-lg border border-edge bg-black/40 px-2 py-1.5 text-sm"
                >
                    {!values?.wbMode && <option value="">–</option>}
                    {WB.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                </select>
            </label>
            {values?.wbMode === 'onePush' && (
                <div className="flex items-center gap-2 pl-[7.5rem]">
                    <button type="button" disabled={off} className={pill(false)} onClick={() => change({ type: 'wbOnePushTrigger' })}>Set white now</button>
                    <span className="text-xs text-zinc-500">Fill the shot with something white first.</span>
                </div>
            )}

            {!values && !disabled && <p className="text-sm text-zinc-500">Reading the camera...</p>}
        </div>
    );
}
