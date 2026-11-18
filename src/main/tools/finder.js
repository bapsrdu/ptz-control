// Finds PTZ cameras and ATEM switchers on this computer's network, so nobody
// has to look up IP addresses. Nothing is changed on any device: each one is
// sent a harmless question, and whoever answers is listed.
//
// - Cameras: the VISCA "are you powered on?" inquiry, plain VISCA over UDP on
//   port 1259 (BZB and many others), Sony's VISCA over IP on UDP 52381, and
//   plain VISCA over TCP on port 5678.
// - ATEM switchers: the ATEM hello packet on UDP 9910. Every ATEM answers it.
//
// Every address on each local network (/24) is asked at once, so a scan takes
// about three seconds. Based on the device finder in Churchfront's CueVideo
// (Apache 2.0; see NOTICE), rewritten for VISCA cameras.

import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import http from 'node:http';
import { powerInquiry, parseReply } from '../visca/commands.js';
import { encodeSony, PAYLOAD, SONY_HEADER_LENGTH } from '../visca/framing.js';

export const PROBES = Object.freeze([
    { mode: 'udp-raw', port: 1259 },
    { mode: 'udp-sony', port: 52381 },
    { mode: 'tcp-raw', port: 5678 },
]);
export const ATEM_HELLO = Buffer.from([0x10, 0x14, 0x53, 0xab, 0, 0, 0, 0, 0, 0x3a, 0, 0, 0x01, 0, 0, 0, 0, 0, 0, 0]);
const TCP_CONCURRENCY = 64;

// The first three parts of each IPv4 network this computer is on, such as
// "192.168.1". Leaves out loopback and self-assigned (169.254) addresses.
export function localNetworks(interfaces = os.networkInterfaces()) {
    const nets = [];
    for (const list of Object.values(interfaces)) {
        for (const a of list ?? []) {
            const v4 = a.family === 'IPv4' || a.family === 4;
            if (!v4 || a.internal || a.address.startsWith('169.254.')) continue;
            const prefix = a.address.split('.').slice(0, 3).join('.');
            if (!nets.includes(prefix)) nets.push(prefix);
        }
    }
    return nets;
}

export function hostsIn(prefix) {
    return Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
}

function isAnswer(buf) {
    const reply = parseReply(buf);
    return reply.type === 'completion' && reply.data.length > 0;
}

// Sends one UDP message to every host and collects who answers.
function probeUdp(hosts, port, message, accept, waitMs) {
    return new Promise((resolve) => {
        const found = new Set();
        const socket = dgram.createSocket('udp4');
        socket.on('error', () => {});
        socket.on('message', (data, rinfo) => {
            if (accept(data)) found.add(rinfo.address);
        });
        socket.bind(0, () => {
            for (const host of hosts) socket.send(message, port, host, () => {});
        });
        setTimeout(() => {
            try { socket.close(); } catch {}
            resolve([...found]);
        }, waitMs);
    });
}

function probeTcpOne(host, port, message, waitMs) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port });
        let buf = Buffer.alloc(0);
        const finish = (ok) => {
            clearTimeout(timer);
            socket.destroy();
            resolve(ok);
        };
        const timer = setTimeout(() => finish(false), waitMs);
        socket.on('connect', () => socket.write(message));
        socket.on('data', (d) => {
            buf = Buffer.concat([buf, d]);
            let end;
            while ((end = buf.indexOf(0xff)) !== -1) {
                const one = buf.subarray(0, end + 1);
                buf = buf.subarray(end + 1);
                if (isAnswer(one)) return finish(true);
            }
        });
        socket.on('error', () => finish(false));
    });
}

async function probeTcp(hosts, port, message, waitMs) {
    const found = [];
    let next = 0;
    async function worker() {
        while (next < hosts.length) {
            const host = hosts[next];
            next += 1;
            if (await probeTcpOne(host, port, message, waitMs)) found.push(host);
        }
    }
    await Promise.all(Array.from({ length: Math.min(TCP_CONCURRENCY, hosts.length) }, worker));
    return found;
}

// The title of a device's web page, if it has one: often the make and model.
export function webTitle(host, { port = 80, timeoutMs = 1500 } = {}) {
    return new Promise((resolve) => {
        const req = http.get({ host, port, path: '/', timeout: timeoutMs }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => {
                body += c;
                if (body.length > 20000) res.destroy();
            });
            res.on('close', () => {
                const m = body.match(/<title[^>]*>([^<]{1,80})<\/title>/i);
                resolve(m ? m[1].trim() : null);
            });
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
    });
}

// Which camera model a found camera probably is.
export function guessProfile({ mode, port, title }) {
    if (/bzb|adamo/i.test(title ?? '')) return 'bzb-adamo';
    if (mode === 'udp-raw' && port === 1259) return 'bzb-adamo';
    return 'generic-visca';
}

// Scans the local networks (or the given hosts). Resolves to
//   { networks: ['192.168.1.0/24'], found: [{ kind: 'camera' | 'atem', host,
//     port, mode, profile, name }] }
// Cameras that answer more than one way are listed once, by the first way in
// PROBES (the one the app tries first when adding a camera).
export async function findDevices({
    hosts = null,
    networks = null,
    probes = PROBES,
    atemPort = 9910,
    waitMs = 2500,
    tcpWaitMs = 1200,
    titles = true,
} = {}) {
    const nets = networks ?? (hosts ? [] : localNetworks());
    const targets = hosts ?? nets.flatMap(hostsIn);
    if (!targets.length) return { networks: [], found: [] };

    const raw = powerInquiry(1);
    const sony = encodeSony(raw, { type: PAYLOAD.INQUIRY, seq: 1 });
    const results = await Promise.all([
        ...probes.map(async (p) => {
            let found;
            if (p.mode === 'udp-raw') found = await probeUdp(targets, p.port, raw, isAnswer, waitMs);
            else if (p.mode === 'udp-sony') {
                found = await probeUdp(targets, p.port, sony, (d) => d.length > SONY_HEADER_LENGTH && isAnswer(d.subarray(SONY_HEADER_LENGTH)), waitMs);
            } else if (p.mode === 'tcp-raw') found = await probeTcp(targets, p.port, raw, tcpWaitMs);
            else found = [];
            return found.map((host) => ({ kind: 'camera', host, port: p.port, mode: p.mode }));
        }),
        probeUdp(targets, atemPort, ATEM_HELLO, (d) => d.length >= 12 && (d[0] & 0xf8) !== 0, waitMs)
            .then((list) => list.map((host) => ({ kind: 'atem', host, port: atemPort, mode: null }))),
    ]);

    // One entry per camera host, by the first probe that found it.
    const cameras = new Map();
    for (const list of results.slice(0, probes.length)) {
        for (const f of list) if (!cameras.has(f.host)) cameras.set(f.host, f);
    }
    const atems = results.at(-1);
    const found = [...cameras.values()];
    if (titles) {
        await Promise.all(found.map(async (f) => { f.name = await webTitle(f.host); }));
    }
    for (const f of found) {
        f.profile = guessProfile(f);
        f.name = f.name || null;
    }
    const byHost = (a, b) => a.host.localeCompare(b.host, undefined, { numeric: true });
    return {
        networks: nets.map((n) => `${n}.0/24`),
        found: [...found.sort(byHost), ...atems.map((a) => ({ ...a, name: 'ATEM switcher' })).sort(byHost)],
    };
}
