// Video routing: which picture goes to which screen.
//
// The ATEM's aux outputs feed the screens and encoders around the building.
// The app names them ("screens"), says what each M/E is for ("mixNames", for
// example M/E 1 the live stream and M/E 2 the side screens), and gives the
// operator routing buttons that work like macros: one press sends one or
// more screens a new picture, and a button is lit while the switcher already
// matches it.
//
// Based on the routing page in Churchfront's CueVideo (Apache 2.0, Copyright
// 2026 Churchfront LLC; see NOTICE), rewritten in JavaScript for this app.
//
// Aux outputs are counted from 0 here, as the ATEM protocol does; the window
// shows them from 1, as the switcher's own software does. Like the rest of
// settings.js, these functions are pure: settings in, new settings out.

import crypto from 'node:crypto';

export const SCREEN_NAME_MAX = 40;
export const NOTE_MAX = 120;
export const LABEL_MAX = 40;
export const MIX_NAME_MAX = 30;
const AUX_MAX = 63;
const SOURCE_MAX = 65535;

export function defaultRouting() {
    return { mixNames: [], screens: [], buttons: [] };
}

function text(value, max) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function auxList(list) {
    const out = [];
    for (const a of Array.isArray(list) ? list : []) {
        const n = Number(a);
        if (Number.isInteger(n) && n >= 0 && n <= AUX_MAX && !out.includes(n)) out.push(n);
    }
    return out.sort((a, b) => a - b);
}

function cleanScreen(raw, taken) {
    const name = text(raw?.name, SCREEN_NAME_MAX);
    const aux = auxList(raw?.aux).filter((a) => !taken.has(a));
    if (!name || !aux.length) return null;
    for (const a of aux) taken.add(a);
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
        name,
        aux,
        note: text(raw?.note, NOTE_MAX),
        operators: raw?.operators !== false,
    };
}

function cleanChanges(list) {
    const out = [];
    for (const c of Array.isArray(list) ? list : []) {
        const aux = Number(c?.aux);
        const source = Number(c?.source);
        if (!Number.isInteger(aux) || aux < 0 || aux > AUX_MAX) continue;
        if (!Number.isInteger(source) || source < 0 || source > SOURCE_MAX) continue;
        const existing = out.findIndex((x) => x.aux === aux);
        if (existing !== -1) out.splice(existing, 1);
        out.push({ aux, source });
    }
    return out;
}

function cleanButton(raw) {
    const label = text(raw?.label, LABEL_MAX);
    const set = cleanChanges(raw?.set);
    if (!label || !set.length) return null;
    return { id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(), label, set };
}

export function normalizeRouting(raw) {
    const out = defaultRouting();
    if (!raw || typeof raw !== 'object') return out;
    out.mixNames = (Array.isArray(raw.mixNames) ? raw.mixNames : []).slice(0, 8).map((n) => text(n, MIX_NAME_MAX));
    const taken = new Set();
    out.screens = (Array.isArray(raw.screens) ? raw.screens : []).map((s) => cleanScreen(s, taken)).filter(Boolean);
    const labels = new Set();
    out.buttons = (Array.isArray(raw.buttons) ? raw.buttons : []).map(cleanButton).filter((b) => {
        if (!b || labels.has(b.label.toLowerCase())) return false;
        labels.add(b.label.toLowerCase());
        return true;
    });
    return out;
}

const ok = (settings, extra = {}) => ({ ok: true, settings, ...extra });
const fail = (message, field = 'form') => ({ ok: false, errors: { [field]: message }, message });
const withRouting = (settings, routing) => ok({ ...settings, routing });
const routingOf = (settings) => settings.routing ?? defaultRouting();

export function setMixName(settings, me, name) {
    const index = Number(me);
    if (!Number.isInteger(index) || index < 0 || index > 7) return fail('Unknown M/E.');
    const mixNames = [...routingOf(settings).mixNames];
    while (mixNames.length <= index) mixNames.push('');
    mixNames[index] = text(name, MIX_NAME_MAX);
    while (mixNames.length && !mixNames.at(-1)) mixNames.pop();
    return withRouting(settings, { ...routingOf(settings), mixNames });
}

// Adds or changes a screen. An aux output belongs to one screen only, so the
// outputs given are taken away from any other screen (which is forgotten if
// that leaves it with none).
export function saveScreen(settings, input = {}) {
    const name = text(input.name, SCREEN_NAME_MAX);
    if (!name) return fail('Give the screen a name, for example "Lobby TVs".', 'name');
    const aux = auxList(input.aux);
    if (!aux.length) return fail('Choose at least one aux output.', 'aux');
    const routing = routingOf(settings);
    const existing = input.id ? routing.screens.find((s) => s.id === input.id) : null;
    if (input.id && !existing) return fail('This screen no longer exists.');
    if (routing.screens.some((s) => s.id !== input.id && s.name.toLowerCase() === name.toLowerCase())) {
        return fail('Another screen already has this name.', 'name');
    }
    const screen = {
        id: existing?.id ?? crypto.randomUUID(),
        name,
        aux,
        note: text(input.note ?? existing?.note, NOTE_MAX),
        operators: 'operators' in input ? input.operators !== false : existing?.operators ?? true,
    };
    const screens = [];
    for (const s of routing.screens) {
        if (s.id === screen.id) {
            screens.push(screen);
            continue;
        }
        const left = s.aux.filter((a) => !aux.includes(a));
        if (left.length) screens.push({ ...s, aux: left });
    }
    if (!existing) screens.push(screen);
    return ok({ ...settings, routing: { ...routing, screens } }, { screen });
}

