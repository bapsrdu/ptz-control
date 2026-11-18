// Setup: where the switcher is, the operator's source row, key buttons, the
// cameras and their shots, tracking, and the setup file.
import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Globe, Search, Trash2 } from 'lucide-react';
import { Btn, Card, Col, Field, Page, PageHeader, Segments, Select } from './ui.jsx';
import { LinkPill } from './App.jsx';
import { keyTarget, label, updateConfig } from './lib.js';

const TABS = [
    { id: 'switcher', title: 'Switcher', purpose: 'Where the ATEM is, and which mix the operator runs.' },
    { id: 'sources', title: 'Sources', purpose: 'The tiles the operator can put on Next, left to right.',
        help: 'Keys 1 to 9 and 0 pick the tiles in this order. Leave the name blank to use the camera\'s name or the switcher\'s. Until any are added, the row shows every camera.' },
    { id: 'keys', title: 'Key buttons', purpose: 'On and off buttons under Fade and Cut, such as lower thirds.',
        help: 'Upstream keys cut on and off; DSKs fade at their own rate.' },
    { id: 'cameras', title: 'Cameras', purpose: 'The PTZ cameras, the switcher input each one feeds, and their saved shots.',
        help: 'Cameras are controlled over VISCA (BZB cameras use UDP port 1259) and show their video from RTSP (the sub stream, rtsp://<address>:554/live/av1 on BZB). Set the switcher input each camera is plugged into, so putting it on Next lets the operator move it.' },
    { id: 'tracking', title: 'Tracking', purpose: 'How auto tracking follows a person.',
        help: 'Track (under the joystick) makes the camera on Next follow a person, found in its preview picture. It frames them as a shoulders-up, waist-up or full-length follow shot: eyes near the upper third, headroom to suit the shot, lead room on the side they face or walk toward, and gentle eased moves. Zooming by hand keeps tracking and holds the new size. Moving the joystick, a shot or a preset hands the camera back.' },
    { id: 'file', title: 'Setup file', purpose: 'Everything in Setup is saved in one file that people can edit.',
        help: 'The file is plain JSON. Booth Video picks up changes to it within a second. A copy of the last setup that loaded cleanly is kept beside it.' },
];

export default function Setup({ state, notify }) {
    const [tab, setTab] = useState(() => {
        try { return localStorage.getItem('setupTab') || 'switcher'; } catch { return 'switcher'; }
    });
    const t = TABS.find((x) => x.id === tab) ?? TABS[0];
    const choose = (v) => { setTab(v); try { localStorage.setItem('setupTab', v); } catch {} };
    return (
        <Page>
            <PageHeader title="Setup" purpose={t.purpose} help={t.help} />
            <Segments testid="setup-tabs" items={TABS.map((x) => [x.title, x.id])} value={t.id} onChange={choose} />
            {t.id === 'switcher' && <SwitcherSetup state={state} />}
            {t.id === 'sources' && <Sources state={state} />}
            {t.id === 'keys' && <Keys state={state} />}
            {t.id === 'cameras' && <Cameras state={state} notify={notify} />}
            {t.id === 'tracking' && <Tracking state={state} />}
            {t.id === 'file' && <SetupFile state={state} />}
        </Page>
    );
}

function Row({ label: text, children }) {
    return (
        <div className="flex items-center gap-3">
            <span className="w-36 shrink-0 text-xs font-semibold text-muted">{text}</span>
            {children}
        </div>
    );
}

