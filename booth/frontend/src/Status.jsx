// How Booth Video is talking to the switcher and cameras right now, and
// every command it has sent the switcher, for whoever looks after the system.
import { Btn, Card, Page, PageHeader } from './ui.jsx';
import { keyTarget } from './lib.js';

const time = (t) => {
    const d = new Date(t);
    return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

function switcherRows(state) {
    const a = state.atem;
    const s = a?.status;
    const rows = [
        ['Connection', `${!state.config.atemHost ? 'Not set up' : s?.state === 'connected' ? 'Online' : s?.state === 'connecting' ? 'Connecting' : `Offline${s?.message ? `: ${s.message}` : ''}`}, ${state.config.atemHost ? `${state.config.atemHost} UDP 9910` : 'no address'}`],
    ];
    if (!a?.connected) return rows;
    const name = (id) => (id === null || id === undefined ? '?' : a.inputs[id]?.long ?? `input ${id}`);
    rows.push(['Model', `${a.product}${a.version ? `, protocol ${a.version}` : ''}`]);
    rows.push(['Size', `${a.meCount} M/E, ${a.mes.reduce((n, m) => n + m.keys.length, 0)} keys, ${a.dskCount} DSKs, ${a.auxCount} aux, ${Object.keys(a.inputs).length} sources`]);
    rows.push(['The operator runs', `M/E ${state.config.me}`]);
    a.mes.forEach((m, i) => rows.push([`M/E ${i + 1}`, `Live ${name(m.program)}, Next ${name(m.preview)}${m.ftbBlack ? ', faded to black' : ''}`]));
    a.mes.forEach((m, me) => m.keys.forEach((k, i) => rows.push([`M/E ${me + 1} Key ${i + 1}`, `fill ${name(k.fill)}, key ${name(k.cut)}${k.onAir ? ', ON AIR' : ''}`])));
    a.dsks.forEach((d, i) => rows.push([`DSK ${i + 1}`, `fill ${name(d.fill)}, key ${name(d.cut)}${d.onAir ? ', ON AIR' : ''}`]));
    if (a.hasStreaming || a.hasRecording) {
        rows.push(['Stream and record', `${a.hasStreaming ? (a.streaming ? 'streaming' : 'not streaming') : 'no streaming'}, ${a.hasRecording ? (a.recording ? 'recording' : 'not recording') : 'no recording'}`]);
    }
    if (state.config.keys.length) rows.push(['Key buttons', state.config.keys.map((k) => `${k.label} (${keyTarget(k)})`).join(', ')]);
    return rows;
}

function cameraRows(state, c) {
    const st = state.cameras?.[c.id];
    const v = state.video?.[c.id];
    const presets = Object.entries(c.presetNames);
    return [
        ['Address', `${c.host || 'not set'}:${c.port}, VISCA ${c.mode ?? 'not found yet'}`],
        ['Control', st?.state === 'online' ? `Answering${st.power ? `, power ${st.power}` : ''}` : `Not answering${st?.message ? `: ${st.message}` : ''}`],
        ['Switcher input', c.atemInput ? `${state.atem?.inputs?.[c.atemInput]?.long ?? `input ${c.atemInput}`} (input ${c.atemInput})` : 'not set'],
        ['Picture', v?.state === 'playing' ? 'Coming in (RTSP, H.264)' : v?.message || v?.state || 'Not started'],
        ['Tracking', state.tracking?.[c.id] ? `${state.tracking[c.id].status}, ${state.tracking[c.id].size}` : 'Off'],
        ['Saved shots', c.shots.length ? c.shots.map((s) => s.name).join(', ') : 'None'],
        ['Camera presets', presets.length ? presets.map(([n, name]) => `${n} ${name}`).join(', ') : 'None named'],
    ];
}

function configRows(state) {
    return [
        ['File', state.configPath],
        ['Last read', state.loadedAt ? time(state.loadedAt) : 'Not read this session'],
        ['Problem', state.fileError ?? 'None'],
        ['Version', `Booth Video ${state.version}`],
    ];
}

function report(state) {
    const block = (rows) => rows.map(([k, v]) => `${k}: ${v}`).join('\n');
    let out = `Booth Video status, ${new Date().toLocaleString()}\n\nSWITCHER\n${block(switcherRows(state))}\n\nCAMERAS\n`;
    out += state.config.cameras.map((c) => `${c.name}\n${block(cameraRows(state, c))}`).join('\n\n');
    out += `\n\nCOMMANDS SENT (newest first)\n${[...(state.atem?.log ?? [])].reverse().map((e) => `${time(e.time)} ${e.command} ${e.detail}${e.sent ? '' : ' [not sent]'}`).join('\n')}`;
    out += `\n\nCONFIG\n${block(configRows(state))}\n\n${JSON.stringify(state.config, null, 2)}`;
    return out;
}

function Grid({ rows }) {
    return (
        <div className="flex flex-col gap-1.5">
            {rows.map(([k, v]) => (
                <div key={k} className="flex gap-3 text-xs">
                    <span className="w-32 shrink-0 text-subtle">{k}</span>
                    <span className="select-text break-all">{v}</span>
                </div>
            ))}
        </div>
    );
}

export default function Status({ state }) {
    const log = [...(state.atem?.log ?? [])].reverse();
    return (
        <Page>
            <PageHeader title="Status" purpose="How Booth Video is talking to the switcher and cameras right now.">
                <Btn testid="copy-report" onClick={() => window.booth.copy(report(state))} help="Copies everything on this page as text, ready to paste to whoever looks after the system">Copy report</Btn>
            </PageHeader>
            <div className="flex items-start gap-4">
                <Card title="Switcher" className="flex-1"><Grid rows={switcherRows(state)} /></Card>
                <Card title="Setup file" className="flex-1"><Grid rows={configRows(state)} /></Card>
            </div>
            <div className="grid grid-cols-3 gap-4">
                {state.config.cameras.map((c) => <Card key={c.id} title={c.name}><Grid rows={cameraRows(state, c)} /></Card>)}
            </div>
            <Card title="Commands sent to the switcher" help="Newest first. Only commands from this computer show here; the switcher's own panel and other software are not listed." testid="command-log">
                {!log.length && <p className="text-xs text-subtle">Nothing sent yet.</p>}
                {log.map((e, i) => (
                    <div key={`${e.time}${i}`} className="flex gap-3 text-xs">
                        <span className="font-mono text-subtle">{time(e.time)}</span>
                        <span className="w-11 font-mono text-muted">{e.command}</span>
                        <span>{e.detail}</span>
                        {!e.sent && <span className="font-semibold text-warning">not sent, switcher offline</span>}
                    </div>
                ))}
            </Card>
        </Page>
    );
}
