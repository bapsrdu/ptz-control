// Makes each camera's tally lights follow the ATEM: red when LIVE, green when
// NEXT, off otherwise. Sends only changes, and re-sends when a camera
// reconnects (it may have been power-cycled).

export class TallySync {
    constructor(manager) {
        this.manager = manager;
        this.sent = new Map(); // cameraId -> 'red' | 'green' | 'off'
    }

    // wanted: Map cameraId -> 'red' | 'green' | 'off', for every camera with tally lights.
    update(wanted) {
        for (const [id, colour] of wanted) {
            if (this.sent.get(id) === colour) continue;
            this.sent.set(id, colour);
            this.manager.tally(id, { red: colour === 'red', green: colour === 'green' }).then((out) => {
                // Try again next time if the camera did not take it.
                if (!out.ok && this.sent.get(id) === colour) this.sent.delete(id);
            });
        }
        for (const id of [...this.sent.keys()]) if (!wanted.has(id)) this.sent.delete(id);
    }

    forget(cameraId) {
        this.sent.delete(cameraId);
    }
}
