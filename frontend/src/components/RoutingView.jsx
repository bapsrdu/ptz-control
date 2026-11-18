import { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Pencil, Play, Trash2, X } from 'lucide-react';
import { auxText, buttonActive, buttonLines, screenShowing, sourceLabel } from '../routingText.js';

// The Routing page: which picture goes to which screen. Changes here happen
// on the switcher right away. Based on the routing page of Churchfront's
// CueVideo (Apache 2.0).
export default function RoutingView({ state, onBack, onError }) {
    const { settings, atem } = state;
    const routing = settings.routing;
    const summary = atem.status.state === 'connected' ? atem.summary : null;
    const [showFeeds, setShowFeeds] = useState(false);
    const [newButton, setNewButton] = useState(false);

    async function act(promise) {
        const out = await promise;
        if (!out?.ok) onError(out?.message || Object.values(out?.errors ?? {})[0] || 'That did not work.');
        return out;
    }

    const aux = summary?.aux ?? [];
    const names = summary?.names ?? {};
    const sources = summary?.auxSources ?? [];
    const named = new Set(routing.screens.flatMap((s) => s.aux));
    const unnamed = aux.map((_, i) => i).filter((i) => !named.has(i));
    const forOperators = routing.screens.filter((s) => s.operators);
    const feeds = routing.screens.filter((s) => !s.operators);
    const label = (src) => sourceLabel(src, routing.mixNames, names);

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6" data-testid="routing-view">
            <div className="flex items-center gap-3">
                <button type="button" onClick={onBack} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-zinc-300 hover:bg-white/10">
                    <ArrowLeft size={16} /> Back to controls
                </button>
                <div>
                    <h1 className="text-lg font-semibold">Routing</h1>
                    <p className="text-sm text-zinc-400">Which picture goes to which screen. A change here happens on the switcher right away.</p>
                </div>
            </div>

            {!summary ? (
                <p className="rounded-xl border border-edge bg-panel p-6 text-zinc-300">
                    {settings.atem.host
                        ? 'Waiting for the ATEM. Routing appears once the app is connected to it.'
                        : 'Routing needs the ATEM. Add its IP address in Settings first.'}
                </p>
            ) : (
                <>
                    <Section title="Mixes" hint="What each M/E is for. Its name is used everywhere a source shows it.">
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                            {summary.mixes.map((m, me) => (
                                <MixCard key={me} me={me} mix={m} name={routing.mixNames[me] ?? ''} label={label} onRename={(n) => act(window.ptz.routing.mixName(me, n))} />
                            ))}
                        </div>
                    </Section>

                    <Section title={`Screens ${forOperators.length || ''}`} hint="The screens the aux outputs feed. Name an output to make it a screen; outputs listed together switch together, such as a left and right pair.">
                        {forOperators.length === 0 && <p className="text-sm text-zinc-400">No screens named yet. Name the outputs below.</p>}
                        <ScreenGrid screens={forOperators} aux={aux} sources={sources} label={label} auxCount={aux.length} routing={routing} act={act} />
                    </Section>

                    {feeds.length > 0 && (
                        <div className="flex flex-col gap-3">
                            <button type="button" onClick={() => setShowFeeds((s) => !s)} className="flex w-fit items-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-400 hover:text-zinc-200">
                                <ChevronDown size={14} className={showFeeds ? '' : '-rotate-90'} /> Encoders and feeds {feeds.length}
                            </button>
                            {showFeeds && <ScreenGrid screens={feeds} aux={aux} sources={sources} label={label} auxCount={aux.length} routing={routing} act={act} />}
                        </div>
                    )}

                    {unnamed.length > 0 && (
                        <Section title={`Outputs not named yet ${unnamed.length}`} hint="Give an output a name to make it a screen.">
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
                                {unnamed.map((a) => (
                                    <ScreenCard
                                        key={a}
                                        screen={{ id: null, name: `Aux ${a + 1}`, aux: [a], note: '', operators: true }}
                                        unnamedHint={summary.outputs?.[a]?.name}
                                        aux={aux}
                                        sources={sources}
                                        label={label}
                                        auxCount={aux.length}
                                        routing={routing}
                                        act={act}
                                    />
                                ))}
                            </div>
                        </Section>
                    )}

                    <Section
                        title="Operator routing buttons"
                        hint="Buttons on the main screen (Screens). Each one sends one or more screens a picture, like a macro, and lights up while the screens match it. The easy way to make one: route the screens the way you want above, then save that as a button."
                        action={(
                            <button type="button" onClick={() => setNewButton((v) => !v)} className="rounded-lg bg-panel-2 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-white/10">
                                Save the current routing as a button...
                            </button>
                        )}
                    >
                        {newButton && <NewButton routing={routing} aux={aux} label={label} act={act} onDone={() => setNewButton(false)} />}
                        {routing.buttons.length === 0 && !newButton && <p className="text-sm text-zinc-400">No buttons yet.</p>}
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                            {routing.buttons.map((b, i) => (
                                <ButtonCard key={b.id} button={b} first={i === 0} last={i === routing.buttons.length - 1} on={buttonActive(b, aux)} lines={buttonLines(b, routing.screens, routing.mixNames, names)} act={act} />
                            ))}
                        </div>
                    </Section>
                </>
            )}
        </div>
    );
}

