import VideoView from './VideoView.jsx';

// What is on air, as the ATEM says. Shows the live camera's video, split when
// more than one camera is live (for example different cameras on the left and
// right screens). Anything else on air is named.
export default function LiveView({ atem, cameras, video }) {
    const liveCameras = cameras.filter((c) => atem.live.includes(c.id)).slice(0, 4);
    const cameraInputs = new Set(cameras.map((c) => c.atemInput).filter(Boolean));
    const others = atem.liveInputs.filter((id) => !cameraInputs.has(id)).map((id) => atem.summary?.names?.[id] || `Input ${id}`);
    const connected = atem.status.state === 'connected';
    const cols = liveCameras.length > 1 ? 'grid-cols-2' : 'grid-cols-1';

    return (
        <div className="relative h-full w-full overflow-hidden rounded-xl border-2 border-live bg-black" data-testid="live-view">
            {connected && liveCameras.length > 0 ? (
                <div className={`grid h-full w-full ${cols} gap-0.5`}>
                    {liveCameras.map((c) => (
                        <div key={c.id} className="relative">
                            <VideoView cameraId={c.id} status={video?.[c.id]} />
                            <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2.5 py-0.5 text-sm font-semibold">{c.name}</span>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex h-full items-center justify-center p-4 text-center text-sm text-zinc-400">
                    {connected ? 'No camera is on air.' : atem.status.message || 'ATEM not connected.'}
                </div>
            )}
            <span className="absolute left-3 top-3 rounded bg-live px-2 py-0.5 text-xs font-bold tracking-wide">LIVE</span>
            {connected && others.length > 0 && (
                <span className="absolute right-3 top-3 max-w-[70%] truncate rounded bg-black/70 px-2 py-0.5 text-xs text-zinc-300">
                    Also on air: {others.join(', ')}
                </span>
            )}
        </div>
    );
}
