// Settings that BZB cameras only offer on their own web page (tracking mode,
// headroom), reached the same way that page does: GET /ajaxcom?szCmd=<JSON>.
// Worked out from a recording of the BG-ADAMO-4KND25X web page (Settings,
// Record a camera's web page).
//
//   {"GetEnv":{"MonoTracking":{"nChannel":-1}}}   read tracking settings
//   {"SetEnv":{"MonoTracking":{"nTrackMode":1}}}   0 Presenter, 1 Zone
//   {"SetEnv":{"MonoTracking":{"nHeadRoom":2}}}    0, 1, 2 (Low, Medium, High)
//   {"SetEnv":{"MonoTracking":{"bEnable":1}}}      tracking on/off
//
// Replies are JSON with nRetVal 0 for success. The page logs in with
// POST /login/login (username=..&password=..) first; no cookie is set, so
// most cameras answer without it, but if a reply is not JSON we log in once
// and try again.

export const HEADROOM = Object.freeze(['low', 'medium', 'high']);
export const TRACK_MODES = Object.freeze(['presenter', 'zone']);

export class BzbWeb {
    constructor({ host, port = 80, username = 'admin', password = 'admin', timeoutMs = 3000, fetchImpl = globalThis.fetch }) {
        this.base = `http://${host}${port === 80 ? '' : `:${port}`}`;
        this.username = username;
        this.password = password;
        this.timeoutMs = timeoutMs;
        this.fetch = fetchImpl;
        this.loggedIn = false;
    }

    async #get(path) {
        const res = await this.fetch(this.base + path, {
            headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        return { status: res.status, text: await res.text() };
    }

    async login() {
        const res = await this.fetch(`${this.base}/login/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ username: this.username, password: this.password }).toString(),
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        await res.text();
        if (!res.ok) throw webError(`The camera's web page refused the login (${res.status}).`);
        this.loggedIn = true;
    }

    // Sends one command; resolves with the reply's stValue (if any).
    async command(cmd) {
        const path = `/ajaxcom?szCmd=${encodeURIComponent(JSON.stringify(cmd))}&_=${Date.now()}`;
        let reply;
        try {
            reply = await this.#get(path);
        } catch (err) {
            throw webError(describe(err, this.base));
        }
        let data = parse(reply.text);
        if (!data && !this.loggedIn) {
            // Probably the login page instead of JSON: log in and try once more.
            await this.login();
            reply = await this.#get(path);
            data = parse(reply.text);
        }
        if (!data) throw webError(`The camera's web page did not answer as expected (${reply.status}).`);
        if (data.nRetVal !== 0) throw webError(`The camera refused the setting (code ${data.nRetVal}).`);
        return data.stValue;
    }

    async getTracking() {
        const v = await this.command({ GetEnv: { MonoTracking: { nChannel: -1 } } });
        return {
            enabled: v?.bEnable === 1,
            mode: TRACK_MODES[v?.nTrackMode] ?? null,
            headroom: HEADROOM[v?.nHeadRoom] ?? null,
        };
    }

    // patch: { enabled?, mode?, headroom? }. Sends one command per field, like
    // the camera's own page does.
    async setTracking(patch) {
        if ('mode' in patch) {
            const n = TRACK_MODES.indexOf(patch.mode);
            if (n === -1) throw webError('Unknown tracking mode.');
            await this.command({ SetEnv: { MonoTracking: { nTrackMode: n } } });
        }
        if ('headroom' in patch) {
            const n = HEADROOM.indexOf(patch.headroom);
            if (n === -1) throw webError('Unknown headroom.');
            await this.command({ SetEnv: { MonoTracking: { nHeadRoom: n } } });
        }
        if ('enabled' in patch) {
            await this.command({ SetEnv: { MonoTracking: { bEnable: patch.enabled ? 1 : 0 } } });
        }
        return this.getTracking();
    }
}

function parse(text) {
    try {
        const data = JSON.parse(text);
        return data && typeof data === 'object' && 'nRetVal' in data ? data : null;
    } catch {
        return null;
    }
}

function webError(message) {
    const err = new Error(message);
    err.code = 'EWEB';
    return err;
}

function describe(err, base) {
    const code = err?.cause?.code || err?.code;
    if (err?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') return `The camera's web page at ${base} did not answer.`;
    if (code === 'ECONNREFUSED') return `The camera's web page at ${base} refused the connection.`;
    return `Could not reach the camera's web page at ${base}.`;
}
