import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Square, Wand2, X } from 'lucide-react';
import { canvasFor } from '../videoHub.js';
import { matches, measureCanvas, nextAdjustment } from '../colourMatch.js';

const ROUNDS = 12;
const SETTLE_MS = 900; // the picture shows a change about this much later

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Make the other cameras look like the selected one. Two ways:
// - Copy settings: the reference camera's exposure and white balance are
//   sent to the others (best when they are the same model).
// - Fine-tune from the pictures: the app compares each camera's video with
//   the reference and nudges its white balance and brightness, a step at a
//   time, until they look the same. Point the cameras at the same scene.
export default function MatchPanel({ reference, cameras, onlineIds, live = [], onBack, onClose, onError }) {
    const others = cameras.filter((c) => c.id !== reference.id);
    const [chosen, setChosen] = useState(() => others.filter((c) => onlineIds.has(c.id) && !live.includes(c.id)).map((c) => c.id));
    const [what, setWhat] = useState({ exposure: true, whiteBalance: true });
    const [measured, setMeasured] = useState({});
    const [busy, setBusy] = useState(null); // 'copy' | 'tune'
    const [progress, setProgress] = useState({}); // cameraId -> text
    const stop = useRef(false);
    const scratch = useRef(null);

    // Measure every picture once a second.
    useEffect(() => {
        scratch.current = scratch.current ?? document.createElement('canvas');
        const tick = () => {
            const next = {};
            for (const c of cameras) next[c.id] = measureCanvas(canvasFor(c.id), scratch.current);
            setMeasured(next);
        };
        tick();
        const t = setInterval(tick, 1000);
        return () => clearInterval(t);
    }, [cameras]);

    useEffect(() => () => { stop.current = true; }, []);

    const toggle = (id) => setChosen((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
    const ref = measured[reference.id];

    async function copy() {
        setBusy('copy');
        try {
            const out = await window.ptz.matchExposure(reference.id, chosen, what);
            if (!out?.ok) return onError(out?.message || 'Could not copy the settings.');
            const p = {};
            for (const r of out.results) {
                p[r.id] = !r.ok ? `Failed: ${r.message}` : r.refused.length ? `Copied, except ${r.refused.join(', ')}` : 'Copied';
            }
            setProgress(p);
            const failed = out.results.filter((r) => !r.ok || r.refused.length);
            if (failed.length) onError(`Some settings were not accepted: ${failed.map((r) => r.name).join(', ')}.`, 'info');
            else onError(`Copied ${reference.name}'s settings to ${out.results.map((r) => r.name).join(', ')}.`, 'info');
        } finally {
            setBusy(null);
        }
    }

    async function tune() {
        setBusy('tune');
        stop.current = false;
        const scratchCanvas = document.createElement('canvas');
        const measure = (id) => measureCanvas(canvasFor(id), scratchCanvas);
        try {
            if (!measure(reference.id)) return onError(`${reference.name} has no picture to match to.`);
            for (const id of chosen) {
                const name = cameras.find((c) => c.id === id)?.name ?? 'Camera';
                if (!measure(id)) {
                    setProgress((p) => ({ ...p, [id]: 'No picture' }));
                    continue;
                }
                let done = false;
                for (let round = 1; round <= ROUNDS && !stop.current; round += 1) {
                    setProgress((p) => ({ ...p, [id]: `Adjusting (${round} of ${ROUNDS})` }));
                    const read = await window.ptz.readExposure(id);
                    if (!read?.ok) {
                        setProgress((p) => ({ ...p, [id]: `Failed: ${read?.message || 'could not read it'}` }));
                        break;
                    }
                    const changes = nextAdjustment(measure(reference.id), measure(id), read.values);
                    if (!changes.length || matches(measure(reference.id), measure(id))) {
                        done = true;
                        break;
                    }
                    for (const action of changes) {
                        const out = await window.ptz.exposure(id, action);
                        if (!out?.ok) {
                            setProgress((p) => ({ ...p, [id]: `${name} refused a change: ${out?.message || ''}` }));
                        }
                    }
                    await wait(SETTLE_MS);
                }
                setProgress((p) => ({ ...p, [id]: stop.current ? 'Stopped' : done ? 'Matched' : 'Closer, not exact (check the scene)' }));
                if (stop.current) break;
            }
        } finally {
            setBusy(null);
        }
    }

    const btn = 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-40';

    return (
        <div className="flex flex-col gap-3" data-testid="match-panel">
            <div className="flex items-center gap-2">
                <button type="button" aria-label="Back to exposure" onClick={onBack} className="rounded-md p-1 text-zinc-400 hover:bg-white/10"><ArrowLeft size={16} /></button>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Match cameras to {reference.name}</h2>
                <button type="button" aria-label="Close" onClick={onClose} className="ml-auto rounded-md p-1 text-zinc-400 hover:bg-white/10"><X size={16} /></button>
            </div>
            <p className="text-xs text-zinc-500">Point the cameras at the same scene (the stage with the service lighting on) so the pictures can be compared fairly.</p>

            <table className="w-full text-left text-[13px]">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
                    <tr><th className="w-6" /><th>Camera</th><th>Brightness</th><th>Colour</th><th>Status</th></tr>
                </thead>
                <tbody>
                    <Row camera={reference} m={ref} reference />
                    {others.map((c) => (
                        <Row
                            key={c.id}
                            camera={c}
                            m={measured[c.id]}
                            ref0={ref}
                            checked={chosen.includes(c.id)}
                            disabled={!onlineIds.has(c.id) || Boolean(busy)}
                            onToggle={() => toggle(c.id)}
                            isLive={live.includes(c.id)}
                            status={progress[c.id]}
                        />
                    ))}
                </tbody>
            </table>
            {chosen.some((id) => live.includes(id)) && <p className="text-xs text-red-300">A camera you chose is live: its picture will change on screen.</p>}

            <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={what.exposure} onChange={(e) => setWhat((w) => ({ ...w, exposure: e.target.checked }))} /> Exposure</label>
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={what.whiteBalance} onChange={(e) => setWhat((w) => ({ ...w, whiteBalance: e.target.checked }))} /> White balance</label>
                <button type="button" disabled={Boolean(busy) || !chosen.length || (!what.exposure && !what.whiteBalance)} onClick={copy} className={`${btn} bg-panel-2 text-zinc-200 hover:bg-white/10`} title="Send this camera's settings to the others. Best for cameras of the same model.">
                    <Copy size={14} /> Copy settings
                </button>
                {busy === 'tune' ? (
                    <button type="button" onClick={() => { stop.current = true; }} className={`${btn} bg-red-500/20 text-red-200 hover:bg-red-500/30`}>
                        <Square size={14} /> Stop
                    </button>
                ) : (
                    <button type="button" disabled={Boolean(busy) || !chosen.length} onClick={tune} className={`${btn} bg-accent text-zinc-900`} title="Compare the pictures and adjust white balance and brightness step by step">
                        <Wand2 size={14} /> Fine-tune from the pictures
                    </button>
                )}
            </div>
        </div>
    );
}

function castText(m) {
    if (!m) return '–';
    if (m.cast === null) return 'Too dark to tell';
    return { warm: 'Warm (orange)', cool: 'Cool (blue)', neutral: 'Neutral' }[m.cast];
}

function Row({ camera, m, ref0, reference = false, checked, disabled, onToggle, isLive, status }) {
    const diff = !reference && m && ref0 ? m.brightness - ref0.brightness : null;
    const ok = !reference && matches(ref0, m);
    return (
        <tr className="border-t border-edge/60" data-testid="match-row">
            <td className="py-1.5">
                {reference ? <span className="text-[10px] font-bold text-accent">REF</span> : (
                    <input type="checkbox" aria-label={`Match ${camera.name}`} checked={checked} disabled={disabled} onChange={onToggle} />
                )}
            </td>
            <td className="py-1.5 font-semibold">
                {camera.name}
                {isLive && <span className="ml-1.5 rounded bg-live px-1 text-[9px] font-bold text-white">LIVE</span>}
            </td>
            <td className="py-1.5 tabular-nums">
                {m ? m.brightness : '–'}
                {diff !== null && diff !== 0 && <span className="ml-1 text-xs text-zinc-500">({diff > 0 ? '+' : ''}{diff})</span>}
            </td>
            <td className="py-1.5">
                <span className="inline-flex items-center gap-1.5">
                    {m && <span className="h-3 w-3 rounded-sm border border-white/20" style={{ background: `rgb(${m.rgb.join(',')})` }} />}
                    {castText(m)}
                </span>
            </td>
            <td className="py-1.5 text-xs text-zinc-400">
                {status ?? (ok ? <span className="inline-flex items-center gap-1 text-green-300"><Check size={12} /> Looks matched</span> : '')}
            </td>
        </tr>
    );
}
