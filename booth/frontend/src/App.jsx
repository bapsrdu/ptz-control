// One window with pages chosen in the top bar: Operate (where it always
// opens) for the booth volunteer, then Routing, Full switcher, Setup and
// Status for whoever sets the system up. Space, Return, the number keys and
// the arrows only act on Operate, never on the other pages or while a dialog
// is open, so they can never cut or fade by accident.
import { useEffect, useRef, useState } from 'react';
import { Activity, GitBranch, Grid3x3, Settings, SlidersHorizontal } from 'lucide-react';
import Operate from './Operate.jsx';
import Switcher from './Switcher.jsx';
import Routing from './Routing.jsx';
import Setup from './Setup.jsx';
import Status from './Status.jsx';
import { Badge, Btn } from './ui.jsx';
import { useAppTracker } from '../../../frontend/src/useAppTracker.js';
import VideoView from '../../../frontend/src/components/VideoView.jsx';
import { cameraOn, label, meIndex, mixState, modalOpen, pinnedScreens, routeLabel, updateConfig, volunteerSources } from './lib.js';

const PAGES = [
    { id: 'operate', title: 'Operate', icon: SlidersHorizontal, note: 'The booth screen: pick, frame, take' },
    { id: 'routing', title: 'Routing', icon: GitBranch, note: 'Screens and buttons' },
    { id: 'switcher', title: 'Full switcher', icon: Grid3x3, note: 'Keys, T-bar, macros, aux' },
    { id: 'setup', title: 'Setup', icon: Settings, note: 'Sources, keys, cameras' },
    { id: 'status', title: 'Status', icon: Activity, note: 'Connections and log' },
];

export default function App() {
    const [state, setState] = useState(null);
    const [page, setPage] = useState('operate');
    const [notice, setNotice] = useState(null);
    const tracker = useAppTracker(state?.tracking);

    useEffect(() => {
        window.booth.getState().then(setState);
        const offState = window.booth.onState(setState);
        const offNotice = window.booth.onNotice((n) => setNotice(n.message));
        return () => { offState(); offNotice(); };
    }, []);

    useEffect(() => {
        if (!notice) return undefined;
        const t = setTimeout(() => setNotice(null), 6000);
        return () => clearTimeout(t);
    }, [notice]);

    useKeyboard(state, page);

    if (!state) return null;
    const notify = (m) => m && setNotice(m);
    const everConnected = state.atem?.connected || page !== 'operate';
    return (
        <div className="flex h-full flex-col overflow-hidden">
            <TopBar state={state} page={page} setPage={setPage} />
            <div className="relative min-h-0 flex-1">
                {page === 'operate' && (everConnected ? <Operate state={state} tracker={tracker} notify={notify} /> : <ConnectView state={state} />)}
                {page === 'routing' && <Routing state={state} notify={notify} />}
                {page === 'switcher' && <Switcher state={state} />}
                {page === 'setup' && <Setup state={state} notify={notify} />}
                {page === 'status' && <Status state={state} />}
                <div className="pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center gap-2">
                    {state.config.atemHost && state.atem?.status?.state !== 'connected' && everConnected && (
                        <div className="rounded-full bg-warning px-4 py-1.5 text-[13px] font-semibold text-zinc-950" data-testid="link-banner">
                            {state.atem?.status?.message || 'The switcher is not connected.'} Buttons do nothing until it is back.
                        </div>
                    )}
                    {state.fileError && (
                        <div className="rounded-full bg-warning px-4 py-1.5 text-[13px] font-semibold text-zinc-950" data-testid="config-banner">
                            The setup file has a mistake in it, so Booth Video is using the last good setup. Details are in Setup.
                        </div>
                    )}
                </div>
                {notice && (
                    <div className="absolute bottom-4 left-1/2 z-50 max-w-xl -translate-x-1/2 rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm shadow-2xl" data-testid="notice">
                        {notice}
                    </div>
                )}
            </div>
        </div>
    );
}

