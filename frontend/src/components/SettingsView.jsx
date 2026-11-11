import { useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { statusOf } from './status.js';
import AtemSettings from './AtemSettings.jsx';
import SupportSettings from './SupportSettings.jsx';

const MODE_LABELS = {
    'udp-sony': 'UDP with Sony header',
    'udp-raw': 'UDP, plain VISCA',
    'tcp-raw': 'TCP, plain VISCA',
    'tcp-sony': 'TCP with Sony header',
};

export default function SettingsView({ state, startAdding, onBack, onError }) {
    const onInfo = (message) => onError(message, 'info');
    const { settings, statuses, profiles, video, atem } = state;
    // null = list, 'new' = adding, otherwise the id of the camera being edited
    const [form, setForm] = useState(startAdding ? 'new' : null);
    const editing = settings.cameras.find((c) => c.id === form) ?? null;

    async function powerAll(on) {
        if (!on && !window.confirm('Put every camera in standby? They turn to their rest positions. Do this after the service.')) return;
        const out = await window.ptz.powerAll(on);
        if (!out?.ok) onError(out?.message || 'Not every camera answered.');
    }

    async function remove(camera) {
        const ok = window.confirm(
            `Remove "${camera.name}"?\n\nIts shots are removed from this app. The positions stay stored in the camera.`,
        );
        if (!ok) return;
        const out = await window.ptz.removeCamera(camera.id);
        if (!out?.ok) onError(Object.values(out?.errors ?? {})[0] ?? 'Could not remove the camera.');
    }

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6">
            <div className="flex items-center gap-3">
                <button type="button" onClick={onBack} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-zinc-300 hover:bg-white/10">
                    <ArrowLeft size={16} /> Back to controls
                </button>
                <h1 className="text-lg font-semibold">Settings</h1>
            </div>

            {form ? (
                <CameraForm
                    key={form}
                    camera={editing}
                    cameras={settings.cameras}
                    profiles={profiles}
                    atemSummary={atem.status.state === 'connected' ? atem.summary : null}
                    onDone={() => setForm(null)}
                />
            ) : (
                <>
                    {settings.cameras.length === 0 && (
                        <p className="rounded-xl border border-edge bg-panel p-6 text-zinc-300">
                            No cameras yet. Add each camera with its IP address. You can find the address on the camera's own
                            setup page, or shown on screen when the camera starts up.
                        </p>
                    )}
                    <ul className="flex flex-col gap-2">
                        {settings.cameras.map((camera, i) => {
                            const status = statusOf(statuses, camera.id);
                            const profile = profiles.find((p) => p.id === camera.profile);
                            return (
                                <li key={camera.id} data-testid="settings-camera" className="flex items-center gap-4 rounded-xl border border-edge bg-panel px-4 py-3">
                                    <span className="w-6 text-center text-sm text-zinc-500">{i + 1}</span>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className={`h-2 w-2 rounded-full ${status.dot}`} />
                                            <span className="font-semibold">{camera.name}</span>
                                            <span className="text-sm text-zinc-400">{camera.host}:{camera.port}</span>
                                        </div>
                                        <div className="mt-0.5 text-xs text-zinc-400">
                                            {profile?.label ?? camera.profile}
                                            {camera.atemInput ? ` · ATEM input ${camera.atemInput}` : ''}
                                            {' · '}
                                            {status.state === 'online'
                                                ? `Connected using ${MODE_LABELS[camera.mode] ?? camera.mode}`
                                                : status.message || status.label}
                                        </div>
                                        <div className="mt-0.5 text-xs text-zinc-500" data-testid="video-status">
                                            Video: {videoText(video?.[camera.id])}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <IconButton label="Move up" disabled={i === 0} onClick={() => window.ptz.moveCamera(camera.id, -1)}><ArrowUp size={16} /></IconButton>
                                        <IconButton label="Move down" disabled={i === settings.cameras.length - 1} onClick={() => window.ptz.moveCamera(camera.id, 1)}><ArrowDown size={16} /></IconButton>
                                        <IconButton label={`Edit ${camera.name}`} onClick={() => setForm(camera.id)}><Pencil size={16} /></IconButton>
                                        <IconButton label={`Remove ${camera.name}`} danger onClick={() => remove(camera)}><Trash2 size={16} /></IconButton>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    <div>
                        <button
                            type="button"
                            onClick={() => setForm('new')}
                            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-sky-200"
                        >
                            <Plus size={16} /> Add a camera
                        </button>
                    </div>
                    {settings.cameras.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-edge bg-panel px-4 py-3" data-testid="power-all">
                            <span className="mr-auto text-sm text-zinc-300">All cameras</span>
                            <button type="button" className="rounded-lg bg-panel-2 px-3 py-1.5 text-sm hover:bg-white/10" onClick={() => powerAll(true)}>
                                Wake all
                            </button>
                            <button type="button" className="rounded-lg bg-panel-2 px-3 py-1.5 text-sm hover:bg-white/10" onClick={() => powerAll(false)}>
                                Standby all
                            </button>
                        </div>
                    )}
                    <AtemSettings atemSettings={settings.atem} atem={atem} cameras={settings.cameras} onError={onError} />
                    <SupportSettings cameras={settings.cameras} version={state.version} onError={onError} onInfo={onInfo} />
                </>
            )}
        </div>
    );
}

function videoText(status) {
    if (!status || status.state === 'connecting') return 'starting';
    if (status.state === 'playing') return 'playing';
    return status.message || 'not available';
}

function IconButton({ label, danger, children, ...rest }) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            className={`rounded-md p-2 text-zinc-400 hover:bg-white/10 disabled:opacity-30 ${danger ? 'hover:text-red-400' : 'hover:text-white'}`}
            {...rest}
        >
            {children}
        </button>
    );
}

function CameraForm({ camera, cameras, profiles, atemSummary, onDone }) {
    const [fields, setFields] = useState(() => ({
        name: camera?.name ?? `Camera ${cameras.length + 1}`,
        profile: camera?.profile ?? profiles[0]?.id,
        host: camera?.host ?? '',
        port: camera ? String(camera.port) : '',
        previewUrl: camera?.previewUrl ?? '',
        atemInput: camera?.atemInput ? String(camera.atemInput) : '',
    }));
    const [errors, setErrors] = useState({});
    const [test, setTest] = useState(null); // { running } | detect result + the host/port it was for
    const [saving, setSaving] = useState(false);
    const profile = profiles.find((p) => p.id === fields.profile);

    const set = (key) => (e) => {
        setFields((f) => ({ ...f, [key]: e.target.value }));
        setErrors((er) => ({ ...er, [key]: undefined, form: undefined }));
    };

    // A test result only counts for the address and port it was run against.
    const portNumber = fields.port.trim() === '' ? profile?.defaultPort : Number(fields.port);
    const testMatches = test?.ok && test.host === fields.host.trim() && test.port === portNumber;

    async function runTest() {
        setTest({ running: true });
        const out = await window.ptz.testCamera({ host: fields.host, port: fields.port, profile: fields.profile }, camera?.id);
        if (out.errors) setErrors((e) => ({ ...e, ...out.errors }));
        setTest({ ...out, host: fields.host.trim() });
    }

    async function save(e) {
        e.preventDefault();
        setSaving(true);
        const input = { ...fields, mode: testMatches ? test.mode : undefined };
        const out = camera ? await window.ptz.updateCamera(camera.id, input) : await window.ptz.addCamera(input);
        setSaving(false);
        if (out.ok) onDone();
        else setErrors(out.errors ?? { form: out.message });
    }

    const input = 'w-full rounded-lg border border-edge bg-black/40 px-3 py-2 text-sm outline-none focus:border-accent';

    return (
        <form onSubmit={save} className="flex flex-col gap-4 rounded-xl border border-edge bg-panel p-5" data-testid="camera-form">
            <h2 className="font-semibold">{camera ? `Edit ${camera.name}` : 'Add a camera'}</h2>

            <Field label="Name" hint="What volunteers will see, for example Left, Centre or Mandir." error={errors.name}>
                <input className={input} value={fields.name} maxLength={40} onChange={set('name')} name="name" />
            </Field>

            <Field label="Camera model" error={errors.profile}>
                <select className={input} value={fields.profile} onChange={set('profile')} name="profile">
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
            </Field>

            <div className="grid grid-cols-[1fr_8rem] gap-3">
                <Field label="IP address" hint="For example 192.168.1.50." error={errors.host}>
                    <input className={input} value={fields.host} onChange={set('host')} name="host" placeholder="192.168.1.50" spellCheck={false} />
                </Field>
                <Field label="Port" hint={`Leave empty for ${profile?.defaultPort}.`} error={errors.port}>
                    <input className={input} value={fields.port} onChange={set('port')} name="port" placeholder={String(profile?.defaultPort ?? '')} inputMode="numeric" />
                </Field>
            </div>

            <Field
                label="Video address (optional)"
                hint={profile?.videoUrlTemplate
                    ? `Leave empty to use ${profile.videoUrlTemplate.replace('{host}', fields.host.trim() || 'the IP address')}. If the camera asks for a login, use rtsp://username:password@... here.`
                    : 'This camera model has no usual video address. Enter its RTSP address to see video.'}
                error={errors.previewUrl}
            >
                <input className={input} value={fields.previewUrl} onChange={set('previewUrl')} name="previewUrl" placeholder={profile?.videoUrlTemplate?.replace('{host}', fields.host.trim() || '192.168.1.50') ?? 'rtsp://...'} spellCheck={false} />
            </Field>

            <Field label="ATEM input" hint="Which switcher input this camera's video goes into. Used to show LIVE and NEXT." error={errors.atemInput}>
                {atemSummary ? (
                    <select className={input} value={fields.atemInput} onChange={set('atemInput')} name="atemInput">
                        <option value="">Not on the ATEM</option>
                        {atemSummary.inputs.map((i) => (
                            <option key={i.id} value={String(i.id)}>{i.id} · {i.name}</option>
                        ))}
                    </select>
                ) : (
                    <input className={input} value={fields.atemInput} onChange={set('atemInput')} name="atemInput" placeholder="For example 3. Leave empty if none." inputMode="numeric" />
                )}
            </Field>

            <div className="flex flex-col gap-2 rounded-lg bg-black/30 p-3">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={runTest}
                        disabled={test?.running || !fields.host.trim()}
                        className="rounded-lg border border-edge px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-40"
                    >
                        {test?.running ? 'Testing...' : 'Test connection'}
                    </button>
                    <span className="text-xs text-zinc-400">Checks that the camera answers, and how it wants to be spoken to.</span>
                </div>
                {test && !test.running && (
                    <p data-testid="test-result" className={`text-sm ${test.ok ? 'text-green-400' : 'text-red-400'}`}>
                        {test.ok ? `Found it. ${test.message}` : test.message}
                    </p>
                )}
                {!testMatches && (
                    <p className="text-xs text-zinc-500">
                        You can save without testing. The app will keep looking for the camera.
                    </p>
                )}
            </div>

            {errors.form && <p className="text-sm text-red-400">{errors.form}</p>}

            <div className="flex justify-end gap-2">
                <button type="button" onClick={onDone} className="rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-white/10">Cancel</button>
                <button type="submit" disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-sky-200 disabled:opacity-50">
                    {camera ? 'Save changes' : 'Add camera'}
                </button>
            </div>
        </form>
    );
}

function Field({ label, hint, error, children }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-zinc-200">{label}</span>
            {children}
            {error ? <span className="text-xs text-red-400">{error}</span> : hint && <span className="text-xs text-zinc-500">{hint}</span>}
        </label>
    );
}
