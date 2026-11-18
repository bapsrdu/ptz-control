import { useCallback, useEffect, useRef, useState } from 'react';
import { createPoseDetector } from './poseDetector.js';
import { canvasFor } from './videoHub.js';

const INTERVAL_MS = 100; // about 10 looks a second
const POINTS = {
    nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8,
    leftShoulder: 11, rightShoulder: 12, leftHip: 23, rightHip: 24, leftAnkle: 27, rightAnkle: 28,
};

let detectorPromise = null;

function webglAvailable() {
    try {
        return Boolean(document.createElement('canvas').getContext('webgl2'));
    } catch {
        return false;
    }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The part of the picture to look in, as fractions { x0, y0, x1, y1 }, kept
// inside the picture and at least `min` wide and tall.
function region(cx, cy, w, h) {
    const W = clamp(w, 0.25, 1);
    const H = clamp(h, 0.4, 1);
    const x0 = clamp(cx - W / 2, 0, 1 - W);
    const y0 = clamp(cy - H / 2, 0, 1 - H);
    return { x0, y0, x1: x0 + W, y1: y0 + H };
}

const WHOLE = { x0: 0, y0: 0, x1: 1, y1: 1 };

// Runs the person detector on the camera that has app tracking on, sends the
// body points to the main process, and returns:
//   overlay: the box to draw around the person, { cameraId, box } (fractions)
//   follow(cameraId, { x, y }): follow the person at that point of the picture
//
// The detector finds one person. To follow a chosen person, it looks only in
// a region around them, moved with them every look; so someone else on the
// stage does not take over. If the person is not found for a while the
// region widens, until in the end it is the whole picture again.
export function useAppTracker(appTracking) {
    const cameraId = Object.keys(appTracking ?? {})[0] ?? null;
    const [overlay, setOverlay] = useState(null);
    const running = useRef(null);
    const roi = useRef(null); // { cameraId, box, misses } or null for the whole picture

    const follow = useCallback((id, point) => {
        roi.current = { cameraId: id, box: region(point.x, point.y + 0.15, 0.3, 0.8), misses: 0, chosen: true };
        setOverlay({ cameraId: id, box: null, picked: point });
    }, []);

    useEffect(() => {
        setOverlay(null);
        if (roi.current?.cameraId !== cameraId) roi.current = null;
        if (!cameraId) return undefined;
        const token = {};
        running.current = token;
        let timer = null;
        const crop = document.createElement('canvas');

        async function loop(detector) {
            if (running.current !== token) return;
            const started = performance.now();
            const canvas = canvasFor(cameraId);
            let points = null;
            if (canvas?.width) {
                try {
                    const r = roi.current?.cameraId === cameraId ? roi.current : null;
                    const box = r?.box ?? WHOLE;
                    let image = canvas;
                    if (r) {
                        // Copy just the region to look in.
                        const sw = Math.round((box.x1 - box.x0) * canvas.width);
                        const sh = Math.round((box.y1 - box.y0) * canvas.height);
                        crop.width = sw;
                        crop.height = sh;
                        crop.getContext('2d').drawImage(canvas, Math.round(box.x0 * canvas.width), Math.round(box.y0 * canvas.height), sw, sh, 0, 0, sw, sh);
                        image = crop;
                    }
                    const landmarks = await detector.detect(image);
                    if (running.current !== token) return;
                    if (landmarks) {
                        // Back to fractions of the whole picture.
                        const bw = box.x1 - box.x0;
                        const bh = box.y1 - box.y0;
                        const at = (p) => ({ x: box.x0 + p.x * bw, y: box.y0 + p.y * bh, visibility: p.visibility ?? 1 });
                        points = Object.fromEntries(Object.entries(POINTS).map(([name, i]) => [name, at(landmarks[i])]));
                        const seen = landmarks.filter((p) => (p.visibility ?? 1) > 0.5).map(at);
                        if (seen.length) {
                            const xs = seen.map((p) => p.x);
                            const ys = seen.map((p) => p.y);
                            const neck = Math.max(0.02, (points.leftShoulder.y + points.rightShoulder.y) / 2 - points.nose.y);
                            const person = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - neck * 0.6, y1: Math.max(...ys) };
                            setOverlay({ cameraId, box: person, chosen: Boolean(r) });
                            if (r) {
                                // Keep looking around them, wherever they go.
                                const w = person.x1 - person.x0;
                                const h = person.y1 - person.y0;
                                r.box = region((person.x0 + person.x1) / 2, (person.y0 + person.y1) / 2, Math.max(w * 2.2, 0.3), Math.max(h * 1.5, 0.5));
                                r.misses = 0;
                            }
                        } else if (r) {
                            r.misses += 1;
                        }
                    } else {
                        setOverlay((o) => (o?.picked ? o : null));
                        if (r) {
                            r.misses += 1;
                            // Not found: look a little wider each time.
                            if (r.misses > 3) {
                                const b = r.box;
                                r.box = region((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.x1 - b.x0) * 1.12, (b.y1 - b.y0) * 1.12);
                            }
                            if (r.box.x1 - r.box.x0 >= 0.999 && r.box.y1 - r.box.y0 >= 0.999) roi.current = null;
                        }
                    }
                } catch {
                    points = null;
                }
            }
            window.ptz.trackObserve(cameraId, points);
            timer = setTimeout(() => loop(detector), Math.max(0, INTERVAL_MS - (performance.now() - started)));
        }

        (async () => {
            if (!webglAvailable()) {
                window.ptz.trackUnavailable(cameraId, 'App tracking needs graphics acceleration (WebGL), which this computer does not have. Use the camera\'s own tracking instead.');
                return;
            }
            try {
                detectorPromise = detectorPromise || createPoseDetector({ modelComplexity: 1 });
                const detector = await detectorPromise;
                loop(detector);
            } catch (err) {
                detectorPromise = null;
                window.ptz.trackUnavailable(cameraId, `The person detector could not start: ${err.message}`);
            }
        })();

        return () => {
            running.current = null;
            clearTimeout(timer);
        };
    }, [cameraId]);

    return { overlay: overlay && overlay.cameraId === cameraId ? overlay : null, follow };
}