function TopBar({ state, page, setPage }) {
    const a = state.atem;
    const down = state.config.cameras.filter((c) => c.host && state.cameras?.[c.id] && state.cameras[c.id].state !== 'online');
    const black = mixState(state)?.ftbBlack;
    return (
        <div className="flex h-[68px] shrink-0 items-center gap-4 border-b border-line bg-[#18191c] px-4">
            <div className="flex items-center gap-2 pr-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm font-black text-zinc-950">B</div>
                <span className="text-[15px] font-bold">Booth Video</span>
            </div>
            <nav className="flex h-full items-stretch gap-5">
                {PAGES.map((p) => (
                    <button key={p.id} type="button" data-testid={`tab-${p.id}`} onClick={() => setPage(p.id)}
                        title={p.id === 'operate' ? p.note : `${p.note}. Space, Return and the number keys do nothing here, so they cannot cut or fade.`}
                        className={`caps flex items-center gap-1.5 border-b-2 text-[11px] ${page === p.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'}`}>
                        <p.icon size={12} strokeWidth={2.5} /> {p.title}
                    </button>
                ))}
            </nav>
            <LinkPill state={state} />
            {down.length > 0 && <span className="truncate text-xs font-semibold text-warning">{down.map((c) => c.name).join(', ')} not answering</span>}
            {black && <span className="text-xs font-bold text-warning">Faded to black</span>}
            <div className="flex-1" />
            <TopMonitors state={state} page={page} setPage={setPage} />
            {a?.hasRecording && (
                <StatusButton testid="record" on={a.recording} tone="program" onClick={() => window.booth.atem('record', !a.recording)}>
                    {a.recording ? 'Recording' : 'Record'}
                </StatusButton>
            )}
            {a?.hasStreaming && (
                <StatusButton testid="stream" on={a.streaming || a.streamConnecting} tone={a.streaming ? 'program' : 'warning'}
                    onClick={() => window.booth.atem('stream', !(a.streaming || a.streamConnecting))}>
                    {a.streaming ? 'Streaming' : a.streamConnecting ? 'Connecting' : 'Stream'}
                </StatusButton>
            )}
        </div>
    );
}

function StatusButton({ children, on, tone, onClick, testid }) {
    const wash = tone === 'program' ? 'border-program/60 bg-program/20' : 'border-warning/60 bg-warning/20';
    const dot = tone === 'program' ? 'bg-program' : 'bg-warning';
    return (
        <button type="button" data-testid={testid} data-on={on ? 'true' : 'false'} onClick={onClick}
            className={`caps flex h-7 items-center gap-1.5 rounded border px-2.5 text-[11px] ${on ? wash : 'border-line-strong'}`}>
            <span className={`h-2 w-2 rounded-full ${on ? dot : 'bg-line-strong'}`} />
            {children}
        </button>
    );
}

export function LinkPill({ state }) {
    const s = state.atem?.status?.state;
    if (!state.config.atemHost) return <Badge dot>Not set up</Badge>;
    if (s === 'connected') return <Badge tone="success" dot>Online</Badge>;
    if (s === 'connecting') return <Badge tone="warning" dot>Connecting</Badge>;
    return <Badge tone="danger" dot>Offline</Badge>;
}

// Small pictures in the top bar: Live and Next (on every page but Operate,
// which has them large), then the pinned screens.
function TopMonitors({ state, page, setPage }) {
    const m = mixState(state);
    const screens = pinnedScreens(state);
    const aux = state.atem?.aux ?? [];
    return (
        <div className="flex items-start gap-2">
            {page !== 'operate' && m && (
                <>
                    <Mini state={state} input={m.program} caption={label(state, m.program)} tag="Live" onClick={() => setPage('operate')} />
                    <Mini state={state} input={m.preview} caption={label(state, m.preview)} tag="Next" onClick={() => setPage('operate')} />
                    {screens.length > 0 && <div className="h-[52px] w-px bg-line" />}
                </>
            )}
            {screens.map((sc) => {
                const now = [...new Set(sc.aux.map((n) => aux[n - 1] ?? null))];
                const src = now.length === 1 ? now[0] : null;
                return (
                    <Mini key={sc.name} state={state} input={src} caption={sc.name} mixed={now.length > 1} onClick={() => setPage('routing')}
                        help={`${sc.name} is showing ${now.length > 1 ? 'different pictures on its outputs' : routeLabel(state, src)}. Click to open Routing.`} />
                );
            })}
        </div>
    );
}

function Mini({ state, input, caption, tag, mixed, onClick, help }) {
    const cam = cameraOn(state, input);
    return (
        <button type="button" onClick={onClick} title={help} className="flex w-[71px] flex-col items-center gap-0.5">
            <div className={`relative h-10 w-[71px] overflow-hidden bg-black ${tag === 'Live' ? 'outline-2 outline-program' : tag === 'Next' ? 'outline outline-preview' : 'outline outline-line'}`}>
                {cam ? <VideoView cameraId={cam.id} status={state.video?.[cam.id]} /> : (
                    <span className={`absolute inset-0 flex items-center justify-center p-0.5 text-center text-[9px] font-semibold leading-tight text-muted ${tag ? 'pt-3' : ''}`}>
                        {mixed ? 'Mixed' : routeLabel(state, input)}
                    </span>
                )}
                {tag && <span className={`caps absolute left-0.5 top-0.5 rounded-sm px-1 text-[8px] ${tag === 'Live' ? 'bg-program text-white' : 'bg-preview text-zinc-950'}`}>{tag}</span>}
            </div>
            <span className="w-full truncate text-[10px] font-medium text-muted">{caption}</span>
        </button>
    );
}

