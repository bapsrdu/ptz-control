import { useCallback, useEffect, useMemo, useState } from 'react';
import { Settings, Video } from 'lucide-react';
import CameraTiles from './components/CameraTiles.jsx';
import FramePanel from './components/FramePanel.jsx';
import ShotsPanel from './components/ShotsPanel.jsx';
import SettingsView from './components/SettingsView.jsx';
import { statusOf } from './components/status.js';
import VideoView from './components/VideoView.jsx';
import LiveView from './components/LiveView.jsx';
import LowerThirdsButton from './components/LowerThirdsButton.jsx';

export default function App() {
    const [state, setState] = useState(null);
    const [view, setView] = useState({ name: 'control' }); // or { name: 'settings', adding }
    const [toasts, setToasts] = useState([]);

    const showError = useCallback((message) => {
        const id = Math.random().toString(36).slice(2);
        setToasts((t) => [...t.slice(-2), { id, message }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    }, []);

    useEffect(() => {
        let alive = true;
        window.ptz.getState().then((s) => alive && setState(s));
        const offState = window.ptz.onState(setState);
        const offNotice = window.ptz.onNotice(({ message }) => showError(message));
        return () => {
            alive = false;
            offState();
            offNotice();
        };
    }, [showError]);

    if (!state) return null;

    return (
        <div className="flex h-full flex-col">
            <header className="flex items-center gap-3 border-b border-edge px-5 py-3">
                <Video size={20} className="text-accent" />
                <span className="font-semibold">PTZ Control</span>
                <span className="text-sm text-zinc-500">{summary(state)}</span>
                <AtemBadge atem={state.atem} configured={Boolean(state.settings.atem.host)} />
                {view.name === 'control' && (
                    <div className="ml-auto flex items-center gap-2">
                        {state.atem.status.state === 'connected' && state.settings.atem.lowerThirds && (
                            <LowerThirdsButton state={state.atem.lowerThirds} onError={showError} />
                        )}
                        <button
                            type="button"
                            onClick={() => setView({ name: 'settings' })}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/10"
                        >
                            <Settings size={16} /> Settings
                        </button>
                    </div>
                )}
            </header>

            <main className="min-h-0 flex-1 overflow-auto">
                {view.name === 'settings' ? (
                    <SettingsView
                        state={state}
                        startAdding={view.adding}
                        onBack={() => setView({ name: 'control' })}
                        onError={showError}
                    />
                ) : state.settings.cameras.length === 0 ? (
                    <Welcome onAdd={() => setView({ name: 'settings', adding: true })} />
                ) : (
                    <ControlView state={state} onError={showError} />
                )}
            </main>

            <div className="pointer-events-none fixed bottom-4 left-1/2 flex -translate-x-1/2 flex-col gap-2">
                {toasts.map((t) => (
                    <div key={t.id} role="alert" className="pointer-events-auto rounded-lg border border-red-500/40 bg-zinc-900 px-4 py-2 text-sm text-red-200 shadow-xl">
                        {t.message}
                    </div>
                ))}
            </div>
        </div>
    );
}

function summary({ settings, statuses }) {
    const total = settings.cameras.length;
    if (!total) return 'No cameras';
    const online = settings.cameras.filter((c) => statuses[c.id]?.state === 'online').length;
    return `${online} of ${total} camera${total === 1 ? '' : 's'} connected`;
}

function AtemBadge({ atem, configured }) {
    if (!configured) return null;
    const ok = atem.status.state === 'connected';
    return (
        <span title={atem.status.message} className="flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-0.5 text-xs text-zinc-400">
            <span className={`h-2 w-2 rounded-full ${ok ? 'bg-green-400' : 'bg-amber-400'}`} />
            {ok ? atem.status.model || 'ATEM' : 'ATEM not connected'}
        </span>
    );
}

function Welcome({ onAdd }) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <Video size={48} className="text-zinc-600" />
            <h1 className="text-2xl font-semibold">Welcome</h1>
            <p className="max-w-md text-zinc-400">
                Add your PTZ cameras to get started. You will need each camera's IP address.
            </p>
            <button
                type="button"
                onClick={onAdd}
                className="rounded-lg bg-accent px-4 py-2 font-semibold text-zinc-900 hover:bg-sky-200"
            >
                Add a camera
            </button>
        </div>
    );
}

function Step({ number, title, children }) {
    return (
        <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-400">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-[11px] text-zinc-900">{number}</span>
                {title}
            </h2>
            {children}
        </section>
    );
}

function ControlView({ state, onError }) {
    const { settings, statuses, tracking, profiles, video, atem } = state;
    const withAtem = Boolean(settings.atem.host);
    const cameras = settings.cameras;
    const selected = cameras.find((c) => c.id === settings.ui.selectedCameraId) ?? cameras[0];
    const status = statusOf(statuses, selected.id);
    const profile = profiles.find((p) => p.id === selected.profile);
    const onlineIds = useMemo(
        () => new Set(cameras.filter((c) => statuses[c.id]?.state === 'online').map((c) => c.id)),
        [cameras, statuses],
    );

    const selectedView = (
        <div className="relative aspect-video w-full overflow-hidden rounded-2xl border-2 border-accent" data-testid="selected-view">
            <VideoView key={selected.id} cameraId={selected.id} status={video?.[selected.id]} large />
            <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-sm">
                <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                <span className="font-semibold">{selected.name}</span>
                {status.state !== 'online' && <span className="text-zinc-400">{status.message || status.label}</span>}
            </div>
        </div>
    );
    const tiles = (
        <Step number={1} title="Pick a camera">
            <CameraTiles
                cameras={cameras}
                statuses={statuses}
                video={video}
                tracking={tracking}
                selectedId={selected.id}
                live={atem.live}
                next={atem.next}
                onSelect={(id) => window.ptz.setUi({ selectedCameraId: id })}
            />
        </Step>
    );

    return (
        <div className="flex flex-col gap-4 p-5">
            {withAtem ? (
                <>
                    {/* With an ATEM: the selected camera beside what is on air. */}
                    <div className="grid grid-cols-2 gap-5 self-start" style={{ width: 'min(100%, calc(27vh * 32 / 9 + 1.25rem))' }}>
                        {selectedView}
                        <LiveView atem={atem} cameras={cameras} video={video} />
                    </div>
                    {tiles}
                </>
            ) : (
                <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start gap-6">
                    {selectedView}
                    {tiles}
                </div>
            )}

            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-6">
                <Step number={2} title={`Frame ${selected.name}`}>
                    <div className="rounded-2xl border border-edge bg-panel p-5">
                        <FramePanel
                            camera={selected}
                            profile={profile}
                            online={status.state === 'online'}
                            live={atem.live.includes(selected.id)}
                            trackingOn={Boolean(tracking[selected.id])}
                            speed={settings.ui.speed}
                            onError={onError}
                        />
                    </div>
                </Step>

                <div className="mt-8 rounded-2xl border border-edge bg-panel p-5">
                    <ShotsPanel cameras={cameras} selectedId={selected.id} onlineIds={onlineIds} live={atem.live} next={atem.next} onError={onError} />
                </div>
            </div>
        </div>
    );
}