function Section({ title, hint, action, children }) {
    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400" title={hint}>{title}</h2>
                {action && <div className="ml-auto">{action}</div>}
            </div>
            {children}
        </section>
    );
}

const field = 'w-full rounded-lg border border-edge bg-panel-2 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent';

function MixCard({ me, mix, name, label, onRename }) {
    const [text, setText] = useState(name);
    const save = () => text.trim() !== name && onRename(text);
    return (
        <div className="flex flex-col gap-2 rounded-xl border border-edge bg-panel p-3" data-testid="mix-card">
            <div className="text-xs text-zinc-500">M/E {me + 1}</div>
            <input
                aria-label={`What M/E ${me + 1} is for`}
                placeholder="What is it for? Such as Live stream"
                value={text}
                maxLength={30}
                onChange={(e) => setText(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                className={field}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="flex items-center gap-1.5"><span className="rounded bg-live px-1.5 text-[10px] font-bold text-white">LIVE</span>{label(mix.live)}</span>
                <span className="flex items-center gap-1.5"><span className="rounded bg-next px-1.5 text-[10px] font-bold text-zinc-900">NEXT</span>{label(mix.next)}</span>
            </div>
        </div>
    );
}

function ScreenGrid({ screens, ...rest }) {
    return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
            {screens.map((s) => <ScreenCard key={s.id} screen={s} {...rest} />)}
        </div>
    );
}

function SourceSelect({ value, sources, label, onChange, ariaLabel }) {
    const listed = sources.some((s) => s.id === value);
    return (
        <select aria-label={ariaLabel} value={value === null ? '' : String(value)} onChange={(e) => onChange(Number(e.target.value))} className={field}>
            {value === 'mixed' && <option value="mixed" disabled>Mixed</option>}
            {value === null && <option value="" disabled>Nothing</option>}
            {value !== null && value !== 'mixed' && !listed && <option value={value}>{label(value)}</option>}
            {sources.map((s) => <option key={s.id} value={s.id}>{label(s.id)}</option>)}
        </select>
    );
}

function ScreenCard({ screen, unnamedHint, aux, sources, label, auxCount, act }) {
    const [editing, setEditing] = useState(false);
    const showing = screenShowing(screen, aux);
    return (
        <div className="flex flex-col gap-2 rounded-xl border border-edge bg-panel p-3" data-testid="screen-card">
            <div className="flex items-center gap-2">
                <span className={`truncate font-semibold ${screen.id ? '' : 'text-zinc-400'}`}>{screen.name}</span>
                {unnamedHint && unnamedHint !== `Output ${screen.aux[0] + 1}` && <span className="truncate text-xs text-zinc-500">{unnamedHint}</span>}
                <span className="ml-auto shrink-0 text-xs text-zinc-500">{screen.id ? auxText(screen.aux) : ''}</span>
                <button type="button" aria-label={screen.id ? `Edit ${screen.name}` : `Name ${screen.name}`} title={screen.id ? 'Change the name, outputs or wiring note' : 'Name this output'} onClick={() => setEditing((e) => !e)} className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-100">
                    <Pencil size={14} />
                </button>
            </div>
            <SourceSelect
                ariaLabel={`What ${screen.name} shows`}
                value={showing}
                sources={sources}
                label={label}
                onChange={(src) => act(window.ptz.routing.route(screen.aux, src))}
            />
            {screen.note && <div className="text-xs text-zinc-500">{screen.note}</div>}
            {editing && <ScreenEditor screen={screen} auxCount={auxCount} act={act} onDone={() => setEditing(false)} />}
        </div>
    );
}

function ScreenEditor({ screen, auxCount, act, onDone }) {
    const [name, setName] = useState(screen.id ? screen.name : '');
    const [auxList, setAuxList] = useState(screen.aux);
    const [note, setNote] = useState(screen.note ?? '');
    const [operators, setOperators] = useState(screen.operators);

    async function save(e) {
        e.preventDefault();
        const out = await act(window.ptz.routing.saveScreen({ id: screen.id ?? undefined, name, aux: auxList, note, operators }));
        if (out?.ok) onDone();
    }
    async function forget() {
        const out = await act(window.ptz.routing.removeScreen(screen.id));
        if (out?.ok) onDone();
    }
    const toggle = (a) => setAuxList((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a].sort((x, y) => x - y)));

    return (
        <form onSubmit={save} className="mt-1 flex flex-col gap-2 rounded-lg border border-edge bg-panel-2 p-3" data-testid="screen-editor">
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
                Name
                <input autoFocus value={name} maxLength={40} placeholder="Such as Lobby TVs" onChange={(e) => setName(e.target.value)} className={field} />
            </label>
            <div className="flex flex-col gap-1 text-xs text-zinc-400">
                Aux outputs (several switch together)
                <div className="flex flex-wrap gap-1">
                    {Array.from({ length: auxCount }, (_, a) => (
                        <button key={a} type="button" aria-pressed={auxList.includes(a)} onClick={() => toggle(a)} className={`h-7 min-w-7 rounded-md px-1.5 text-xs font-semibold ${auxList.includes(a) ? 'bg-accent text-zinc-900' : 'bg-panel text-zinc-300 hover:bg-white/10'}`}>
                            {a + 1}
                        </button>
                    ))}
                </div>
            </div>
            <label className="flex flex-col gap-1 text-xs text-zinc-400">
                Wiring note
                <input value={note} maxLength={120} placeholder="Such as Converter 1 → Lobby TV" onChange={(e) => setNote(e.target.value)} className={field} />
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300" title="Off for encoders, recorders and patch bay feeds: they move to Encoders and feeds">
                <input type="checkbox" checked={operators} onChange={(e) => setOperators(e.target.checked)} /> Show to operators
            </label>
            <div className="flex items-center gap-2">
                {screen.id && (
                    <button type="button" onClick={forget} title="The output stays; it goes back to Outputs not named yet" className="rounded-lg px-2.5 py-1.5 text-sm text-red-300 hover:bg-red-500/10">Forget this name</button>
                )}
                <button type="button" onClick={onDone} className="ml-auto rounded-lg px-2.5 py-1.5 text-sm text-zinc-300 hover:bg-white/10">Cancel</button>
                <button type="submit" disabled={!name.trim() || !auxList.length} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-zinc-900 disabled:opacity-40">Save</button>
            </div>
        </form>
    );
}