// Forgets a screen's name. Its aux outputs stay; they go back to "not named".
export function removeScreen(settings, id) {
    const routing = routingOf(settings);
    if (!routing.screens.some((s) => s.id === id)) return fail('This screen no longer exists.');
    return withRouting(settings, { ...routing, screens: routing.screens.filter((s) => s.id !== id) });
}

// Saves what the chosen screens show now as a button. `aux` is the ATEM's
// current source for every aux output. A button with the same label is
// replaced.
export function addRouteButton(settings, { label, screenIds = [] } = {}, aux = []) {
    const clean = text(label, LABEL_MAX);
    if (!clean) return fail('Give the button a label, for example "Lobby: stream".', 'label');
    const routing = routingOf(settings);
    const chosen = routing.screens.filter((s) => screenIds.includes(s.id));
    if (!chosen.length) return fail('Choose at least one screen.', 'screens');
    const set = chosen.flatMap((s) => s.aux.filter((a) => Number.isInteger(aux[a])).map((a) => ({ aux: a, source: aux[a] })));
    if (!set.length) return fail('The switcher has not said what those screens show yet.');
    const old = routing.buttons.find((b) => b.label.toLowerCase() === clean.toLowerCase());
    const button = { id: old?.id ?? crypto.randomUUID(), label: clean, set };
    const buttons = old ? routing.buttons.map((b) => (b.id === old.id ? button : b)) : [...routing.buttons, button];
    return ok({ ...settings, routing: { ...routing, buttons } }, { button });
}

export function renameRouteButton(settings, id, label) {
    const clean = text(label, LABEL_MAX);
    if (!clean) return fail('The button needs a label.', 'label');
    const routing = routingOf(settings);
    if (!routing.buttons.some((b) => b.id === id)) return fail('This button no longer exists.');
    if (routing.buttons.some((b) => b.id !== id && b.label.toLowerCase() === clean.toLowerCase())) {
        return fail('Another button already has this label.', 'label');
    }
    return withRouting(settings, { ...routing, buttons: routing.buttons.map((b) => (b.id === id ? { ...b, label: clean } : b)) });
}

// delta -1 moves the button one place earlier, +1 one place later.
export function moveRouteButton(settings, id, delta) {
    const routing = routingOf(settings);
    const from = routing.buttons.findIndex((b) => b.id === id);
    if (from === -1) return fail('This button no longer exists.');
    const to = Math.min(routing.buttons.length - 1, Math.max(0, from + Math.sign(Number(delta) || 0)));
    const buttons = [...routing.buttons];
    const [b] = buttons.splice(from, 1);
    buttons.splice(to, 0, b);
    return withRouting(settings, { ...routing, buttons });
}

export function removeRouteButton(settings, id) {
    const routing = routingOf(settings);
    if (!routing.buttons.some((b) => b.id === id)) return fail('This button no longer exists.');
    return withRouting(settings, { ...routing, buttons: routing.buttons.filter((b) => b.id !== id) });
}

// --- Reading the switcher ------------------------------------------------------

// Lit while the switcher already matches every change in the button.
export function buttonActive(button, aux) {
    return button.set.length > 0 && button.set.every((c) => aux[c.aux] === c.source);
}

// What a screen shows: its source, or 'mixed' when its outputs disagree, or
// null when the switcher has not said.
export function screenShowing(screen, aux) {
    const now = new Set(screen.aux.map((a) => aux[a]));
    if (now.size !== 1) return 'mixed';
    const [one] = now;
    return Number.isInteger(one) ? one : null;
}

// M/E outputs are sources 10010 (M/E 1 program), 10011 (M/E 1 preview), 10020...
export function mixOfSource(source) {
    if (source < 10010 || source >= 11000) return null;
    return { me: Math.floor((source - 10000) / 10) - 1, preview: source % 10 === 1 };
}

// "Live stream (M/E 1)", or just "M/E 2".
export function mixLabel(mixNames, me) {
    const n = mixNames?.[me];
    return n ? `${n} (M/E ${me + 1})` : `M/E ${me + 1}`;
}

// A routing source in plain words: M/E outputs by what they are for, others by
// the switcher's own name.
export function sourceLabel(source, { mixNames = [], names = {} } = {}) {
    if (source === null || source === undefined) return 'Nothing';
    if (source === 'mixed') return 'Mixed';
    const mix = mixOfSource(source);
    if (mix) return mix.preview ? `${mixLabel(mixNames, mix.me)} preview` : mixLabel(mixNames, mix.me);
    return names[source] || `Source ${source}`;
}
