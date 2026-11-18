// Routing in plain words, for the window. (The same rules as
// src/main/store/routing.js, which cannot be loaded here.)

export function mixLabel(mixNames, me) {
    const n = mixNames?.[me];
    return n ? `${n} (M/E ${me + 1})` : `M/E ${me + 1}`;
}

export function sourceLabel(source, mixNames = [], names = {}) {
    if (source === null || source === undefined) return 'Nothing';
    if (source === 'mixed') return 'Mixed';
    if (source >= 10010 && source < 11000) {
        const me = Math.floor((source - 10000) / 10) - 1;
        return source % 10 === 1 ? `${mixLabel(mixNames, me)} preview` : mixLabel(mixNames, me);
    }
    return names?.[source] || `Source ${source}`;
}

export function screenShowing(screen, aux) {
    const now = new Set(screen.aux.map((a) => aux?.[a]));
    if (now.size !== 1) return 'mixed';
    const [one] = now;
    return Number.isInteger(one) ? one : null;
}

export function buttonActive(button, aux) {
    return button.set.length > 0 && button.set.every((c) => aux?.[c.aux] === c.source);
}

export const auxText = (list) => `Aux ${list.map((a) => a + 1).join(', ')}`;

// The screen an aux output feeds, by name, or "Aux 3".
export function auxName(screens, aux) {
    return screens.find((s) => s.aux.includes(aux))?.name ?? `Aux ${aux + 1}`;
}

// "LED wall ← Live stream (M/E 1)" lines for a button.
export function buttonLines(button, screens, mixNames, names) {
    const lines = [];
    for (const c of button.set) {
        const line = `${auxName(screens, c.aux)} ← ${sourceLabel(c.source, mixNames, names)}`;
        if (!lines.includes(line)) lines.push(line);
    }
    return lines;
}

// "LED WALL, LOBBY TVS": the screens a button changes.
export function buttonSummary(button, screens) {
    const names = [];
    for (const c of button.set) {
        const n = auxName(screens, c.aux);
        if (!names.includes(n)) names.push(n);
    }
    return names.join(', ');
}