function NewButton({ routing, aux, label, act, onDone }) {
    const [text, setText] = useState('');
    const [picked, setPicked] = useState([]);
    async function save(e) {
        e.preventDefault();
        const out = await act(window.ptz.routing.addButton({ label: text, screenIds: picked }));
        if (out?.ok) onDone();
    }
    return (
        <form onSubmit={save} className="flex max-w-xl flex-col gap-3 rounded-xl border border-accent/40 bg-panel p-4" data-testid="new-route-button">
            <div className="flex items-center">
                <h3 className="font-semibold">New routing button</h3>
                <button type="button" aria-label="Cancel" onClick={onDone} className="ml-auto rounded p-1 text-zinc-400 hover:bg-white/10"><X size={16} /></button>
            </div>
            <input autoFocus aria-label="Button label" value={text} maxLength={40} placeholder="Label, such as Lobby: stream" onChange={(e) => setText(e.target.value)} className={field} />
            <div className="text-sm text-zinc-400">Screens it sets, to what they show now:</div>
            {routing.screens.length === 0 && <p className="text-sm text-amber-300">Name the screens first.</p>}
            <div className="flex flex-col gap-1.5">
                {routing.screens.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={picked.includes(s.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))} />
                        {s.name} ← {label(screenShowing(s, aux))}
                    </label>
                ))}
            </div>
            <div className="flex justify-end gap-2">
                <button type="button" onClick={onDone} className="rounded-lg px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/10">Cancel</button>
                <button type="submit" disabled={!text.trim() || !picked.length} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-zinc-900 disabled:opacity-40">Save button</button>
            </div>
        </form>
    );
}

function ButtonCard({ button, first, last, on, lines, act }) {
    const [text, setText] = useState(button.label);
    const save = () => text.trim() && text.trim() !== button.label ? act(window.ptz.routing.renameButton(button.id, text)) : setText(button.label);
    const icon = 'grid h-7 w-7 place-items-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent';
    return (
        <div className={`flex flex-col gap-2 rounded-xl border bg-panel p-3 ${on ? 'border-accent' : 'border-edge'}`} data-testid="route-button-card">
            <div className="flex items-center gap-2">
                <input aria-label="Button label" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} className={field} />
                {on && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-zinc-900">ON</span>}
            </div>
            <div className="text-xs text-zinc-400">{lines.map((l) => <div key={l}>{l}</div>)}</div>
            <div className="flex items-center gap-1">
                <button type="button" onClick={() => act(window.ptz.routing.run(button.id))} className="flex items-center gap-1.5 rounded-lg bg-panel-2 px-3 py-1.5 text-sm font-medium hover:bg-white/10">
                    <Play size={13} /> Run now
                </button>
                <button type="button" aria-label="Move earlier" disabled={first} onClick={() => act(window.ptz.routing.moveButton(button.id, -1))} className={`${icon} ml-auto`}><ChevronLeft size={16} /></button>
                <button type="button" aria-label="Move later" disabled={last} onClick={() => act(window.ptz.routing.moveButton(button.id, 1))} className={icon}><ChevronRight size={16} /></button>
                <button type="button" aria-label={`Remove ${button.label}`} onClick={() => window.confirm(`Remove the button "${button.label}"?`) && act(window.ptz.routing.removeButton(button.id))} className={icon}><Trash2 size={14} /></button>
            </div>
        </div>
    );
}

