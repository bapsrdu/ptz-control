// BZBGEAR BG-ADAMO cameras (built and tested against the BG-ADAMO-4KND25X).
// Values from the BG-ADAMO-4KND product manual.

const header = (address) => 0x80 + address;

export const bzbAdamo = Object.freeze({
    id: 'bzb-adamo',
    label: 'BZBGEAR BG-ADAMO',
    defaultPort: 1259,
    panSpeedMax: 0x18,
    tiltSpeedMax: 0x14,
    zoomSpeedMax: 7,
    features: Object.freeze({ tracking: true, tally: true }),

    // "Auto Tracking On/Off" in the manual's VISCA table.
    trackingCommand(address, on) {
        return Buffer.from([header(address), 0x0a, 0x01, 0x32, 0x00, 0x00, on ? 0x02 : 0x03, 0x00, 0xff]);
    },

    // Tally lights. red/green: true = on, false = off, undefined = leave alone.
    tallyCommands(address, { red, green }) {
        const out = [];
        if (red !== undefined) {
            out.push(Buffer.from([header(address), 0x01, 0x7e, 0x01, 0x0a, 0x00, red ? 0x02 : 0x03, 0x00, 0xff]));
        }
        if (green !== undefined) {
            out.push(Buffer.from([header(address), 0x01, 0x7e, 0x01, 0x0a, 0x00, 0x00, green ? 0x02 : 0x03, 0xff]));
        }
        return out;
    },

    // Sub stream, used for the preview video (phase 3).
    previewUrl(host) {
        return `rtsp://${host}:554/live/av1`;
    },
});
