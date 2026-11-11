// A button that acts while pressed and stops when let go, the pointer leaves
// it, or the window loses focus.
export default function HoldButton({ onHold, onRelease, disabled, className = '', children, ...rest }) {
    const end = (e) => {
        if (e.currentTarget.dataset.held !== '1') return;
        e.currentTarget.dataset.held = '0';
        onRelease();
    };
    return (
        <button
            type="button"
            disabled={disabled}
            className={`touch-none ${className}`}
            onPointerDown={(e) => {
                if (disabled || e.button !== 0) return;
                e.currentTarget.dataset.held = '1';
                e.currentTarget.setPointerCapture(e.pointerId);
                onHold();
            }}
            onPointerUp={end}
            onPointerCancel={end}
            onLostPointerCapture={end}
            {...rest}
        >
            {children}
        </button>
    );
}
