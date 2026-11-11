import { useCallback, useEffect, useMemo, useRef } from 'react';

// Drives one continuous movement (pan/tilt, zoom or focus) while a control is
// held.
//   set(cameraId, value)  start or change the movement
//   release()             stop it
//
// While held, the value is re-sent every KEEP_ALIVE_MS. The main process stops
// the camera if these stop arriving, so a frozen window cannot leave a camera
// moving. release() always stops the camera that was being moved, even if the
// selected camera has changed since.
const KEEP_ALIVE_MS = 400;

export function useDrive({ send, stop }) {
    const sendRef = useRef(send);
    const stopRef = useRef(stop);
    sendRef.current = send;
    stopRef.current = stop;
    const active = useRef(null); // { cameraId, value }
    const timer = useRef(null);

    const release = useCallback(() => {
        if (timer.current) {
            clearInterval(timer.current);
            timer.current = null;
        }
        const was = active.current;
        active.current = null;
        if (was) stopRef.current(was.cameraId);
    }, []);

    const set = useCallback((cameraId, value) => {
        if (active.current && active.current.cameraId !== cameraId) release();
        active.current = { cameraId, value };
        sendRef.current(cameraId, value);
        if (!timer.current) {
            timer.current = setInterval(() => {
                const a = active.current;
                if (a) sendRef.current(a.cameraId, a.value);
            }, KEEP_ALIVE_MS);
        }
    }, [release]);

    useEffect(() => {
        window.addEventListener('blur', release);
        return () => {
            window.removeEventListener('blur', release);
            release();
        };
    }, [release]);

    // Stable across renders, so components can use it in effect dependencies.
    return useMemo(() => ({ set, release }), [set, release]);
}
