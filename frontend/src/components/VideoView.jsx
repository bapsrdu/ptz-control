import { useEffect, useRef, useState } from 'react';
import { VideoOff } from 'lucide-react';
import { attach, watchStats } from '../videoHub.js';

// A camera's live video. Shows why there is no picture when there is none.
// The camera can still be moved without video.
export default function VideoView({ cameraId, status, large = false }) {
    const canvas = useRef(null);
    const [hasPicture, setHasPicture] = useState(false);
    const [stats, setStats] = useState(null);

    useEffect(() => {
        setHasPicture(false);
        return attach(cameraId, canvas.current, () => setHasPicture(true));
    }, [cameraId]);

    // Frame rate and size, shown on the large view so a choppy camera can be
    // spotted (and its stream settings checked) at a glance.
    useEffect(() => {
        setStats(null);
        if (!large) return undefined;
        return watchStats(cameraId, setStats);
    }, [cameraId, large]);

    // "Playing" from the camera, and a picture actually drawn here.
    const playing = status?.state === 'playing' && hasPicture;
    const starting = !status || status.state === 'connecting' || (status.state === 'playing' && !hasPicture);
    return (
        <div className="absolute inset-0 bg-black">
            <canvas ref={canvas} data-testid="video-canvas" className={`h-full w-full object-contain ${playing ? '' : 'invisible'}`} />
            {large && playing && stats && (
                <span
                    data-testid="video-stats"
                    title="Frames a second and picture size the camera is sending"
                    className={`absolute bottom-3 right-3 rounded bg-black/70 px-2 py-0.5 font-mono text-xs ${stats.fps < 20 ? 'text-amber-400' : 'text-zinc-300'}`}
                >
                    {Math.round(stats.fps)} fps · {stats.width}×{stats.height}
                </span>
            )}
            {!playing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center" title={status?.message}>
                    <VideoOff size={large ? 32 : 20} className="text-white/25" />
                    {large ? (
                        <span className="max-w-md text-sm text-zinc-400">
                            {starting ? 'Starting video...' : status.message || 'No video'}
                        </span>
                    ) : (
                        <span className="text-[11px] text-zinc-500">{starting ? 'Starting video' : 'No video'}</span>
                    )}
                </div>
            )}
        </div>
    );
}
