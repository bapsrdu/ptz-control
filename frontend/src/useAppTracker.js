import { useEffect, useRef, useState } from 'react';
import { createPoseDetector } from './poseDetector.js';
import { canvasFor } from './videoHub.js';

const INTERVAL_MS = 100; // about 10 looks a second
const POINTS = { nose: 0, leftShoulder: 11, rightShoulder: 12, leftHip: 23, rightHip: 24, leftAnkle: 27, rightAnkle: 28 };

let detectorPromise = null;

function webglAvailable() {
    try {
        return Boolean(document.createElement('canvas').getContext('webgl2'));
    } catch {
        return false;
    }
}

// Runs the person detector on the camera that has app tracking on, sends the
// body points to the main process, and returns the box to draw around the
// person: { cameraId, box: { x0, y0, x1, y1 } } (fractions of the frame).
export function useAppTracker(appTracking) {
    const cameraId = Object.keys(appTracking ?? {})[0] ?? null;
    const [overlay, setOverlay] = useState(null);
    const running = useRef(null);

    useEffect(() => {
        setOverlay(null);
        if (!cameraId) return undefined;
        const token = {};
        running.current = token;
        let timer = null;

        async function loop(detector) {
            if (running.current !== token) return;
            const started = performance.now();
            const canvas = canvasFor(cameraId);
            let points = null;
            if (canvas) {
                try {
                    const landmarks = await detector.detect(canvas);
                    if (running.current !== token) return;
                    if (landmarks) {
                        points = Object.fromEntries(Object.entries(POINTS).map(([name, i]) => {
                            const p = landmarks[i];
                            return [name, { x: p.x, y: p.y, visibility: p.visibility ?? 1 }];
                        }));
                        const seen = landmarks.filter((p) => (p.visibility ?? 1) > 0.5);
                        if (seen.length) {
                            const xs = seen.map((p) => p.x);
                            const ys = seen.map((p) => p.y);
                            const neck = Math.max(0.02, (points.leftShoulder.y + points.rightShoulder.y) / 2 - points.nose.y);
                            setOverlay({
                                cameraId,
                                box: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - neck * 0.6, y1: Math.max(...ys) },
                            });
                        }
                    } else {
                        setOverlay(null);
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

    return overlay && overlay.cameraId === cameraId ? overlay : null;
}
