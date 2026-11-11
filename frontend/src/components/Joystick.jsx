import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useDrive } from '../useDrive.js';

const SIZE = 200;
const KNOB = 64;

// Round pan/tilt pad. Drag the knob: the further from the centre, the faster
// the camera moves. Let go and the camera stops.
export default function Joystick({ cameraId, disabled }) {
    const pad = useRef(null);
    const dragging = useRef(false);
    const [knob, setKnob] = useState({ x: 0, y: 0 });
    const drive = useDrive({
        send: (id, v) => window.ptz.move(id, v),
        stop: (id) => window.ptz.stopMove(id),
    });

    // Changing camera mid-drag stops the old camera.
    useEffect(() => () => {
        dragging.current = false;
        setKnob({ x: 0, y: 0 });
        drive.release();
    }, [cameraId, drive]);

    function update(event) {
        const rect = pad.current.getBoundingClientRect();
        const r = (rect.width - KNOB) / 2;
        let dx = (event.clientX - (rect.left + rect.width / 2)) / r;
        let dy = (event.clientY - (rect.top + rect.height / 2)) / r;
        const mag = Math.hypot(dx, dy);
        if (mag > 1) {
            dx /= mag;
            dy /= mag;
        }
        setKnob({ x: dx, y: dy });
        drive.set(cameraId, { x: dx, y: -dy });
    }

    function end() {
        if (!dragging.current) return;
        dragging.current = false;
        setKnob({ x: 0, y: 0 });
        drive.release();
    }

    const travel = (SIZE - KNOB) / 2;
    return (
        <div
            ref={pad}
            data-testid="joystick"
            aria-label="Pan and tilt"
            aria-disabled={Boolean(disabled)}
            className={`relative shrink-0 touch-none rounded-full border border-edge bg-panel-2 ${disabled ? 'opacity-40' : 'cursor-grab active:cursor-grabbing'}`}
            style={{ width: SIZE, height: SIZE }}
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
            <div className="pointer-events-none absolute inset-6 rounded-full border border-dashed border-white/10" />
            <ChevronUp className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 text-white/50" size={20} />
            <ChevronDown className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-white/50" size={20} />
            <ChevronLeft className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-white/50" size={20} />
            <ChevronRight className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/50" size={20} />
            <div
                className="pointer-events-none absolute rounded-full bg-zinc-400 shadow-lg"
                style={{
                    width: KNOB,
                    height: KNOB,
                    left: (SIZE - KNOB) / 2 + knob.x * travel,
                    top: (SIZE - KNOB) / 2 + knob.y * travel,
                    transition: dragging.current ? 'none' : 'left 120ms ease-out, top 120ms ease-out',
                }}
            />
        </div>
    );
}
