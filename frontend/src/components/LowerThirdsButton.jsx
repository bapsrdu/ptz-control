import { useState } from 'react';
import { Captions } from 'lucide-react';

// Turns the ATEM key that carries the lower thirds on or off. The names and
// text themselves are cued in Broadcast Controller.
export default function LowerThirdsButton({ state, onError }) {
    const [busy, setBusy] = useState(false);
    const onAir = Boolean(state?.onAir);
    return (
        <button
            type="button"
            data-testid="lower-thirds"
            aria-pressed={onAir}
            disabled={busy || !state}
            onClick={async () => {
                setBusy(true);
                const out = await window.ptz.lowerThirds(!onAir);
                setBusy(false);
                if (!out?.ok) onError(out?.message || 'The ATEM did not accept that.');
            }}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50 ${onAir ? 'bg-live text-white' : 'bg-panel-2 text-zinc-200 hover:bg-white/10'}`}
        >
            <Captions size={16} /> Lower thirds {onAir ? 'ON AIR' : 'off'}
        </button>
    );
}
