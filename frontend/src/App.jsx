import { useCallback, useEffect, useMemo, useState } from 'react';
import { Settings, Video } from 'lucide-react';
import CameraTiles from './components/CameraTiles.jsx';
import FramePanel from './components/FramePanel.jsx';
import ShotsPanel from './components/ShotsPanel.jsx';
import SettingsView from './components/SettingsView.jsx';
import { statusOf } from './components/status.js';

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
                {view.name === 'control' && (
                    <button
                        type="button"
                        onClick={() => setView({ name: 'settings' })}
                        className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/10"
                    >
                        <Settings size={16} /> Cameras
                    </button>
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
    const { settings, statuses, tracking, profiles } = state;
    const cameras = settings.cameras;
    const selected = cameras.find((c) => c.id === settings.ui.selectedCameraId) ?? cameras[0];
    const status = statusOf(statuses, selected.id);
    const profile = profiles.find((p) => p.id === selected.profile);
    const onlineIds = useMemo(
        () => new Set(cameras.filter((c) => statuses[c.id]?.state === 'online').map((c) => c.id)),
        [cameras, statuses],
    );

    return (
        <div className="flex flex-col gap-6 p-5">
            <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start gap-6">
                <div className="flex aspect-video w-full items-center justify-center rounded-2xl border-2 border-next bg-black/50" data-testid="selected-view">
                    <div className="flex flex-col items-center gap-2 text-center">
                        <span className="text-2xl font-semibold">{selected.name}</span>
                        <span className="flex items-center gap-2 text-sm text-zinc-400">
                            <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                            {status.state === 'online' ? 'Connected' : status.message || status.label}
                        </span>
                        <span className="text-xs text-zinc-600">Video preview is added in a later version.</span>
                    </div>
                </div>

                <Step number={1} title="Pick a camera">
                    <CameraTiles
                        cameras={cameras}
                        statuses={statuses}
                        tracking={tracking}
                        selectedId={selected.id}
                        onSelect={(id) => window.ptz.setUi({ selectedCameraId: id })}
                    />
                </Step>
            </div>

            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-6">
                <Step number={2} title={`Frame ${selected.name}`}>
                    <div className="rounded-2xl border border-edge bg-panel p-5">
                        <FramePanel
                            camera={selected}
                            profile={profile}
                            online={status.state === 'online'}
                            trackingOn={Boolean(tracking[selected.id])}
                            speed={settings.ui.speed}
                            onError={onError}
                        />
                    </div>
                </Step>

                <div className="mt-8 rounded-2xl border border-edge bg-panel p-5">
                    <ShotsPanel cameras={cameras} selectedId={selected.id} onlineIds={onlineIds} onError={onError} />
                </div>
            </div>
        </div>
    );
}
