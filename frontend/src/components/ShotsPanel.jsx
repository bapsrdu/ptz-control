import { useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { snapshot } from '../videoHub.js';

// Saved shots: one row per camera. Click a shot to send that camera to it.
// "+" saves where the camera is pointing now.
export default function ShotsPanel({ cameras, selectedId, onlineIds, onError }) {
    const [editing, setEditing] = useState(false);
    const [adding, setAdding] = useState(null); // cameraId
    const [renaming, setRenaming] = useState(null); // presetId
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);

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
        // Take the picture now, before the camera can move.
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

    const chip = 'rounded-lg px-3 py-1.5 text-sm font-medium';

    return (
        <div className="flex flex-col gap-2" data-testid="shots-panel">
            <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Shots</h2>
                <button
                    type="button"
                    onClick={() => { setEditing((e) => !e); setRenaming(null); setAdding(null); }}
                    className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${editing ? 'bg-accent text-zinc-900' : 'text-zinc-400 hover:bg-white/10'}`}
                >
                    <Pencil size={13} /> {editing ? 'Done editing' : 'Edit shots'}
                </button>
            </div>
            {cameras.map((camera) => {
                const online = onlineIds.has(camera.id);
                return (
                    <div key={camera.id} className="flex flex-wrap items-center gap-2" data-testid="shots-row">
                        <span className={`w-28 shrink-0 truncate rounded-lg border px-2.5 py-1.5 text-sm font-semibold ${camera.id === selectedId ? 'border-next text-white' : 'border-edge text-zinc-400'}`}>
                            {camera.name}
                        </span>
                        {camera.presets.map((preset) => (
                            renaming === preset.id ? (
                                <form key={preset.id} className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); rename(camera.id, preset.id); }}>
                                    <input autoFocus value={text} maxLength={30} onChange={(e) => setText(e.target.value)} className="w-32 rounded-md border border-edge bg-black/40 px-2 py-1 text-sm" />
                                    <button type="submit" disabled={busy} aria-label="Save name" className="rounded-md p-1.5 text-green-400 hover:bg-white/10"><Check size={16} /></button>
                                    <button type="button" aria-label="Cancel" onClick={() => setRenaming(null)} className="rounded-md p-1.5 text-zinc-400 hover:bg-white/10"><X size={16} /></button>
                                </form>
                            ) : editing ? (
                                <span key={preset.id} className={`${chip} flex items-center gap-1 bg-panel-2 text-zinc-200`}>
                                    {preset.name}
                                    <button type="button" aria-label={`Rename ${preset.name}`} onClick={() => { setRenaming(preset.id); setText(preset.name); }} className="ml-1 rounded p-0.5 text-zinc-400 hover:text-white"><Pencil size={13} /></button>
                                    <button type="button" aria-label={`Delete ${preset.name}`} onClick={() => remove(camera, preset)} className="rounded p-0.5 text-zinc-400 hover:text-red-400"><Trash2 size={13} /></button>
                                </span>
                            ) : (
                                <button
                                    key={preset.id}
                                    type="button"
                                    disabled={!online || busy}
                                    onClick={() => act(window.ptz.recallPreset(camera.id, preset.id))}
                                    className={`${chip} flex items-center gap-2 bg-zinc-200 text-zinc-900 hover:bg-white disabled:opacity-40 ${preset.thumb ? 'py-1 pl-1' : ''}`}
                                >
                                    {preset.thumb && (
                                        <img src={`ptz-shot://shots/${preset.id}.jpg`} alt="" draggable={false} className="h-8 w-14 rounded object-cover" />
                                    )}
                                    {preset.name}
                                </button>
                            )
                        ))}
                        {adding === camera.id ? (
                            <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); save(camera.id); }}>
                                <input autoFocus value={text} maxLength={30} placeholder="Name this shot" onChange={(e) => setText(e.target.value)} className="w-36 rounded-md border border-edge bg-black/40 px-2 py-1 text-sm" />
                                <button type="submit" disabled={busy} aria-label="Save shot" className="rounded-md p-1.5 text-green-400 hover:bg-white/10"><Check size={16} /></button>
                                <button type="button" aria-label="Cancel" onClick={() => setAdding(null)} className="rounded-md p-1.5 text-zinc-400 hover:bg-white/10"><X size={16} /></button>
                            </form>
                        ) : (
                            <button
                                type="button"
                                aria-label={`Save a shot on ${camera.name}`}
                                title="Save where this camera is pointing now"
                                disabled={!online}
                                onClick={() => { setAdding(camera.id); setText(''); setRenaming(null); }}
                                className="rounded-lg border border-dashed border-edge p-1.5 text-accent hover:bg-white/10 disabled:opacity-40"
                            >
                                <Plus size={16} />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
