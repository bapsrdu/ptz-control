// Shared helpers for the window: names for sources, the camera on an input,
// and saving setup changes.

export const SIZES = [
    { id: 'close', short: 'Close', name: 'Shoulders up' },
    { id: 'waist', short: 'Waist', name: 'Waist up' },
    { id: 'full', short: 'Full', name: 'Full length' },
];

export function meIndex(state) {
    const n = state?.atem?.mes?.length || 1;
    return Math.max(0, Math.min(n - 1, (state?.config?.me ?? 1) - 1));
}

export function mixState(state) {
    return state?.atem?.mes?.[meIndex(state)] ?? null;
}

// A switcher input in plain words: the operator's label, the camera's name,
// or the switcher's own name.
export function label(state, input) {
    if (input === null || input === undefined) return 'Nothing';
    const c = state.config;
    const s = c.sources.find((x) => x.input === input);
    if (s?.label) return s.label;
    const cam = c.cameras.find((x) => x.atemInput === input);
    if (cam?.name) return cam.name;
    return state.atem?.inputs?.[input]?.long ?? `Input ${input}`;
}

// What an M/E is for: "Live stream (M/E 1)", or just "M/E 2". me from 0.
export function mixName(state, me) {
    const n = state.config.mixNames?.[me];
    return n ? `${n} (M/E ${me + 1})` : `M/E ${me + 1}`;
}

// A routing source: M/E outputs by what they are for, others by label.
export function routeLabel(state, source) {
    if (source === null || source === undefined) return 'Nothing';
    if (source >= 10010 && source < 11000) {
        const me = Math.floor((source - 10000) / 10) - 1;
        return source % 10 === 1 ? `${mixName(state, me)} preview` : mixName(state, me);
    }
    return label(state, source);
}

export function cameraOn(state, input) {
    if (input === null || input === undefined) return null;
    return state.config.cameras.find((c) => c.atemInput === input && c.host) ?? null;
}

// The operator's source row: the ones set up, or every camera until then.
export function volunteerSources(state) {
    const c = state.config;
    if (c.sources.length) return c.sources;
    return c.cameras.filter((x) => x.atemInput).map((x) => ({ input: x.atemInput }));
}

export function isLive(state, input) {
    if (!input) return false;
    const t = state.atem?.tally?.[input];
    if (t) return Boolean(t.program);
    return mixState(state)?.program === input;
}

// Save a change to the setup: fn gets a copy and returns the new setup.
export function updateConfig(state, fn) {
    const next = fn(structuredClone(state.config));
    return window.booth.setConfig(next);
}

export function keyIsOn(state, k) {
    const a = state.atem;
    if (!a?.connected) return false;
    if (k.dsk) return Boolean(a.dsks[k.dsk - 1]?.onAir);
    return Boolean(a.mes[(k.me ?? 1) - 1]?.keys?.[k.keyer - 1]?.onAir);
}

export function toggleKey(state, k) {
    if (k.dsk) return window.booth.atem('dskAuto', k.dsk - 1);
    return window.booth.atem('keyOnAir', k.keyer - 1, !keyIsOn(state, k), (k.me ?? 1) - 1);
}

export function keyTarget(k) {
    return k.dsk ? `DSK ${k.dsk}` : `M/E ${k.me ?? 1} Key ${k.keyer}`;
}

export function routeActive(state, route) {
    const aux = state.atem?.aux ?? [];
    return route.set.length > 0 && route.set.every((c) => aux[c.aux - 1] === c.source);
}

// The screens previewed in the top bar: up to four pinned, or the first
// three meant for volunteers until any are pinned.
export function pinnedScreens(state) {
    const all = state.config.screens;
    if (all.some((s) => s.pinned !== undefined)) return all.filter((s) => s.pinned).slice(0, 4);
    return all.filter((s) => s.volunteer !== false).slice(0, 3);
}

export function frames(rate) {
    return `${Math.floor(rate / 30)}:${String(rate % 30).padStart(2, '0')}`;
}

// Only one dialog or menu may be open; while one is, the keyboard shortcuts
// do nothing so Space or Return cannot cut or fade by accident.
let modal = 0;
export const modalOpen = () => modal > 0;
export function holdModal() {
    modal += 1;
    return () => { modal = Math.max(0, modal - 1); };
}
