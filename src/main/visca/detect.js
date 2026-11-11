// Works out which of the four VISCA-over-IP modes a camera speaks, by sending
// a harmless "are you powered on?" inquiry in each mode and seeing which one
// gets a proper answer back.
//
// A mode only counts when the reply is a real inquiry answer (y0 50 .. FF).
// A syntax error proves something is listening, but in a different mode.

import { Transport, MODES, MODE_LABELS } from './transport.js';
import { powerInquiry, parseReply } from './commands.js';

// Sony cameras use UDP with the header, so try that first. The rest follow in
// the order other PTZ makers most often use them.
export const DETECT_ORDER = Object.freeze(['udp-sony', 'udp-raw', 'tcp-raw', 'tcp-sony']);

export async function detectMode({ host, port, address = 1, timeoutMs = 800, modes = DETECT_ORDER }) {
    const attempts = [];
    let tcpConnectError = null;

    for (const mode of modes) {
        if (!MODES.includes(mode)) continue;
        // If TCP could not even connect, the second TCP mode will fail the same way.
        if (mode.startsWith('tcp') && tcpConnectError) {
            attempts.push({ mode, result: 'connect-failed', code: tcpConnectError.code });
            continue;
        }
        const attempt = await tryMode({ host, port, address, mode, timeoutMs });
        attempts.push(attempt);
        if (attempt.result === 'connect-failed' && mode.startsWith('tcp')) {
            tcpConnectError = attempt.error;
        }
        if (attempt.result === 'ok') {
            return {
                ok: true,
                mode,
                label: MODE_LABELS[mode],
                poweredOn: attempt.data?.[0] === 0x02,
                attempts: attempts.map(stripError),
                message: `Connected using ${MODE_LABELS[mode]}.`,
            };
        }
    }

    return {
        ok: false,
        mode: null,
        attempts: attempts.map(stripError),
        message: explainFailure({ host, port, attempts }),
    };
}

function stripError({ error: _error, ...rest }) {
    return rest;
}

async function tryMode({ host, port, address, mode, timeoutMs }) {
    const transport = new Transport({ host, port, mode, connectTimeoutMs: timeoutMs });
    try {
        await transport.open();
    } catch (error) {
        return { mode, result: 'connect-failed', code: error.code, error };
    }
    try {
        return await new Promise((resolve) => {
            let sawSomething = false;
            const timer = setTimeout(() => {
                resolve({ mode, result: sawSomething ? 'wrong-reply' : 'no-reply' });
            }, timeoutMs);
            transport.on('error', (error) => {
                if (error.code === 'ECONNREFUSED') {
                    clearTimeout(timer);
                    resolve({ mode, result: 'refused', code: error.code });
                }
            });
            transport.on('close', () => {
                clearTimeout(timer);
                resolve({ mode, result: sawSomething ? 'wrong-reply' : 'closed' });
            });
            transport.on('message', (payload) => {
                const reply = parseReply(payload);
                if (reply.type === 'completion' && reply.data.length > 0) {
                    clearTimeout(timer);
                    resolve({ mode, result: 'ok', data: [...reply.data] });
                } else {
                    sawSomething = true;
                }
            });
            transport.send(powerInquiry(address)).catch((error) => {
                clearTimeout(timer);
                resolve({ mode, result: 'send-failed', code: error.code, error });
            });
        });
    } finally {
        transport.close();
    }
}

function explainFailure({ host, port, attempts }) {
    const codes = attempts.map((a) => a.code).filter(Boolean);
    if (codes.includes('ENOTFOUND') || codes.includes('EAI_AGAIN')) {
        return `"${host}" is not a known address. Check for typing mistakes.`;
    }
    if (codes.some((c) => c === 'EHOSTUNREACH' || c === 'ENETUNREACH')) {
        return `This computer cannot reach ${host}. Check the address, and that this computer is on the same network as the camera.`;
    }
    if (attempts.some((a) => a.result === 'wrong-reply')) {
        return `Something answered at ${host} port ${port}, but it did not understand the camera commands. Check the port number, and that VISCA over IP is turned on in the camera's settings.`;
    }
    return `The camera did not answer at ${host} port ${port}. Check the address and port, that the camera is switched on, and that this computer is on the same network.`;
}
