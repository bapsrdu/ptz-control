// Works out which ATEM inputs are LIVE and which are NEXT, from the switcher's
// state and the user's "watched" list.
//
// watched is any mix of:
//   { type: 'me',  index }   an M/E row's program (and its preview for NEXT)
//   { type: 'aux', index }   an output (aux bus), e.g. a screen fed directly
//
// Everything visible on a watched M/E program or watched output is LIVE,
// including sources inside keys and SuperSource boxes, and both sides of a
// transition in progress. That is deliberately cautious: wrongly showing a
// camera as LIVE only asks the operator to confirm; wrongly showing it as safe
// could put a moving camera on screen.
//
// NEXT is what is on the preview of a watched M/E and not already LIVE.

import { listVisibleInputs, AtemStateUtil, Enums } from 'atem-connection';

const CLEAN_FEED_FIRST = 7001;

// Every input visible in the picture a source produces.
export function expandSource(state, source) {
    if (typeof source !== 'number') return [];
    const input = state.inputs?.[source];
    if (input?.internalPortType === Enums.InternalPortType.MEOutput || (source >= 10010 && source < 10100)) {
        const me = Math.floor((source - 10000) / 10) - 1;
        const mode = source % 10 === 0 ? 'program' : 'preview';
        if (!state.video.mixEffects[me]) return [];
        return listVisibleInputs(mode, state, me);
    }
    if (source >= CLEAN_FEED_FIRST && source < CLEAN_FEED_FIRST + 8) {
        // A clean feed is an M/E program without some keys. Counting the keys
        // anyway errs on the safe side.
        const me = source - CLEAN_FEED_FIRST;
        return state.video.mixEffects[me] ? listVisibleInputs('program', state, me) : [];
    }
    if (input?.internalPortType === Enums.InternalPortType.SuperSource || (source >= 6000 && source < 6010)) {
        const ssrc = state.video.superSources?.[source - 6000];
        const out = new Set([source]);
        for (const box of ssrc?.boxes ?? []) {
            if (box?.enabled) for (const s of expandSource(state, box.source)) out.add(s);
        }
        if (ssrc?.properties) {
            for (const s of expandSource(state, ssrc.properties.artFillSource)) out.add(s);
            if (ssrc.properties.artOption === Enums.SuperSourceArtOption.Foreground) out.add(ssrc.properties.artCutSource);
        }
        return [...out];
    }
    return [source];
}

export function computeOnAir(state, watched = []) {
    const live = new Set();
    const next = new Set();
    if (!state?.video) return { live, next };
    for (const w of watched) {
        if (w.type === 'me') {
            if (!state.video.mixEffects[w.index]) continue;
            for (const id of listVisibleInputs('program', state, w.index)) live.add(id);
            for (const id of listVisibleInputs('preview', state, w.index)) next.add(id);
        } else if (w.type === 'aux') {
            for (const id of expandSource(state, state.video.auxilliaries[w.index])) live.add(id);
        }
    }
    for (const id of live) next.delete(id);
    return { live, next };
}

// The lower-thirds keyer's state: { onAir, inTransition } or null if unknown.
export function keyerState(state, keyer) {
    if (!keyer || !state?.video) return null;
    if (keyer.type === 'dsk') {
        const dsk = state.video.downstreamKeyers[keyer.index];
        return dsk ? { onAir: Boolean(dsk.onAir), inTransition: Boolean(dsk.inTransition) } : null;
    }
    if (keyer.type === 'usk') {
        const usk = state.video.mixEffects[keyer.me]?.upstreamKeyers?.[keyer.index];
        return usk ? { onAir: Boolean(usk.onAir), inTransition: false } : null;
    }
    return null;
}

export { AtemStateUtil };