function SwitcherSetup({ state }) {
    const a = state.atem;
    const [host, setHost] = useState(state.config.atemHost);
    const connect = () => updateConfig(state, (c) => ({ ...c, atemHost: host.trim() }));
    return (
        <Card title="ATEM switcher" className="max-w-[760px]">
            <Row label="Address">
                <Field value={state.config.atemHost} placeholder="IP address" width={200} testid="atem-host" onChange={setHost} onCommit={(v) => updateConfig(state, (c) => ({ ...c, atemHost: v.trim() }))} />
                <Btn kind="primary" onClick={connect} testid="atem-connect">Connect</Btn>
                <LinkPill state={state} />
            </Row>
            <Row label="Model">
                <span className={`text-[13px] ${a?.connected ? '' : 'text-subtle'}`}>{a?.connected ? `${a.product}${a.version ? `, protocol ${a.version}` : ''}` : 'Unknown until connected'}</span>
            </Row>
            {a?.connected && a.meCount > 1 && (
                <Row label="The operator runs">
                    <Segments testid="operator-me" items={a.mes.map((_, i) => [`M/E ${i + 1}`, i + 1])} value={state.config.me} onChange={(v) => updateConfig(state, (c) => ({ ...c, me: v }))} />
                    <span className="text-xs text-muted">Live on it now: {label(state, a.mes[state.config.me - 1]?.program)}</span>
                </Row>
            )}
        </Card>
    );
}

function Sources({ state }) {
    const a = state.atem;
    const chosen = state.config.sources;
    const available = (a?.busSources ?? []).filter((id) => !chosen.some((s) => s.input === id));
    const move = (i, d) => updateConfig(state, (c) => { const j = i + d; if (c.sources[j]) [c.sources[i], c.sources[j]] = [c.sources[j], c.sources[i]]; return c; });
    return (
        <Card>
            <div className="flex gap-3"><Col width={30}>Key</Col><Col width={200}>Switcher input</Col><Col width={200}>Name on screen</Col><Col>Picture</Col></div>
            {!chosen.length && <p className="text-sm text-muted">Nothing added yet, so the row shows every camera.</p>}
            {chosen.map((s, i) => (
                <div key={s.input} className="flex items-center gap-3" data-testid="source-setup-row">
                    <span className="w-[30px] text-[13px] font-bold text-subtle">{i < 10 ? (i + 1) % 10 : ''}</span>
                    <span className="w-[200px] truncate text-[13px]">{a?.inputs?.[s.input]?.long ?? `Input ${s.input}`}</span>
                    <Field value={s.label ?? ''} placeholder={label({ ...state, config: { ...state.config, sources: [] } }, s.input)} width={200}
                        onChange={(v) => updateConfig(state, (c) => { c.sources[i].label = v.trim() || undefined; return c; })} />
                    <span className="text-xs text-subtle">{state.config.cameras.some((c) => c.atemInput === s.input) ? "The camera's own picture" : 'Name only'}</span>
                    <div className="flex-1" />
                    <button type="button" title="Earlier in the row" disabled={i === 0} className="text-muted disabled:opacity-30" onClick={() => move(i, -1)}><ChevronUp size={14} /></button>
                    <button type="button" title="Later in the row" disabled={i === chosen.length - 1} className="text-muted disabled:opacity-30" onClick={() => move(i, 1)}><ChevronDown size={14} /></button>
                    <button type="button" title="Take this tile out of the row" className="text-muted hover:text-danger" onClick={() => updateConfig(state, (c) => { c.sources.splice(i, 1); return c; })}><Trash2 size={14} /></button>
                </div>
            ))}
            <div>
                <Select testid="add-source" value="" placeholder={a?.connected ? 'Add a source…' : 'Connect the switcher to add sources'} width={240}
                    options={available.map((id) => [`${a.inputs[id].long} (${a.inputs[id].short})`, id])}
                    onChange={(v) => v !== '' && updateConfig(state, (c) => { c.sources.push({ input: Number(v) }); return c; })} />
            </div>
        </Card>
    );
}

