// Decodes each camera's H.264 frames once (WebCodecs) and draws them onto
// every canvas currently showing that camera: its tile and, when selected,
// the large view.

const cameras = new Map(); // cameraId -> { decoder, codec, canvases, waitingForKey, ts, hasPicture }
const MAX_QUEUE = 6; // frames waiting to decode before we skip ahead
let listening = false;

function entry(id) {
    let cam = cameras.get(id);
    if (!cam) {
        cam = { decoder: null, codec: null, canvases: new Set(), waitingForKey: true, ts: 0, hasPicture: false };
        cameras.set(id, cam);
    }
    return cam;
}

function reset(cam) {
    if (cam.decoder && cam.decoder.state !== 'closed') {
        try { cam.decoder.close(); } catch {}
    }
    cam.decoder = null;
    cam.waitingForKey = true;
}

function draw(cam, frame) {
    try {
        for (const canvas of cam.canvases) {
            if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
                canvas.width = frame.displayWidth;
                canvas.height = frame.displayHeight;
            }
            canvas.getContext('2d').drawImage(frame, 0, 0);
        }
        cam.hasPicture = true;
    } finally {
        frame.close();
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
    if (cam.waitingForKey && !key) return;
    if (!cam.decoder) {
        if (typeof VideoDecoder === 'undefined') return;
        cam.decoder = new VideoDecoder({
            output: (frame) => draw(cam, frame),
            error: () => reset(cam),
        });
        try {
            cam.decoder.configure({ codec, optimizeForLatency: true });
        } catch {
            reset(cam);
            return;
        }
    }
    if (cam.decoder.decodeQueueSize > MAX_QUEUE) {
        // Falling behind: drop what is queued and restart from the next key frame.
        reset(cam);
        return;
    }
    try {
        cam.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: (cam.ts += 40000), data }));
        cam.waitingForKey = false;
    } catch {
        reset(cam);
    }
}

// Shows a camera's video on a canvas. Returns a function that stops it.
export function attach(cameraId, canvas) {
    if (!listening) {
        listening = true;
        window.ptz.onVideoFrame(onFrame);
    }
    const cam = entry(cameraId);
    cam.canvases.add(canvas);
    return () => {
        cam.canvases.delete(canvas);
        if (!cam.canvases.size) {
            reset(cam);
            cam.hasPicture = false;
        }
    };
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
