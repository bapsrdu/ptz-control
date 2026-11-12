import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { snapshot } from '../videoHub.js';
import { cameraColour } from './cameraColours.js';

// Saved shots as big buttons, one column per camera. Click a button to send
// that camera to the shot; the last tile in each column saves a new one.
//
// The columns share the pad's width and never get narrower than MIN_COLUMN;
// with more cameras than fit, the pad scrolls sideways inside itself, so a
// temple with many cameras never pushes the rest of the screen around.
export default function ShotPad({ cameras, selectedId, onlineIds, live = [], next = [], tracking = {}, appTracking = {}, onShot = {}, onError }) {
    const [editing, setEditing] = useState(false);
    const [adding, setAdding] = useState(null); // cameraId being named
    const [renaming, setRenaming] = useState(null); // presetId being renamed
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [dragging, setDragging] = useState(null); // { cameraId, presetId }
    const [dropAt, setDropAt] = useState(null); // presetId hovered while dragging

    async function act(promise) {
        setBusy(true);
        try {
            const out = await promise;
            if (!out?.ok) onError(out?.message || 'That did not work.');
            return out;
        } finally {
            setBusy(false);
        }
    }

    async function save(cameraId) {
        // Take the picture now, before the camera can move. Kept for later use;
        // the buttons are text only for now.
        const picture = snapshot(cameraId);
        const out = await act(window.ptz.savePreset(cameraId, text, picture));
        if (out?.ok) {
            setAdding(null);
            setText('');
        }
    }

    async function rename(cameraId, presetId) {
        const out = await act(window.ptz.renamePreset(cameraId, presetId, text));
        if (out?.ok) setRenaming(null);
    }

    function remove(camera, preset) {
        if (!window.confirm(`Delete the shot "${preset.name}" from ${camera.name}?`)) return;
        act(window.ptz.deletePreset(camera.id, preset.id));
    }

    function drop(camera, targetIndex) {
        const d = dragging;
        setDragging(null);
        setDropAt(null);
        if (!d || d.cameraId !== camera.id) return;
        act(window.ptz.movePreset(camera.id, d.presetId, targetIndex));
    }

    function trackingText(id) {
        const app = appTracking[id];
        if (app) return `Tracking: App · ${app.framing[0].toUpperCase()}${app.framing.slice(1)}`;
        return tracking[id] ? 'Tracking: Camera' : null;
    }

    const stop = (e) => e.stopPropagation();

    return (
        <div className="flex h-full min-h-0 flex-col gap-3" data-testid="shots-panel">
            <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Shots</h2>
                <button
                    type="button"
                    onClick={() => { setEditing((e) => !e); setRenaming(null); setAdding(null); }}
                    className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold ${editing ? 'border-accent bg-accent text-zinc-900' : 'border-edge text-zinc-400 hover:bg-white/10'}`}
                >
                    {editing ? <><Check size={13} /> Done</> : <><Pencil size={13} /> Edit shots</>}
                </button>
            </div>

            <div
                className="grid min-h-0 flex-1 auto-cols-[minmax(150px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1"
                data-testid="shot-columns"
            >
                {cameras.map((camera, index) => {
                    const colour = cameraColour(index);
                    const online = onlineIds.has(camera.id);
                    const isLive = live.includes(camera.id);
                    const isNext = !isLive && next.includes(camera.id);
                    const sub = trackingText(camera.id);
                    return (
                        <div
                            key={camera.id}
                            data-testid="shots-row"
                            style={{ '--c': colour, borderTopColor: colour }}
                            className={`flex min-w-0 flex-col gap-2 self-start rounded-xl border-t-[3px] bg-[#12151b] p-2.5 ${camera.id === selectedId ? 'ring-1 ring-[color:var(--c)]/50' : ''}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colour }} />
                                <span className="truncate text-sm font-bold" title={camera.name}>{camera.name}</span>
                                {isLive && <span className="ml-auto shrink-0 rounded bg-live px-1.5 text-[10px] font-bold tracking-wide text-white">LIVE</span>}
                                {isNext && <span className="ml-auto shrink-0 rounded bg-next px-1.5 text-[10px] font-bold tracking-wide text-zinc-900">NEXT</span>}
                            </div>
                            {sub && <div className="-mt-1 truncate text-[11px] text-zinc-500">{sub}</div>}

                            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
                                {camera.presets.map((preset, i) => {
                                    const on = onShot[camera.id] === preset.id;
                                    const base = 'relative flex min-h-[56px] flex-col justify-between rounded-xl border px-2.5 py-2 text-left text-[13px] font-bold leading-tight transition';
                                    const tint = on
                                        ? 'border-transparent text-white shadow-[0_0_0_2px_var(--c),0_0_18px_color-mix(in_srgb,var(--c)_55%,transparent)] bg-[linear-gradient(160deg,color-mix(in_srgb,var(--c)_62%,#12151b),color-mix(in_srgb,var(--c)_22%,#1f232c))]'
                                        : 'border-[color:color-mix(in_srgb,var(--c)_45%,transparent)] text-zinc-100 bg-[linear-gradient(160deg,color-mix(in_srgb,var(--c)_28%,#12151b),#1f232c)]';

                                    if (renaming === preset.id) {
                                        return (
                                            <form
                                                key={preset.id}
                                                onSubmit={(e) => { e.preventDefault(); rename(camera.id, preset.id); }}
                                                className={`${base} ${tint} gap-1 outline outline-2 outline-accent`}
                                            >
                                                <input
                                                    autoFocus
                                                    aria-label="Shot name"
                                                    value={text}
                                                    maxLength={30}
                                                    onChange={(e) => setText(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                                                    className="w-full rounded-md bg-black/45 px-1.5 py-1 text-[13px] font-semibold text-zinc-100 outline-none"
                                                />
                                                <div className="flex justify-end gap-1">
                                                    <button type="submit" disabled={busy} aria-label="Save name" className="rounded p-0.5 text-green-300 hover:bg-white/10"><Check size={15} /></button>
                                                    <button type="button" aria-label="Cancel" onClick={() => setRenaming(null)} className="rounded p-0.5 text-zinc-300 hover:bg-white/10"><X size={15} /></button>
                                                </div>
                                            </form>
                                        );
                                    }

                                    if (editing) {
                                        return (
                                            <div
                                                key={preset.id}
                                                draggable
                                                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDragging({ cameraId: camera.id, presetId: preset.id }); }}
                                                onDragEnd={() => { setDragging(null); setDropAt(null); }}
                                                onDragOver={(e) => { if (dragging?.cameraId === camera.id) { e.preventDefault(); setDropAt(preset.id); } }}
                                                onDrop={(e) => { e.preventDefault(); drop(camera, i); }}
                                                className={`${base} ${tint} cursor-grab border-dashed ${dropAt === preset.id && dragging?.presetId !== preset.id ? 'ring-2 ring-accent' : ''} ${dragging?.presetId === preset.id ? 'opacity-40' : ''}`}
                                                title="Drag to reorder"
                                            >
                                                <span className="pr-12">{preset.name}</span>
                                                <span className="absolute right-1.5 top-1.5 flex gap-1" onMouseDown={stop}>
                                                    <button type="button" aria-label={`Rename ${preset.name}`} onClick={() => { setRenaming(preset.id); setText(preset.name); }} className="grid h-6 w-6 place-items-center rounded-md bg-black/45 text-zinc-100 hover:bg-black/70"><Pencil size={12} /></button>
                                                    <button type="button" aria-label={`Delete ${preset.name}`} onClick={() => remove(camera, preset)} className="grid h-6 w-6 place-items-center rounded-md bg-black/45 text-red-300 hover:bg-black/70"><Trash2 size={12} /></button>
                                                </span>
                                                <span className="self-end text-[11px] tracking-tighter text-zinc-400" aria-hidden="true">⋮⋮</span>
                                            </div>
                                        );
                                    }

                                    return (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            aria-pressed={on}
                                            disabled={!online || busy}
                                            onClick={() => act(window.ptz.recallPreset(camera.id, preset.id))}
                                            className={`${base} ${tint} hover:-translate-y-px hover:shadow-[0_0_0_1px_var(--c)] disabled:opacity-40 disabled:hover:translate-y-0`}
                                        >
                                            <span className="line-clamp-2 break-words">{preset.name}</span>
                                            {on && <span className="text-[9px] font-bold tracking-[0.08em] text-white/90">ON CAMERA</span>}
                                        </button>
                                    );
                                })}

                                {!editing && (adding === camera.id ? (
                                    <form
                                        onSubmit={(e) => { e.preventDefault(); save(camera.id); }}
                                        className="flex min-h-[56px] flex-col justify-between gap-1 rounded-xl border-2 border-dashed p-1.5"
                                        style={{ borderColor: colour }}
                                    >
                                        <input
                                            autoFocus
                                            value={text}
                                            maxLength={30}
                                            placeholder="Name this shot"
                                            onChange={(e) => setText(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Escape' && setAdding(null)}
                                            className="w-full rounded-md bg-black/45 px-1.5 py-1 text-[13px] font-semibold text-zinc-100 outline-none placeholder:text-zinc-500"
                                        />
                                        <div className="flex justify-end gap-1">
                                            <button type="submit" disabled={busy} aria-label="Save shot" className="rounded p-0.5 text-green-300 hover:bg-white/10"><Check size={15} /></button>
                                            <button type="button" aria-label="Cancel" onClick={() => setAdding(null)} className="rounded p-0.5 text-zinc-300 hover:bg-white/10"><X size={15} /></button>
                                        </div>
                                    </form>
                                ) : (
                                    <button
                                        type="button"
                                        aria-label={`Save a shot on ${camera.name}`}
                                        title="Save where this camera is pointing now"
                                        disabled={!online}
                                        onClick={() => { setAdding(camera.id); setText(''); setRenaming(null); }}
                                        style={{ borderColor: `color-mix(in srgb, ${colour} 55%, #2c313c)`, color: colour }}
                                        className="flex min-h-[56px] flex-col items-center justify-center rounded-xl border-2 border-dashed text-xs font-semibold hover:bg-white/5 disabled:opacity-40"
                                    >
                                        <Plus size={22} strokeWidth={1.75} />
                                        Save shot
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