function Keys({ state }) {
    const a = state.atem;
    const name = (id) => (id === null || id === undefined ? '?' : a?.inputs?.[id]?.long ?? `input ${id}`);
    const options = [];
    if (a?.connected) {
        a.mes.forEach((m, me) => m.keys.forEach((k, i) => options.push([`M/E ${me + 1} Key ${i + 1}: ${name(k.fill)}`, `usk:${me + 1}:${i + 1}`])));
        a.dsks.forEach((d, i) => options.push([`DSK ${i + 1}: ${name(d.fill)}`, `dsk:${i + 1}`]));
    }
    const sources = (k) => {
        if (!a?.connected) return '';
        const x = k.dsk ? a.dsks[k.dsk - 1] : a.mes[(k.me ?? 1) - 1]?.keys?.[k.keyer - 1];
        return x ? `${name(x.fill)} / ${name(x.cut)}` : 'Not on this switcher';
    };
    return (
        <Card>
            <div className="flex gap-3"><Col width={180}>Button label</Col><Col width={120}>Key</Col><Col width={260}>Fill and key sources</Col></div>
            {!state.config.keys.length && <p className="text-sm text-muted">No key buttons yet.</p>}
            {state.config.keys.map((k, i) => (
                <div key={`${i}${keyTarget(k)}`} className="flex items-center gap-3" data-testid="key-setup-row">
                    <Field value={k.label} width={180} onChange={(v) => v.trim() && updateConfig(state, (c) => { c.keys[i].label = v.trim(); return c; })} />
                    <span className="w-[120px] text-[13px]">{keyTarget(k)}</span>
                    <span className="w-[260px] truncate text-xs text-muted">{sources(k)}</span>
                    <div className="flex-1" />
                    <button type="button" title="Remove this button" className="text-muted hover:text-danger" onClick={() => updateConfig(state, (c) => { c.keys.splice(i, 1); return c; })}><Trash2 size={14} /></button>
                </div>
            ))}
            <div>
                <Select testid="add-key" value="" placeholder={a?.connected ? 'Add a key button…' : 'Connect the switcher to add keys'} width={280} options={options}
                    onChange={(v) => {
                        if (!v) return;
                        const [kind, x, y] = v.split(':').map((p, j) => (j ? Number(p) : p));
                        updateConfig(state, (c) => { c.keys.push(kind === 'dsk' ? { label: `DSK ${x}`, dsk: x } : { label: `Key ${y}`, me: x, keyer: y }); return c; });
                    }} />
            </div>
        </Card>
    );
}

