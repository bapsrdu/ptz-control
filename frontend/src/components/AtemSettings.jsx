import { useEffect, useState } from 'react';

// ATEM switcher settings. All optional: without an ATEM the app is a plain
// camera controller.
export default function AtemSettings({ atemSettings, atem, cameras, onError }) {
    const [host, setHost] = useState(atemSettings.host);
    const [error, setError] = useState(null);
    useEffect(() => setHost(atemSettings.host), [atemSettings.host]);

    const summary = atem.summary;
    const connected = atem.status.state === 'connected' && summary;

    async function save(patch) {
        const out = await window.ptz.setAtem(patch);
        if (!out?.ok) {
            const message = Object.values(out?.errors ?? {})[0] ?? 'Could not save.';
            setError(message);
            onError(message);
        } else {
            setError(null);
        }
    }

    const watching = (type, index) => atemSettings.watched.some((w) => w.type === type && w.index === index);
    function toggleWatched(type, index) {
        const watched = watching(type, index)
            ? atemSettings.watched.filter((w) => !(w.type === type && w.index === index))
            : [...atemSettings.watched, { type, index }];
        save({ watched });
    }

    const keyerValue = atemSettings.lowerThirds
        ? atemSettings.lowerThirds.type === 'dsk'
            ? `dsk:${atemSettings.lowerThirds.index}`
            : `usk:${atemSettings.lowerThirds.me}:${atemSettings.lowerThirds.index}`
        : '';
    function setKeyer(value) {
        if (!value) return save({ lowerThirds: null });
        const [type, a, b] = value.split(':').map((v, i) => (i ? Number(v) : v));
        return save({ lowerThirds: type === 'dsk' ? { type, index: a } : { type, me: a, index: b } });
    }

    const unmapped = cameras.filter((c) => !c.atemInput);
    const input = 'rounded-lg border border-edge bg-black/40 px-3 py-2 text-sm outline-none focus:border-accent';
    const box = 'h-4 w-4 accent-sky-300';

    return (
        <section className="flex flex-col gap-4 rounded-xl border border-edge bg-panel p-5" data-testid="atem-settings">
            <div>
                <h2 className="font-semibold">ATEM switcher (optional)</h2>
                <p className="mt-1 text-sm text-zinc-400">
                    With an ATEM, the app shows which camera is LIVE and NEXT, lights the camera tally lights, asks before
                    moving a live camera, and can turn the lower thirds on and off. It never switches cameras.
                </p>
            </div>

            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); save({ host }); }}>
                <label className="flex flex-1 flex-col gap-1">
                    <span className="text-sm font-medium text-zinc-200">ATEM IP address</span>
                    <input className={input} name="atemHost" value={host} placeholder="Leave empty if there is no ATEM" spellCheck={false} onChange={(e) => setHost(e.target.value)} />
                </label>
                <button type="submit" className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-sky-200">
                    {host.trim() ? 'Connect' : 'Save'}
                </button>
            </form>
            {error && <p className="text-sm text-red-400">{error}</p>}
            {atemSettings.host && (
                <p className="text-sm" data-testid="atem-status">
                    {connected
                        ? <span className="text-green-400">Connected to {atem.status.model}.</span>
                        : <span className="text-amber-300">{atem.status.message}</span>}
                </p>
            )}

            {connected && (
                <>
                    <div className="flex flex-col gap-2">
                        <span className="text-sm font-medium text-zinc-200">What counts as on air</span>
                        <span className="text-xs text-zinc-500">
                            Tick the M/E rows and outputs whose picture people see: the one feeding the stream, and any screens
                            that can show their own source. A camera visible on any ticked item is LIVE.
                        </span>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                            {Array.from({ length: summary.meCount }, (_, me) => (
                                <label key={`me${me}`} className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" className={box} checked={watching('me', me)} onChange={() => toggleWatched('me', me)} />
                                    M/E {me + 1} program
                                </label>
                            ))}
                            {summary.outputs.map((o) => (
                                <label key={`aux${o.index}`} className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" className={box} checked={watching('aux', o.index)} onChange={() => toggleWatched('aux', o.index)} />
                                    <span className="truncate">Output {o.index + 1}{o.name && o.name !== `Output ${o.index + 1}` ? ` · ${o.name}` : ''}</span>
                                </label>
                            ))}
                        </div>
                        {atemSettings.watched.length === 0 && (
                            <p className="text-sm text-amber-300">Nothing is ticked, so no camera will ever show as LIVE.</p>
                        )}
                    </div>

                    <label className="flex flex-col gap-1">
                        <span className="text-sm font-medium text-zinc-200">Lower thirds key</span>
                        <span className="text-xs text-zinc-500">The key that carries the lower thirds. A button to turn it on and off appears at the top of the controls.</span>
                        <select className={input} name="lowerThirds" value={keyerValue} onChange={(e) => setKeyer(e.target.value)}>
                            <option value="">No lower-thirds button</option>
                            {Array.from({ length: summary.dskCount }, (_, i) => (
                                <option key={`dsk${i}`} value={`dsk:${i}`}>Downstream key {i + 1}</option>
                            ))}
                            {summary.uskCounts.map((count, me) => Array.from({ length: count }, (_, k) => (
                                <option key={`usk${me}-${k}`} value={`usk:${me}:${k}`}>M/E {me + 1} key {k + 1}</option>
                            )))}
                        </select>
                    </label>

                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className={box} name="tally" checked={atemSettings.tally} onChange={(e) => save({ tally: e.target.checked })} />
                        Camera tally lights follow the ATEM (red when live, green when next)
                    </label>

                    {unmapped.length > 0 && (
                        <p className="text-sm text-amber-300">
                            Choose the ATEM input for {unmapped.map((c) => c.name).join(', ')} (edit the camera above), or
                            {unmapped.length === 1 ? ' it' : ' they'} will never show as LIVE.
                        </p>
                    )}
                </>
            )}
        </section>
    );
}
