// Every switcher control, for experienced operators: program and preview
// rows with the transition block beside them, then keys, macros and aux
// outputs. What is pressed here goes to air like the hardware panel.
import { useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Btn, Card, Page, PageHeader, PanelButton, Segments, Select } from './ui.jsx';
import { frames, meIndex } from './lib.js';

export default function Switcher({ state }) {
    const a = state.atem;
    const [me, setMe] = useState(meIndex(state));
    if (!a?.connected) {
        return (
            <Page>
                <PageHeader title="Full switcher" purpose="Every control on the switcher." />
                <Card><p className="text-sm text-muted">The switcher is not connected. Set its address in Setup.</p></Card>
            </Page>
        );
    }
    const m = a.mes[Math.min(me, a.mes.length - 1)];
    const cmd = (name, ...args) => window.booth.atem(name, ...args);
    const name = (id) => a.inputs[id]?.long ?? `Input ${id}`;
    return (
        <Page>
            <PageHeader title="Full switcher" purpose="Every control on the switcher. What you press here goes to air like the hardware panel.">
                <span className="text-xs text-muted">{a.product}</span>
                {a.meCount > 1 && <Segments testid="me-picker" items={a.mes.map((_, i) => [`M/E ${i + 1}`, i])} value={me} onChange={setMe} />}
            </PageHeader>
            <div className="flex items-start gap-4">
                <Card className="flex-1">
                    <Bus title="Program" tone="program" sources={a.busSources} inputs={a.inputs} selected={m.program} onPick={(id) => cmd('program', id, me)} testid="bus-program" />
                    <Bus title="Preview" tone="preview" sources={a.busSources} inputs={a.inputs} selected={m.preview} onPick={(id) => cmd('preview', id, me)} testid="bus-preview" />
                </Card>
                <Card title="Transition">
                    <div className="flex items-start gap-4">
                        <div className="flex flex-col gap-2">
                            {['MIX', 'DIP', 'WIPE', 'DVE'].map((n, i) => (
                                <PanelButton key={n} title={n} lit={m.style === i ? 'warning' : null} width={62} height={32} size={11} testid={`style-${n.toLowerCase()}`} onClick={() => cmd('style', i, me)} />
                            ))}
                            <div className="flex items-center gap-0.5" title="Mix length in seconds and frames">
                                <button type="button" title="Shorter mix" className="p-1 text-muted" onClick={() => cmd('mixRate', m.mixRate - 5, me)}><Minus size={12} /></button>
                                <span className="w-9 text-center text-xs font-semibold" data-testid="mix-rate">{frames(m.mixRate)}</span>
                                <button type="button" title="Longer mix" className="p-1 text-muted" onClick={() => cmd('mixRate', m.mixRate + 5, me)}><Plus size={12} /></button>
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <PanelButton title="CUT" width={84} height={52} size={15} testid="sw-cut" onClick={() => cmd('cut', me)} />
                            <PanelButton title="AUTO" lit={m.inTransition ? 'program' : null} width={84} height={52} size={15} testid="sw-auto" onClick={() => cmd('auto', me)} />
                            <PanelButton title="FTB" help="Fade to black" lit={m.ftbBlack || m.ftbInTransition ? 'program' : null} blink={m.ftbBlack} width={84} height={36} size={12} testid="sw-ftb" onClick={() => cmd('ftb', me)} />
                        </div>
                        <TBar m={m} me={me} />
                    </div>
                </Card>
            </div>
            <div className="flex items-start gap-4">
                {(m.keys.length > 0 || a.dskCount > 0) && (
                    <Card title="Keys">
                        <div className="flex items-start gap-5">
                            {m.keys.length > 0 && (
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-[11px] text-subtle">Next transition takes</span>
                                    <div className="flex gap-2">
                                        <PanelButton title="BKGD" lit={m.nextSelection & 1 ? 'warning' : null} width={62} height={40} size={12} testid="sel-bkgd" onClick={() => cmd('selection', m.nextSelection ^ 1, me)} />
                                        {m.keys.map((_, k) => (
                                            <PanelButton key={k} title={`KEY ${k + 1}`} lit={m.nextSelection & (2 << k) ? 'warning' : null} width={62} height={40} size={12} testid={`sel-key${k + 1}`}
                                                onClick={() => cmd('selection', m.nextSelection ^ (2 << k), me)} />
                                        ))}
                                    </div>
                                    <span className="mt-2 text-[11px] text-subtle">On air</span>
                                    <div className="flex gap-2">
                                        {m.keys.map((key, k) => (
                                            <PanelButton key={k} title={`KEY ${k + 1}`} lit={key.onAir ? 'program' : null} width={62} height={40} size={12} testid={`onair-key${k + 1}`}
                                                help={`Fill ${name(key.fill)}`} onClick={() => cmd('keyOnAir', k, !key.onAir, me)} />
                                        ))}
                                    </div>
                                </div>
                            )}
                            {a.dsks.map((d, i) => (
                                <div key={i} className="flex flex-col items-center gap-2" data-testid={`dsk-${i + 1}`}>
                                    <span className="text-[11px] text-subtle">DSK {i + 1}</span>
                                    <PanelButton title="TIE" lit={d.tie ? 'warning' : null} width={62} height={34} size={12} onClick={() => cmd('dskTie', i, !d.tie)} />
                                    <PanelButton title="CUT" lit={d.onAir ? 'program' : null} width={62} height={34} size={12} onClick={() => cmd('dskOnAir', i, !d.onAir)} />
                                    <PanelButton title="AUTO" lit={d.inTransition ? 'program' : null} blink={d.inTransition} width={62} height={34} size={12} onClick={() => cmd('dskAuto', i)} />
                                </div>
                            ))}
                        </div>
                    </Card>
                )}
                {a.macros.length > 0 && (
                    <Card title="Macros" className="flex-1">
                        <div className="flex flex-wrap gap-2">
                            {a.macros.map((mac) => (
                                <PanelButton key={mac.index} title={mac.name} subtitle={String(mac.index + 1)} lit={a.macroRunning === mac.index ? 'warning' : null}
                                    blink={a.macroRunning === mac.index} width={120} height={40} size={12} testid="macro" onClick={() => cmd('macro', mac.index)} />
                            ))}
                        </div>
                        {a.macroRunning !== null && <Btn kind="danger" onClick={() => cmd('macroStop')}>Stop the macro</Btn>}
                    </Card>
                )}
            </div>
            {a.auxCount > 0 && (
                <Card title="Aux outputs" help="The same outputs as the Routing page, by number. Routing shows them by the screen each one feeds.">
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                        {a.aux.map((src, i) => {
                            const screen = state.config.screens.find((s) => s.aux.includes(i + 1));
                            return (
                                <div key={i} className="flex flex-col gap-1">
                                    <div className="flex gap-1.5 text-[11px]"><span className="font-bold text-muted">Aux {i + 1}</span>{screen && <span className="truncate text-subtle">{screen.name}</span>}</div>
                                    <Select testid={`aux-${i + 1}`} value={src ?? ''} onChange={(v) => cmd('aux', i, Number(v))}
                                        options={a.auxSources.map((id) => [name(id), id])} />
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}
        </Page>
    );
}

function Bus({ title, tone, sources, inputs, selected, onPick, testid }) {
    return (
        <div className="flex flex-col gap-1.5" data-testid={testid}>
            <span className={`caps text-[11px] ${tone === 'program' ? 'text-program' : 'text-preview'}`}>{title}</span>
            <div className="flex flex-wrap gap-2">
                {sources.map((id) => (
                    <PanelButton key={id} title={inputs[id]?.short ?? String(id)} help={inputs[id]?.long} lit={id === selected ? tone : null}
                        width={76} height={52} size={14} onClick={() => onPick(id)} />
                ))}
            </div>
        </div>
    );
}

// A T-bar dragged like the real lever. Its rest end flips after each transition.
function TBar({ m, me }) {
    const ref = useRef(null);
    const [drag, setDrag] = useState(null);
    const atTop = m.tbarAtTop;
    const shown = drag ?? (m.inTransition ? (atTop ? 1 - m.position : m.position) : (atTop ? 1 : 0));
    const KNOB = 26;
    const H = 170;
    const travel = H - KNOB;
    const move = (e) => {
        const r = ref.current.getBoundingClientRect();
        const f = Math.max(0, Math.min(1, 1 - (e.clientY - r.top - KNOB / 2) / travel));
        setDrag(f);
        window.booth.atem('position', atTop ? 1 - f : f, me);
    };
    return (
        <div ref={ref} data-testid="tbar" className="relative w-14 touch-none rounded-md border border-line bg-surface" style={{ height: H }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
            onPointerMove={(e) => drag !== null && move(e)}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}>
            <div className="absolute inset-y-2.5 left-1/2 w-1.5 -translate-x-1/2 rounded bg-sunken" />
            <div className={`absolute left-1 right-1 rounded shadow-lg ${m.inTransition ? 'bg-program' : 'bg-muted'}`} style={{ height: KNOB, top: (1 - shown) * travel }} />
        </div>
    );
}
