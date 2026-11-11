// Any camera that speaks standard Sony VISCA over IP. No auto tracking or tally.

export const genericVisca = Object.freeze({
    id: 'generic-visca',
    label: 'Other camera (standard VISCA)',
    defaultPort: 52381,
    panSpeedMax: 0x18,
    tiltSpeedMax: 0x14,
    zoomSpeedMax: 7,
    features: Object.freeze({ tracking: false, tally: false }),
    trackingCommand: null,
    tallyCommands: null,
    previewUrl: null,
});
