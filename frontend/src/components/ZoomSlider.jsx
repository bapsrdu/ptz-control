import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { useDrive } from '../useDrive.js';
import HoldButton from './HoldButton.jsx';

const HEIGHT = 160;
const KNOB = 44;

// Spring-loaded zoom lever: push up to zoom in, down to zoom out. The further
// it is pushed, the faster the zoom. It springs back to the middle and stops
// when let go.
export default function ZoomSlider({ cameraId, disabled }) {
    const track = useRef(null);
    const dragging = useRef(false);
    const [value, setValue] = useState(0);
    const drive = useDrive({
        send: (id, v) => window.ptz.zoom(id, v),
        stop: (id) => window.ptz.stopZoom(id),
    });

    useEffect(() => () => {
        dragging.current = false;
        setValue(0);
        drive.release();
    }, [cameraId, drive]);

    function update(event) {
        const rect = track.current.getBoundingClientRect();
        const half = (rect.height - KNOB) / 2;
        const v = Math.max(-1, Math.min(1, -(event.clientY - (rect.top + rect.height / 2)) / half));
        setValue(v);
        drive.set(cameraId, v);
    }

    function end() {
        if (!dragging.current) return;
        dragging.current = false;
        setValue(0);
        drive.release();
    }

    const hold = (v) => () => {
        setValue(v);
        drive.set(cameraId, v);
    };
    const release = () => {
        setValue(0);
        drive.release();
    };
    const travel = (HEIGHT - KNOB) / 2;

    return (
        <div className={`flex flex-col items-center gap-2 ${disabled ? 'opacity-40' : ''}`}>
            <HoldButton aria-label="Zoom in" disabled={disabled} onHold={hold(0.6)} onRelease={release} className="rounded-full p-1.5 text-zinc-300 hover:bg-white/10">
                <ZoomIn size={20} />
            </HoldButton>
            <div
                ref={track}
                data-testid="zoom-slider"
                aria-label="Zoom"
                className="relative w-14 touch-none rounded-full border border-edge bg-panel-2"
                style={{ height: HEIGHT }}
                onPointerDown={(e) => {
                    if (disabled || e.button !== 0) return;
                    dragging.current = true;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    update(e);
                }}
                onPointerMove={(e) => dragging.current && update(e)}
                onPointerUp={end}
                onPointerCancel={end}
                onLostPointerCapture={end}
            >
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 bg-white/15" />
                <div
                    className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-zinc-400"
                    style={{
                        width: KNOB,
                        height: KNOB,
                        top: (HEIGHT - KNOB) / 2 - value * travel,
                        transition: dragging.current ? 'none' : 'top 120ms ease-out',
                    }}
                />
            </div>
            <HoldButton aria-label="Zoom out" disabled={disabled} onHold={hold(-0.6)} onRelease={release} className="rounded-full p-1.5 text-zinc-300 hover:bg-white/10">
                <ZoomOut size={20} />
            </HoldButton>
        </div>
    );
}
