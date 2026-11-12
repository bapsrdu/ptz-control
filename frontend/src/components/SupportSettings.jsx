import { useState } from 'react';
import { Download, FileVideo, Upload } from 'lucide-react';

// Backup of the whole setup, and the camera web page recorder.
export default function SupportSettings({ cameras, version, onError, onInfo }) {
    const [recordId, setRecordId] = useState(cameras[0]?.id ?? '');
    const [recording, setRecording] = useState(false);
    const cameraId = cameras.some((c) => c.id === recordId) ? recordId : cameras[0]?.id;

    async function exportSettings() {
        const out = await window.ptz.exportSettings();
        if (out?.ok) onInfo(`Settings saved to ${out.path}`);
        else if (!out?.canceled) onError(out?.message || 'Could not save the settings.');
    }

    async function importSettings() {
        if (!window.confirm('Load settings from a file?\n\nThis replaces all cameras, shots and ATEM settings on this computer.')) return;
        const out = await window.ptz.importSettings();
        if (out?.ok) onInfo(`Settings loaded: ${out.cameras} camera${out.cameras === 1 ? '' : 's'}.`);
        else if (!out?.canceled) onError(out?.message || 'Could not load the settings.');
    }

    async function record() {
        setRecording(true);
        const out = await window.ptz.recordWebPage(cameraId);
        setRecording(false);
        if (out?.ok) onInfo(`Recording saved to ${out.path} (${out.http} requests, ${out.frames} WebSocket messages${out.videoFrames ? `, ${out.videoFrames} video frames counted but not kept` : ''}).`);
        else if (!out?.canceled) onError(out?.message || 'The recording was not saved.');
    }

    const button = 'flex items-center gap-1.5 rounded-lg bg-panel-2 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-40';

    return (
        <section className="flex flex-col gap-5 rounded-xl border border-edge bg-panel p-5" data-testid="support-settings">
            <div className="flex flex-col gap-2">
                <h2 className="font-semibold">Backup</h2>
                <p className="text-sm text-zinc-400">
                    Save every camera, shot (with its picture) and ATEM setting to one file, to keep a backup or set up another
                    computer the same way.
                </p>
                <div className="flex gap-2">
                    <button type="button" className={button} onClick={exportSettings}><Download size={16} /> Save settings to a file</button>
                    <button type="button" className={button} onClick={importSettings}><Upload size={16} /> Load settings from a file</button>
                </div>
            </div>

            {cameras.length > 0 && (
                <div className="flex flex-col gap-2">
                    <h2 className="font-semibold">Record a camera&apos;s web page</h2>
                    <p className="text-sm text-zinc-400">
                        Opens the camera&apos;s own web page and records everything it sends and receives, so more of its settings
                        can be added to this app. Log in, use each setting once (for example Track Configuration), then close the
                        window and save the file. The file includes the camera login if you type it, so only send it to people you
                        trust.
                    </p>
                    <div className="flex items-center gap-2">
                        <select
                            name="recordCamera"
                            value={cameraId}
                            onChange={(e) => setRecordId(e.target.value)}
                            className="rounded-lg border border-edge bg-black/40 px-3 py-1.5 text-sm"
                        >
                            {cameras.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.host})</option>)}
                        </select>
                        <button type="button" className={button} disabled={recording} onClick={record}>
                            <FileVideo size={16} /> {recording ? 'Recording... close the camera window to finish' : 'Open and record'}
                        </button>
                    </div>
                </div>
            )}

            <p className="text-xs text-zinc-500" data-testid="app-version">Universal PTZ Controller version {version}</p>
        </section>
    );
}
