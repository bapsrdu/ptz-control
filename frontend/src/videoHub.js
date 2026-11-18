// Decodes each camera's H.264 frames once (WebCodecs) and draws them onto
// every canvas currently showing that camera: its tile and, when selected,
// the large view.
//
// Smoothness rules:
// - Decoded pictures are not drawn the moment they come out of the decoder.
//   Only the newest picture per camera is kept, and all cameras are drawn
//   together once per screen refresh. A burst of frames never queues up
//   drawing work, and an older picture is never drawn over a newer one.
// - When the decoder falls behind, frames are skipped up to the next key
//   frame, but the decoder is kept and the last picture stays on screen. The
//   decoder is only rebuilt after an error or a change of stream.

const cameras = new Map(); // cameraId -> state, see entry()
const MAX_QUEUE = 10; // frames waiting to decode before we skip ahead
const STATS_MS = 1000;
let listening = false;
let paintScheduled = false;
const contexts = new WeakMap(); // canvas -> 2D context

function entry(id) {
    let cam = cameras.get(id);
    if (!cam) {
        cam = {
            decoder: null,
            codec: null,
            canvases: new Set(),
            waitingForKey: true,
            ts: 0,
            hasPicture: false,
            onPicture: new Map(),
            latest: null, // newest decoded VideoFrame not yet drawn
            stats: { frames: 0, since: 0, fps: 0, width: 0, height: 0 },
            statsListeners: new Set(),
        };
        cameras.set(id, cam);
    }
    return cam;
}

function dropLatest(cam) {
    if (cam.latest) {
        cam.latest.close();
        cam.latest = null;
    }
}

function reset(cam) {
    if (cam.decoder && cam.decoder.state !== 'closed') {
        try { cam.decoder.close(); } catch {}
    }
    cam.decoder = null;
    cam.waitingForKey = true;
    dropLatest(cam);
    cam.stats.frames = 0;
    cam.stats.since = 0;
}

function contextFor(canvas) {
    let ctx = contexts.get(canvas);
    if (!ctx) {
        ctx = canvas.getContext('2d', { alpha: false });
        contexts.set(canvas, ctx);
    }
    return ctx;
}

function countFrame(cam, frame) {
    const s = cam.stats;
    const now = performance.now();
    if (!s.since) s.since = now;
    s.frames += 1;
    s.width = frame.displayWidth;
    s.height = frame.displayHeight;
    if (now - s.since >= STATS_MS) {
        s.fps = (s.frames * 1000) / (now - s.since);
        s.frames = 0;
        s.since = now;
        for (const listener of cam.statsListeners) listener({ fps: s.fps, width: s.width, height: s.height });
    }
}

function onDecoded(cam, frame) {
    countFrame(cam, frame);
    if (!cam.canvases.size) {
        frame.close();
        return;
    }
    // A newer picture replaces one that was never drawn.
    dropLatest(cam);
    cam.latest = frame;
    schedulePaint();
}

function schedulePaint() {
    if (paintScheduled) return;
    paintScheduled = true;
    requestAnimationFrame(paint);
}

function paint() {
    paintScheduled = false;
    for (const cam of cameras.values()) {
        const frame = cam.latest;
        if (!frame) continue;
        cam.latest = null;
        try {
            for (const canvas of cam.canvases) {
                if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
                    canvas.width = frame.displayWidth;
                    canvas.height = frame.displayHeight;
                }
                contextFor(canvas).drawImage(frame, 0, 0);
                // Tell a newly attached view once that it has a picture.
                const notify = cam.onPicture.get(canvas);
                if (notify) {
                    cam.onPicture.delete(canvas);
                    notify();
                }
            }
            cam.hasPicture = true;
        } finally {
            frame.close();
        }
    }
}

function onFrame(id, { codec, key, data }) {
    const cam = entry(id);
    if (!cam.canvases.size) {
        // Nobody is watching; start clean from a key frame when someone does.
        if (cam.decoder) reset(cam);
        return;
    }
    if (codec !== cam.codec) {
        reset(cam);
        cam.codec = codec;
    }
    if (!cam.decoder) {
        if (typeof VideoDecoder === 'undefined') return;
        cam.waitingForKey = true;
        cam.decoder = new VideoDecoder({
            output: (frame) => onDecoded(cam, frame),
            error: () => reset(cam),
        });
        try {
            cam.decoder.configure({ codec, optimizeForLatency: true });
        } catch {
            reset(cam);
            return;
        }
    }
    if (!key && cam.decoder.decodeQueueSize > MAX_QUEUE) {
        // Falling behind: skip to the next key frame. The decoder keeps what it
        // has and the last picture stays on screen meanwhile.
        cam.waitingForKey = true;
    }
    if (cam.waitingForKey && !key) return;
    try {
        cam.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: (cam.ts += 33333), data }));
        cam.waitingForKey = false;
    } catch {
        reset(cam);
    }
}

// Shows a camera's video on a canvas. onPicture() is called once, when the
// first picture is drawn on it. Returns a function that stops it.
export function attach(cameraId, canvas, onPicture) {
    if (!listening) {
        listening = true;
        window.ptz.onVideoFrame(onFrame);
    }
    const cam = entry(cameraId);
    cam.canvases.add(canvas);
    if (onPicture) cam.onPicture.set(canvas, onPicture);
    return () => {
        cam.canvases.delete(canvas);
        cam.onPicture.delete(canvas);
        if (!cam.canvases.size) {
            reset(cam);
            cam.hasPicture = false;
        }
    };
}

// Calls listener({ fps, width, height }) about once a second with the frame
// rate and picture size the camera is delivering. Returns a function that
// stops it.
export function watchStats(cameraId, listener) {
    const cam = entry(cameraId);
    cam.statsListeners.add(listener);
    return () => cam.statsListeners.delete(listener);
}

// A small JPEG of what the camera shows now, for a saved shot. Null if there
// is no picture yet.
export function snapshot(cameraId) {
    const cam = cameras.get(cameraId);
    if (!cam?.hasPicture) return null;
    const source = [...cam.canvases].find((c) => c.width > 0);
    if (!source) return null;
    const out = document.createElement('canvas');
    out.width = 320;
    out.height = Math.round((320 * source.height) / source.width);
    out.getContext('2d').drawImage(source, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.8);
}

// A canvas showing this camera's current picture, for the person detector.
export function canvasFor(cameraId) {
    const cam = cameras.get(cameraId);
    if (!cam?.hasPicture) return null;
    return [...cam.canvases].find((c) => c.width > 0) ?? null;
}