function Cameras({ state, notify }) {
    const a = state.atem;
    const [finding, setFinding] = useState(false);
    const [found, setFound] = useState(null);
    const inputs = a?.connected ? a.busSources.filter((id) => a.inputs[id]?.external) : [];
    const set = (i, patch) => updateConfig(state, (c) => { Object.assign(c.cameras[i], patch); return c; });
    const add = (host = '', name = '', port = 1259, mode = null) => updateConfig(state, (c) => {
        c.cameras.push({ name: name || `Cam ${c.cameras.length + 1}`, host, port, mode, profile: 'bzb-adamo', shots: [], presetNames: {} });
        return c;
    });
    const find = async () => {
        setFinding(true);
        const out = await window.booth.findDevices();
        setFinding(false);
        if (!out?.ok) return notify(out?.message || 'Could not search the network.');
        setFound(out);
    };
    return (
        <div className="flex flex-col gap-4">
            <Card>
                <div className="flex gap-2"><Col width={10} /><Col width={120}>Name</Col><Col width={140}>Address</Col><Col width={64}>Port</Col><Col width={180}>Switcher input</Col><Col width={260}>Video address</Col></div>
                {!state.config.cameras.length && <p className="text-sm text-muted">No cameras yet.</p>}
                {state.config.cameras.map((cam, i) => {
                    const st = state.cameras?.[cam.id];
                    return (
                        <div key={cam.id} className="flex flex-col gap-2 border-b border-line pb-3 last:border-0" data-testid="camera-setup-row">
                            <div className="flex items-center gap-2">
                                <span title={st?.state === 'online' ? 'Answering' : st?.message || 'Not answering'} className={`h-2 w-2 shrink-0 rounded-full ${st?.state === 'online' ? 'bg-success' : 'bg-line-strong'}`} />
                                <Field value={cam.name} width={120} testid="camera-name" onChange={(v) => v.trim() && set(i, { name: v.trim() })} />
                                <Field value={cam.host} placeholder="IP address" width={140} testid="camera-host" onChange={(v) => set(i, { host: v.trim(), mode: null })} />
                                <Field value={String(cam.port)} width={64} onChange={(v) => set(i, { port: Number(v) || 1259, mode: null })} />
                                <Select value={cam.atemInput ?? ''} placeholder="No input" width={180} testid="camera-input"
                                    options={(inputs.includes(cam.atemInput) || !cam.atemInput ? inputs : [cam.atemInput, ...inputs]).map((id) => [a?.inputs?.[id]?.long ?? `Input ${id}`, id])}
                                    onChange={(v) => set(i, { atemInput: v === '' ? null : Number(v) })} />
                                <Field value={cam.previewUrl} placeholder={`rtsp://${cam.host || 'address'}:554/live/av1`} width={260}
                                    onChange={(v) => set(i, { previewUrl: v.trim() })} />
                                <div className="flex-1" />
                                <button type="button" title="Open the camera's own web page" disabled={!cam.host} className="text-muted hover:text-ink disabled:opacity-30" onClick={() => window.booth.openWebPage(cam.id)}><Globe size={14} /></button>
                                <button type="button" title={`Remove ${cam.name}`} className="text-muted hover:text-danger" onClick={() => updateConfig(state, (c) => { c.cameras.splice(i, 1); return c; })}><Trash2 size={14} /></button>
                            </div>
                            {cam.host && st?.state !== 'online' && st?.message && <p className="pl-4 text-xs text-warning">{st.message}</p>}
                            <ShotEditor state={state} cam={cam} index={i} notify={notify} />
                        </div>
                    );
                })}
                <div className="flex gap-2">
                    <Btn testid="add-camera" onClick={() => add()}>Add a camera</Btn>
                    <Btn onClick={find} disabled={finding}><span className="flex items-center gap-1"><Search size={12} />{finding ? 'Looking…' : 'Find cameras on the network'}</span></Btn>
                </div>
                {found && (
                    <div className="flex flex-col gap-1.5 border-t border-line pt-3" data-testid="found">
                        {!found.found?.length && <p className="text-sm text-muted">Nothing found on {found.networks?.join(', ') || 'this network'}. Check this computer is on the same network as the cameras.</p>}
                        {(found.found ?? []).map((f) => (
                            <div key={`${f.kind}${f.host}:${f.port}`} className="flex items-center gap-3 text-[13px]" data-testid="found-device">
                                <span className="w-48 truncate">{f.kind === 'atem' ? 'ATEM switcher' : f.name || 'Camera'}</span><span className="w-40 text-muted">{f.host}</span>
                                {f.kind === 'atem' ? (
                                    <Btn onClick={() => updateConfig(state, (c) => ({ ...c, atemHost: f.host }))}>Use this switcher</Btn>
                                ) : state.config.cameras.some((c) => c.host === f.host) ? <span className="text-xs text-subtle">Already added</span>
                                    : <Btn onClick={() => add(f.host, '', f.port, f.mode)}>Add</Btn>}
                            </div>
                        ))}
                    </div>
                )}
            </Card>
            <CameraLogin state={state} notify={notify} />
        </div>
    );
}

