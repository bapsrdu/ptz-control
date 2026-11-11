// Decodes each camera's H.264 frames once (WebCodecs) and draws them onto
// every canvas currently showing that camera: its tile and, when selected,
// the large view.

const cameras = new Map(); // cameraId -> { decoder, codec, canvases, waitingForKey, ts, hasPicture }
const MAX_QUEUE = 6; // frames waiting to decode before we skip ahead
let listening = false;

function entry(id) {
    let cam = cameras.get(id);
    if (!cam) {
        cam = { decoder: null, codec: null, canvases: new Set(), waitingForKey: true, ts: 0, hasPicture: false, onPicture: new Map() };
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
