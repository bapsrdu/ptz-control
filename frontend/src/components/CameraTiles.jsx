import { PersonStanding } from 'lucide-react';
import VideoView from './VideoView.jsx';
import { statusOf } from './status.js';

// Step 1: one tile per camera. Clicking a tile picks the camera the controls
// below will move. It does not change what is on air.
export default function CameraTiles({ cameras, statuses, video, tracking, selectedId, onSelect }) {
    return (
        <div className="flex flex-wrap gap-3" data-testid="camera-tiles">
            {cameras.map((camera, index) => {
                const status = statusOf(statuses, camera.id);
                const selected = camera.id === selectedId;
                return (
                    <button
                        key={camera.id}
                        type="button"
                        data-testid="camera-tile"
                        aria-pressed={selected}
                        onClick={() => onSelect(camera.id)}
                        className={`group w-40 overflow-hidden rounded-xl border-2 bg-panel-2 text-left ${selected ? 'border-next' : 'border-transparent hover:border-edge'}`}
                    >
                        <div className="relative flex aspect-video items-center justify-center bg-black/40">
                            <VideoView cameraId={camera.id} status={video?.[camera.id]} />
                            <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 text-xs text-zinc-300">{index + 1}</span>
                            {tracking?.[camera.id] && (
                                <span title="Auto tracking on" className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-accent">
                                    <PersonStanding size={14} />
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 px-2.5 py-2">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} />
                            <span className="truncate text-sm font-semibold">{camera.name}</span>
                            <span className="ml-auto shrink-0 text-[11px] text-zinc-400">{status.label}</span>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
