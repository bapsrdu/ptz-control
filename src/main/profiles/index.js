// Camera profiles hold everything that differs between camera models: default
// port, speed limits, and extra commands such as auto tracking. The rest of the
// app only talks standard VISCA, so a new camera brand is a new profile file.

import { bzbAdamo } from './bzb-adamo.js';
import { genericVisca } from './generic-visca.js';

export const PROFILES = Object.freeze({
    [bzbAdamo.id]: bzbAdamo,
    [genericVisca.id]: genericVisca,
});

export const DEFAULT_PROFILE_ID = bzbAdamo.id;

export function getProfile(id) {
    return PROFILES[id] ?? PROFILES[DEFAULT_PROFILE_ID];
}

// The part of each profile the window needs (no functions).
export function describeProfiles() {
    return Object.values(PROFILES).map((p) => ({
        id: p.id,
        label: p.label,
        defaultPort: p.defaultPort,
        features: { ...p.features },
        // Shown as the example in the camera form, with {host} filled in there.
        videoUrlTemplate: p.previewUrl ? p.previewUrl('{host}') : null,
    }));
}

// The video address to use for a camera: the one the user typed, or the
// model's usual address built from the camera's IP.
export function videoUrlFor(camera) {
    if (camera.previewUrl) return camera.previewUrl;
    return getProfile(camera.profile).previewUrl?.(camera.host) ?? null;
}
