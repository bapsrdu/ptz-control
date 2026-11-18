// How pictures reach the screens: what each M/E is for, every aux output as
// picture -> screen, and the operator's routing buttons.
import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Trash2 } from 'lucide-react';
import { Btn, Card, Col, Field, NameDialog, Page, PageHeader, PanelButton, Select, Tag } from './ui.jsx';
import { meIndex, mixName, routeActive, routeLabel, updateConfig } from './lib.js';

export default function Routing({ state, notify }) {
    const a = state.atem;
    const c = state.config;
    const [naming, setNaming] = useState(false);
    const [renaming, setRenaming] = useState(null);
    const [showHidden, setShowHidden] = useState(false);
    if (!a?.connected) {
        return (
            <Page>
                <PageHeader title="Routing" purpose="Screens, outputs and the operator's routing buttons." />
                <Card><p className="text-sm text-muted">The switcher is not connected. Set its address in Setup.</p></Card>
            </Page>
        );
    }
    const result = (out) => { if (out && !out.ok) notify(out.message); };
    const sourceOptions = a.auxSources.map((id) => [routeLabel(state, id), id]);
    const named = new Set(c.screens.flatMap((s) => s.aux));
    const unnamed = a.aux.map((_, i) => i + 1).filter((n) => !named.has(n));
    const shown = c.screens.map((s, i) => ({ s, i })).filter(({ s }) => s.volunteer !== false);
    const hidden = c.screens.map((s, i) => ({ s, i })).filter(({ s }) => s.volunteer === false);
    const setScreen = (i, patch) => updateConfig(state, (cc) => { Object.assign(cc.screens[i], patch); return cc; });
    const routeScreen = (screen, source) => window.booth.route(screen.aux.map((aux) => ({ aux, source }))).then(result);

    const screenRow = ({ s, i }) => {
        const now = [...new Set(s.aux.map((n) => a.aux[n - 1] ?? null))];
        return (
            <div key={`${s.name}${i}`} className="flex items-center gap-3" data-testid="screen-row">
                <div style={{ width: 240 }}>
                    <Select value={now.length === 1 ? now[0] ?? '' : ''} placeholder={now.length > 1 ? 'Different pictures' : undefined}
                        width={240} options={sourceOptions} onChange={(v) => v !== '' && routeScreen(s, Number(v))} testid="screen-source" />
                </div>
                <span className="w-16 shrink-0 text-xs text-subtle">→ Aux {s.aux.join(', ')}</span>
                <Field value={s.name} width={170} onChange={(v) => v.trim() && setScreen(i, { name: v.trim() })} testid="screen-name" />
                <Field value={s.note ?? ''} placeholder="How it is wired" width={220} onChange={(v) => setScreen(i, { note: v.trim() || undefined })} />
                <label className="flex items-center gap-1 text-xs text-muted" title="Show this screen in the operator's summary and routing">
                    <input type="checkbox" checked={s.volunteer !== false} onChange={(e) => setScreen(i, { volunteer: e.target.checked })} /> Operators
                </label>
                <label className="flex items-center gap-1 text-xs text-muted" title="Show a small live picture of it in the top bar">
                    <input type="checkbox" checked={Boolean(s.pinned)} onChange={(e) => updateConfig(state, (cc) => {
                        // Writing down the default pins first, so the others do not change.
                        const pins = new Set(cc.screens.some((x) => x.pinned !== undefined) ? cc.screens.filter((x) => x.pinned).map((x) => x.name)
                            : cc.screens.filter((x) => x.volunteer !== false).slice(0, 3).map((x) => x.name));
                        cc.screens.forEach((x, j) => { x.pinned = j === i ? e.target.checked : pins.has(x.name); });
                        return cc;
                    })} /> Top bar
                </label>
                <div className="flex-1" />
                <button type="button" title="Forget this screen (the output stays as it is)" className="text-subtle hover:text-danger"
                    onClick={() => updateConfig(state, (cc) => { cc.screens.splice(i, 1); return cc; })}><Trash2 size={14} /></button>
            </div>
        );
    };

    return (
        <Page>
            <PageHeader title="Routing" purpose="How pictures reach the screens, and the operator's routing buttons."
                help="Every aux output, as picture → aux → the screen it feeds. Pick a new picture and it changes right away. Outputs listed together switch together. Outputs that feed encoders or recorders can be hidden from operators. Route the screens the way you want, then save that as a button: the buttons sit under Fade and Cut on Operate, work like macros, and light up while the screens match them." />
            <Card title="Mixes">
                {a.mes.map((m, me) => (
                    <div key={me} className="flex flex-col gap-2" data-testid="mix-row">
                        <div className="flex items-center gap-3">
                            <span className="w-14 text-sm font-bold">M/E {me + 1}</span>
                            <Field value={c.mixNames[me] ?? ''} placeholder={me === 0 ? 'Live stream' : 'Side screens'} width={200}
                                onChange={(v) => updateConfig(state, (cc) => { while (cc.mixNames.length <= me) cc.mixNames.push(''); cc.mixNames[me] = v.trim(); return cc; })} />
                            <span className="text-xs text-muted">Live: {routeLabel(state, m.program)} · Next: {routeLabel(state, m.preview)}</span>
                            {me === meIndex(state) && <Tag tone="accent">The operator runs this</Tag>}
                        </div>
                        {me !== meIndex(state) && (
                            <div className="flex flex-wrap gap-1.5 pl-[68px]">
                                {a.busSources.map((id) => (
                                    <PanelButton key={id} title={a.inputs[id]?.short} help={`Put ${routeLabel(state, id)} live on ${mixName(state, me)}`}
                                        lit={m.program === id ? 'program' : null} width={64} height={34} size={11} onClick={() => window.booth.atem('program', id, me).then(result)} />
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </Card>
            <Card title="Screens and outputs">
                <div className="flex gap-3"><Col width={240}>Picture</Col><Col width={64}>Output</Col><Col width={170}>Screen</Col><Col width={220}>Wiring</Col></div>
                {!c.screens.length && <p className="text-sm text-muted">No screens named yet. Name the outputs below.</p>}
                {shown.map(screenRow)}
                {hidden.length > 0 && (
                    <>
                        <button type="button" className="flex items-center gap-1.5 text-left" onClick={() => setShowHidden((v) => !v)}>
                            {showHidden ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            <span className="caps text-[11px] text-subtle">Encoders and feeds</span>
                            <span className="text-[11px] text-subtle">{hidden.length}</span>
                        </button>
                        {showHidden && hidden.map(screenRow)}
                    </>
                )}
                {unnamed.length > 0 && (
                    <div className="flex flex-col gap-2 border-t border-line pt-3">
                        <span className="text-[11px] text-subtle">Outputs not named yet</span>
                        {unnamed.map((n) => (
                            <div key={n} className="flex items-center gap-3" data-testid="unnamed-output">
                                <Select value={a.aux[n - 1] ?? ''} width={240} options={sourceOptions} onChange={(v) => window.booth.atem('aux', n - 1, Number(v)).then(result)} />
                                <span className="w-16 text-xs text-subtle">→ Aux {n}</span>
                                <Btn testid="name-output" onClick={() => updateConfig(state, (cc) => { cc.screens.push({ name: `Aux ${n}`, aux: [n] }); return cc; })}>Name this output</Btn>
                                {c.screens.length > 0 && (
                                    <Select value="" placeholder="Switch together with…" width={200}
                                        options={c.screens.map((s, i) => [s.name, i])}
                                        onChange={(v) => v !== '' && updateConfig(state, (cc) => { cc.screens[Number(v)].aux.push(n); return cc; })} />
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </Card>
            <Card title="Operator routing buttons" help="Route the screens above the way you want them, then save it as a button. One press puts every screen back that way. A button is lit while the screens match it.">
                <div className="flex flex-wrap items-center gap-2">
                    {c.routes.map((r, i) => (
                        <div key={r.label} className="flex items-center gap-1 rounded-lg border border-line p-1">
                            <PanelButton title={r.label} subtitle={`${r.set.length} output${r.set.length === 1 ? '' : 's'}`} lit={routeActive(state, r) ? 'accent' : null}
                                width={130} height={40} size={12} testid="routing-button" onClick={() => window.booth.route(r.set).then(result)} />
                            <div className="flex flex-col">
                                <button type="button" title="Earlier" disabled={i === 0} className="text-subtle disabled:opacity-30" onClick={() => updateConfig(state, (cc) => { [cc.routes[i - 1], cc.routes[i]] = [cc.routes[i], cc.routes[i - 1]]; return cc; })}><ChevronUp size={12} /></button>
                                <button type="button" title="Later" disabled={i === c.routes.length - 1} className="text-subtle disabled:opacity-30" onClick={() => updateConfig(state, (cc) => { [cc.routes[i + 1], cc.routes[i]] = [cc.routes[i], cc.routes[i + 1]]; return cc; })}><ChevronDown size={12} /></button>
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <Btn kind="quiet" onClick={() => setRenaming(i)}>Rename</Btn>
                                <Btn kind="quiet" onClick={() => updateConfig(state, (cc) => { cc.routes[i].set = routesNow(cc, a, true); return cc; })}>Update</Btn>
                            </div>
                            <button type="button" title="Remove this button" className="px-1 text-subtle hover:text-danger" onClick={() => updateConfig(state, (cc) => { cc.routes.splice(i, 1); return cc; })}><Trash2 size={13} /></button>
                        </div>
                    ))}
                    <Btn kind="primary" testid="save-routing" disabled={!c.screens.some((s) => s.volunteer !== false)} onClick={() => setNaming(true)}
                        help="Save how the operators' screens are routed now as a button">Save the routing now as a button</Btn>
                </div>
                {shown.length > 0 && (
                    <div className="flex flex-col gap-1 border-t border-line pt-3 text-[13px]" data-testid="screen-summary">
                        {shown.map(({ s }) => {
                            const now = [...new Set(s.aux.map((n) => a.aux[n - 1] ?? null))];
                            return <div key={s.name}><span className="font-semibold">{s.name}</span> <span className="text-muted">is showing {now.length > 1 ? 'different pictures on its outputs' : routeLabel(state, now[0])}</span></div>;
                        })}
                    </div>
                )}
            </Card>
            {naming && (
                <NameDialog title="Save the routing as a button" note="Saves what every operator screen shows now." placeholder="Lobby: stream" onClose={() => setNaming(false)}
                    onSave={(label) => label && updateConfig(state, (cc) => { cc.routes = cc.routes.filter((r) => r.label !== label); cc.routes.push({ label, set: routesNow(cc, a, true) }); return cc; })} />
            )}
            {renaming !== null && (
                <NameDialog title="Rename routing button" initial={c.routes[renaming]?.label} onClose={() => setRenaming(null)}
                    onSave={(label) => label && updateConfig(state, (cc) => { cc.routes[renaming].label = label; return cc; })} />
            )}
        </Page>
    );
}

// What the screens show now, as routing changes.
function routesNow(config, atem, operatorsOnly) {
    const out = [];
    for (const s of config.screens) {
        if (operatorsOnly && s.volunteer === false) continue;
        for (const aux of s.aux) {
            const source = atem.aux[aux - 1];
            if (Number.isInteger(source)) out.push({ aux, source });
        }
    }
    return out;
}