// A camera's shots, editable by name and number, plus names for presets
// stored on the camera itself.
function ShotEditor({ state, cam, index, notify }) {
    const [open, setOpen] = useState(false);
    const [presetNo, setPresetNo] = useState('');
    const [presetName, setPresetName] = useState('');
    const result = (out) => { if (out && !out.ok) notify(out.message); };
    const shots = cam.shots;
    const edit = (j, patch) => updateConfig(state, (c) => { Object.assign(c.cameras[index].shots[j], patch); return c; });
    const presets = Object.keys(cam.presetNames).map(Number).sort((x, y) => x - y);
    return (
        <div className="pl-4">
            <button type="button" className="flex items-center gap-1 text-xs font-semibold text-muted" onClick={() => setOpen((o) => !o)} data-testid="shots-toggle">
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {shots.length} saved shot{shots.length === 1 ? '' : 's'}, {presets.length} named on the camera
            </button>
            {open && (
                <div className="mt-2 flex flex-col gap-1.5 text-xs">
                    {!shots.length && <p className="text-subtle">No shots saved yet. Save one from Operate, or add one here from the camera as it is now.</p>}
                    {shots.map((s, j) => (
                        <div key={s.id} className="flex items-center gap-2">
                            <span className={`w-16 font-semibold ${s.kind === 'exposure' ? 'text-warning' : 'text-accent'}`}>{s.kind === 'exposure' ? 'Exposure' : 'Position'}</span>
                            <Field value={s.name} width={140} onChange={(v) => v.trim() && edit(j, { name: v.trim() })} />
                            {s.kind === 'position' ? ['pan', 'tilt', 'zoom'].map((k) => (
                                <label key={k} className="flex items-center gap-1 text-subtle">{k[0].toUpperCase() + k.slice(1)}
                                    <Field value={String(s[k])} width={64} onChange={(v) => edit(j, { [k]: Number(v) || 0 })} />
                                </label>
                            )) : <span className="w-[280px] truncate text-subtle">{Object.entries(s.exposure ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}</span>}
                            <Btn onClick={async () => result(await window.booth.goShot(cam.id, s.id))} help={`Sends this to ${cam.name} now. Check it is not live first.`}>Recall</Btn>
                            <Btn onClick={async () => result(await window.booth.saveShot(cam.id, { kind: s.kind, replacing: s.id }))}>Update to now</Btn>
                            <button type="button" title="Earlier" disabled={j === 0} className="text-muted disabled:opacity-30" onClick={() => updateConfig(state, (c) => { const l = c.cameras[index].shots; [l[j - 1], l[j]] = [l[j], l[j - 1]]; return c; })}><ChevronUp size={13} /></button>
                            <button type="button" title="Later" disabled={j === shots.length - 1} className="text-muted disabled:opacity-30" onClick={() => updateConfig(state, (c) => { const l = c.cameras[index].shots; [l[j + 1], l[j]] = [l[j], l[j + 1]]; return c; })}><ChevronDown size={13} /></button>
                            <button type="button" title="Delete" className="text-muted hover:text-danger" onClick={() => updateConfig(state, (c) => { c.cameras[index].shots.splice(j, 1); return c; })}><Trash2 size={13} /></button>
                        </div>
                    ))}
                    <div className="flex gap-2">
                        <Btn onClick={async () => result(await window.booth.saveShot(cam.id, { kind: 'position' }))}>Add position from the camera now</Btn>
                        <Btn onClick={async () => result(await window.booth.saveShot(cam.id, { kind: 'exposure' }))}>Add exposure from the camera now</Btn>
                    </div>
                    <div className="mt-2 text-[11px] font-semibold text-subtle">Presets stored on the camera (a VISCA camera cannot list them, so name the ones to show)</div>
                    {presets.map((n) => (
                        <div key={n} className="flex items-center gap-2">
                            <span className="w-8 text-right text-subtle">{n}</span>
                            <Field value={cam.presetNames[n]} width={160} onChange={(v) => updateConfig(state, (c) => { if (v.trim()) c.cameras[index].presetNames[n] = v.trim(); else delete c.cameras[index].presetNames[n]; return c; })} />
                            <Btn onClick={async () => result(await window.booth.recallPreset(cam.id, n))}>Recall</Btn>
                            <button type="button" title="Stop showing this preset" className="text-muted hover:text-danger" onClick={() => updateConfig(state, (c) => { delete c.cameras[index].presetNames[n]; return c; })}><Trash2 size={13} /></button>
                        </div>
                    ))}
                    <div className="flex items-center gap-2">
                        <input value={presetNo} onChange={(e) => setPresetNo(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="No." className="h-7 w-14 rounded-md border border-line bg-sunken px-2 text-ink" />
                        <input value={presetName} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Name" className="h-7 w-40 rounded-md border border-line bg-sunken px-2 text-ink" />
                        <Btn disabled={!(Number(presetNo) >= 0 && Number(presetNo) <= 254 && presetNo !== '' && presetName.trim())} onClick={() => {
                            updateConfig(state, (c) => { c.cameras[index].presetNames[Number(presetNo)] = presetName.trim(); return c; });
                            setPresetNo(''); setPresetName('');
                        }}>Name a camera preset</Btn>
                    </div>
                </div>
            )}
        </div>
    );
}

function CameraLogin({ state, notify }) {
    const [user, setUser] = useState(state.config.cameraLoginUser || 'admin');
    const [password, setPassword] = useState('');
    const save = async () => {
        const out = await window.booth.saveLogin(user, password);
        if (!out?.ok) return notify(out?.message);
        setPassword('');
        notify('Saved. The cameras reconnect with the new login.');
    };
    return (
        <Card title="Camera web login" className="max-w-[760px]"
            help="BZB cameras have their own web page, which Booth Video uses for tracking settings. It logs in with admin / admin unless you save another login here. The password is kept encrypted on this computer, not in the setup file.">
            <div className="flex items-center gap-2">
                <input value={user} onChange={(e) => setUser(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="User name" className="h-7 w-40 rounded-md border border-line bg-sunken px-2 text-[13px] text-ink" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
                    placeholder={state.loginSaved ? 'Saved (type to replace)' : 'Password'} className="h-7 w-52 rounded-md border border-line bg-sunken px-2 text-[13px] text-ink" />
                <Btn kind="primary" onClick={save}>Save</Btn>
                {state.loginSaved && <Btn kind="danger" onClick={() => window.booth.clearLogin()}>Remove</Btn>}
            </div>
        </Card>
    );
}

function Tracking({ state }) {
    const c = state.config;
    const set = (patch) => updateConfig(state, (x) => ({ ...x, ...patch }));
    return (
        <Card title="Auto tracking" className="max-w-[760px]">
            <Row label="Follow speed">
                <input type="range" min={0.5} max={4} step={0.1} defaultValue={c.trackSpeed} key={c.trackSpeed} className="w-60 accent-accent"
                    onPointerUp={(e) => set({ trackSpeed: Math.round(Number(e.currentTarget.value) * 10) / 10 })} />
                <span className="w-10 font-mono text-xs text-muted">{c.trackSpeed.toFixed(1)}×</span>
                <span className="text-xs text-subtle">Lower if the camera overshoots, higher if it falls behind.</span>
            </Row>
            <Row label="Tilt">
                <input type="checkbox" checked={c.trackTilt} onChange={(e) => set({ trackTilt: e.target.checked })} />
                <span className="text-xs text-subtle">Tilt to follow as well as pan. Off: pan only.</span>
            </Row>
            <Row label="Zoom">
                <input type="checkbox" checked={c.trackZoom} onChange={(e) => set({ trackZoom: e.target.checked })} />
                <span className="text-xs text-subtle">Zoom to hold the shot size as people move nearer or farther.</span>
            </Row>
        </Card>
    );
}

function SetupFile({ state }) {
    return (
        <Card title="Setup file" className="max-w-[760px]">
            <code className="select-text font-mono text-xs" data-testid="config-path">{state.configPath}</code>
            <div className="flex gap-2">
                <Btn onClick={() => window.booth.showConfig()}>{state.platform === 'darwin' ? 'Show in Finder' : 'Show in folder'}</Btn>
                <Btn onClick={() => window.booth.copy(state.configPath)}>Copy path</Btn>
            </div>
            {state.fileError && <p className="text-xs font-semibold text-danger">The file has a problem, so Booth Video is still using the last good setup: {state.fileError}</p>}
        </Card>
    );
}
