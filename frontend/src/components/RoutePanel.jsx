import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { buttonActive, buttonLines, buttonSummary, screenShowing, sourceLabel } from '../routingText.js';

// The operator's routing buttons, and what every screen shows now. Each
// button sends one or more screens a picture; it is lit while the switcher
// already matches it.
export default function RoutePanel({ routing, summary, onOpenRouting, onError }) {
    const [busy, setBusy] = useState(null);
    const aux = summary?.aux ?? [];
    const names = summary?.names ?? {};
    const screens = routing.screens.filter((s) => s.operators);

    async function run(button) {
        setBusy(button.id);
        try {
            const out = await window.ptz.routing.run(button.id);
            if (!out?.ok) onError(out?.message || 'The switcher did not accept that.');
        } finally {
            setBusy(null);
        }
    }

    return (
        <div className="flex flex-col gap-3" data-testid="route-panel">
            {!summary && <p className="text-sm text-zinc-400">Waiting for the ATEM...</p>}
            {summary && routing.buttons.length === 0 && (
                <p className="text-sm text-zinc-400">
                    No routing buttons yet. Set them up on the{' '}
                    <button type="button" onClick={onOpenRouting} className="text-accent underline-offset-4 hover:underline">Routing page</button>.
                </p>
            )}
            {summary && routing.buttons.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                    {routing.buttons.map((b) => {
                        const on = buttonActive(b, aux);
                        return (
                            <button
                                key={b.id}
                                type="button"
                                aria-pressed={on}
                                disabled={busy !== null}
                                title={buttonLines(b, routing.screens, routing.mixNames, names).join('\n')}
                                onClick={() => run(b)}
                                className={`flex min-h-[56px] flex-col items-center justify-center rounded-xl border px-2 py-1.5 text-center transition disabled:cursor-wait ${on ? 'border-accent bg-accent text-zinc-900' : 'border-edge bg-panel-2 text-zinc-100 hover:bg-white/10'}`}
                            >
                                <span className="line-clamp-2 text-[13px] font-semibold leading-tight">{b.label}</span>
                                <span className="mt-0.5 line-clamp-1 text-[9px] font-bold uppercase tracking-wide opacity-75">{on ? 'On' : buttonSummary(b, routing.screens)}</span>
                            </button>
                        );
                    })}
                </div>
            )}
            {summary && screens.length > 0 && (
                <ul className="flex flex-col gap-1 text-[13px]" data-testid="screens-now">
                    {screens.map((s) => (
                        <li key={s.id} className="flex min-w-0 items-center gap-1.5">
                            <span className="shrink-0 font-semibold text-zinc-400">{s.name}</span>
                            <ArrowLeft size={11} className="shrink-0 text-zinc-500" />
                            <span className="truncate">{sourceLabel(screenShowing(s, aux), routing.mixNames, names)}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