function ConnectView({ state }) {
    const [host, setHost] = useState(state.config.atemHost);
    const go = () => updateConfig(state, (c) => ({ ...c, atemHost: host.trim() }));
    const s = state.atem?.status;
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center" data-testid="connect-view">
            <h1 className="text-2xl font-bold">Connect to your ATEM</h1>
            <p className="text-sm text-muted">Booth Video talks to the switcher directly over your network. No Blackmagic software needed.<br />Find the switcher&apos;s IP address in ATEM Setup under Network.</p>
            <div className="flex gap-2">
                <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="Such as 192.168.1.240" data-testid="connect-host"
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') go(); }}
                    className="h-10 w-64 rounded-lg border border-line bg-sunken px-3 text-base text-ink outline-none focus:border-accent" />
                <Btn kind="primary" className="!h-10 px-5 text-sm" onClick={go} testid="connect-go">Connect</Btn>
            </div>
            {state.fileError && <p className="max-w-xl text-sm text-warning">The setup file could not be read: {state.fileError}</p>}
            {state.config.atemHost && s?.state === 'connecting' && <p className="text-sm text-warning">{s.message || `Connecting to ${state.config.atemHost}…`}</p>}
            {state.config.atemHost && s?.state === 'error' && <p className="text-sm text-danger">{s.message}</p>}
        </div>
    );
}

// Keyboard: 1 to 9 and 0 put that tile of the source row on Next, Shift
// puts it on Live, Space cuts, Return fades, arrows move the camera on Next.
function useKeyboard(state, page) {
    const ref = useRef({ state, page });
    ref.current = { state, page };
    useEffect(() => {
        const held = new Set();
        let movingId = null;
        const ARROWS = { ArrowLeft: [-0.6, 0], ArrowRight: [0.6, 0], ArrowUp: [0, 0.6], ArrowDown: [0, -0.6] };
        let keepAlive = null;
        const release = () => {
            held.clear();
            clearInterval(keepAlive);
            keepAlive = null;
            if (movingId) window.ptz.stopMove(movingId);
            movingId = null;
        };
        const drive = () => {
            const { state: s } = ref.current;
            if (!held.size) return release();
            const cam = cameraOn(s, mixState(s)?.preview);
            if (!cam) return release();
            const x = [...held].reduce((a, k) => a + ARROWS[k][0], 0);
            const y = [...held].reduce((a, k) => a + ARROWS[k][1], 0);
            if (movingId && movingId !== cam.id) window.ptz.stopMove(movingId);
            movingId = cam.id;
            window.ptz.move(cam.id, { x, y });
            if (!keepAlive) keepAlive = setInterval(() => movingId && window.ptz.move(movingId, { x, y }), 400);
        };
        const ignore = (e) => {
            const { state: s, page: p } = ref.current;
            if (!s || p !== 'operate' || modalOpen()) return true;
            const t = e.target;
            return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        };
        const down = (e) => {
            if (ignore(e)) { release(); return; }
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const { state: s } = ref.current;
            const me = meIndex(s);
            if (ARROWS[e.key]) {
                e.preventDefault();
                if (!held.has(e.key)) { held.add(e.key); drive(); }
                return;
            }
            if (e.repeat) return;
            if (e.code === 'Space') { e.preventDefault(); window.booth.atem('cut', me); return; }
            if (e.key === 'Enter') { e.preventDefault(); window.booth.atem('auto', me); return; }
            const digit = /^Digit(\d)$/.exec(e.code);
            if (digit) {
                const i = (Number(digit[1]) + 9) % 10;
                const src = volunteerSources(s);
                if (i < src.length) window.booth.atem(e.shiftKey ? 'program' : 'preview', src[i].input, me);
                e.preventDefault();
            }
        };
        const up = (e) => {
            if (ARROWS[e.key] && held.has(e.key)) {
                held.delete(e.key);
                drive();
            }
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', release);
        return () => {
            release();
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('blur', release);
        };
    }, []);
    // Leaving Operate lets go of the cameras.
    useEffect(() => {
        if (page !== 'operate') window.ptz.stopAll();
    }, [page]);
}
