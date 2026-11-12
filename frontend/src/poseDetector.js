// Finds a person in a video frame with Google MediaPipe Pose (Apache 2.0),
// loaded from the app's own files (ptz-asset://mediapipe/), so it works with
// no internet.

const BASE = 'ptz-asset://mediapipe/';
let loading = null;

function loadScript() {
    if (window.Pose) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `${BASE}pose.js`;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Could not load the person detector.'));
        document.head.appendChild(s);
    });
}

// Creates a detector. detect(canvas) resolves to the 33 pose landmarks
// ({ x, y, visibility }, 0..1 of the frame) or null when nobody is found.
export async function createPoseDetector({ modelComplexity = 1 } = {}) {
    loading = loading || loadScript();
    await loading;
    const pose = new window.Pose({ locateFile: (file) => BASE + file });
    pose.setOptions({
        modelComplexity, // 0 lite (fastest), 1 full
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
        selfieMode: false,
    });
    let pending = null;
    pose.onResults((results) => {
        const done = pending;
        pending = null;
        done?.(results.poseLandmarks ?? null);
    });
    await pose.initialize();
    return {
        detect(canvas) {
            return new Promise((resolve, reject) => {
                pending = resolve;
                pose.send({ image: canvas }).catch((err) => {
                    pending = null;
                    reject(err);
                });
            });
        },
        close() {
            pose.close();
        },
    };
}
