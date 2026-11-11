// Records everything a camera's own web page sends and receives, so the
// settings that only exist on that page (tracking mode, headroom, zones) can
// be added to this app later. A stand-in for a Chrome HAR export, which also
// captures WebSocket messages and needs no browser tools.
//
// It opens the camera's page in a window with its own private session (no
// cookies kept), listens through Chromium's DevTools protocol, and when the
// window is closed hands back the recording.

import { BrowserWindow } from 'electron';

const MAX_BODY = 256 * 1024;
const TEXT_TYPES = /json|text|javascript|xml|html|x-www-form-urlencoded/i;

export function recordWebPage({ url, parent, title = 'Camera web page' }) {
    return new Promise((resolve) => {
        const win = new BrowserWindow({
            width: 1280,
            height: 860,
            parent,
            title: `Recording: ${title}. Use the page, then close this window.`,
            webPreferences: {
                partition: `camera-recorder-${Date.now()}`,
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false,
            },
        });
        win.removeMenu();
        // Keep our title so the operator knows it is recording.
        win.on('page-title-updated', (e) => e.preventDefault());

        const startedAt = Date.now();
        const entries = [];
        const requests = new Map(); // requestId -> entry
        const sockets = new Map(); // requestId -> entry
        const dbg = win.webContents.debugger;
        const at = () => Date.now() - startedAt;

        const onMessage = async (_event, method, params) => {
            try {
                switch (method) {
                    case 'Network.requestWillBeSent': {
                        const entry = {
                            type: 'http',
                            t: at(),
                            method: params.request.method,
                            url: params.request.url,
                            requestHeaders: params.request.headers,
                            postData: params.request.postData ?? null,
                        };
                        requests.set(params.requestId, entry);
                        entries.push(entry);
                        break;
                    }
                    case 'Network.responseReceived': {
                        const entry = requests.get(params.requestId);
                        if (entry) {
                            entry.status = params.response.status;
                            entry.mimeType = params.response.mimeType;
                            entry.responseHeaders = params.response.headers;
                        }
                        break;
                    }
                    case 'Network.loadingFinished': {
                        const entry = requests.get(params.requestId);
                        if (entry && TEXT_TYPES.test(entry.mimeType || '') && !/\.(js|css)(\?|$)/i.test(entry.url)) {
                            const body = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
                            const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
                            entry.responseBody = text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}... (cut)` : text;
                        }
                        break;
                    }
                    case 'Network.webSocketCreated': {
                        const entry = { type: 'websocket', t: at(), url: params.url, frames: [] };
                        sockets.set(params.requestId, entry);
                        entries.push(entry);
                        break;
                    }
                    case 'Network.webSocketFrameSent':
                    case 'Network.webSocketFrameReceived': {
                        const entry = sockets.get(params.requestId);
                        if (entry) {
                            entry.frames.push({
                                t: at(),
                                dir: method.endsWith('Sent') ? 'sent' : 'received',
                                opcode: params.response.opcode,
                                data: params.response.payloadData,
                            });
                        }
                        break;
                    }
                    case 'Network.webSocketClosed': {
                        const entry = sockets.get(params.requestId);
                        if (entry) entry.closedAt = at();
                        break;
                    }
                    default:
                }
            } catch {
                // A body that is gone or a frame we cannot read is not worth failing over.
            }
        };

        let attached = false;
        try {
            dbg.attach('1.3');
            attached = true;
            dbg.on('message', onMessage);
            dbg.sendCommand('Network.enable', { maxPostDataSize: MAX_BODY }).catch(() => {});
        } catch (err) {
            win.destroy();
            resolve({ ok: false, message: `Could not start recording: ${err.message}` });
            return;
        }

        win.on('closed', () => {
            resolve({
                ok: true,
                recording: {
                    kind: 'ptz-control-web-recording',
                    url,
                    startedAt: new Date(startedAt).toISOString(),
                    durationMs: at(),
                    entries,
                },
            });
        });
        win.on('close', () => {
            if (attached) {
                try { dbg.detach(); } catch {}
                attached = false;
            }
        });
        win.loadURL(url).catch(() => {
            // The page could not load; the window shows Chromium's error page,
            // and closing it still returns what was recorded.
        });
    });
}

export function countRecording(recording) {
    const http = recording.entries.filter((e) => e.type === 'http').length;
    const frames = recording.entries.filter((e) => e.type === 'websocket').reduce((n, e) => n + e.frames.length, 0);
    return { http, frames };
}
