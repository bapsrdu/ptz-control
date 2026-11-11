import { useEffect, useRef, useState } from 'react';
import { VideoOff } from 'lucide-react';
import { attach } from '../videoHub.js';

// A camera's live video. Shows why there is no picture when there is none.
// The camera can still be moved without video.
export default function VideoView({ cameraId, status, large = false }) {
    const canvas = useRef(null);
    const [hasPicture, setHasPicture] = useState(false);

    useEffect(() => {
        setHasPicture(false);
        return attach(cameraId, canvas.current, () => setHasPicture(true));
    }, [cameraId]);

    // "Playing" from the camera, and a picture actually drawn here.
    const playing = status?.state === 'playing' && hasPicture;
    const starting = !status || status.state === 'connecting' || (status.state === 'playing' && !hasPicture);
    return (
        <div className="absolute inset-0 bg-black">
            <canvas ref={canvas} data-testid="video-canvas" className={`h-full w-full object-contain ${playing ? '' : 'invisible'}`} />
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
