import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAnnexB, toAnnexB, codecString, H264Depacketizer, nalType, NAL } from '../src/main/video/h264.js';
import { parseRtp, buildRtp } from '../src/main/video/rtp.js';
import { RtspClient, parseSdp, parseChallenge } from '../src/main/video/rtsp-client.js';
import { FakeRtspServer } from '../sim/fake-rtsp.js';

const sps = Buffer.from([0x67, 0x4d, 0x40, 0x1e, 0xaa]);
const pps = Buffer.from([0x68, 0xee, 0x3c]);
const idr = Buffer.from([0x65, 0x88, 0x84, 0x00, 0x11]);
const slice = Buffer.from([0x41, 0x9a, 0x22]);

test('Annex B split and join', () => {
    const stream = Buffer.concat([Buffer.from([0, 0, 0, 1]), sps, Buffer.from([0, 0, 1]), pps, Buffer.from([0, 0, 0, 1]), idr]);
    const nals = splitAnnexB(stream);
    assert.deepEqual(nals.map(nalType), [NAL.SPS, NAL.PPS, NAL.IDR]);
    assert.deepEqual(splitAnnexB(toAnnexB(nals)).map((n) => n.toString('hex')), nals.map((n) => n.toString('hex')));
    assert.equal(codecString(sps), 'avc1.4D401E');
});

test('RTP header round trip', () => {
    const p = parseRtp(buildRtp({ payload: Buffer.from([1, 2, 3]), seq: 65535, timestamp: 4000000000, marker: true }));
    assert.equal(p.seq, 65535);
    assert.equal(p.timestamp, 4000000000);
    assert.equal(p.marker, true);
    assert.deepEqual([...p.payload], [1, 2, 3]);
    assert.equal(parseRtp(Buffer.from([0, 1, 2])), null);
});

function stapA(...nals) {
    const parts = [Buffer.from([24])];
    for (const n of nals) {
        const len = Buffer.alloc(2);
        len.writeUInt16BE(n.length);
        parts.push(len, n);
    }
    return Buffer.concat(parts);
}

function fuA(nal, size) {
    const out = [];
    for (let i = 1; i < nal.length; i += size) {
        const s = i === 1 ? 0x80 : 0;
        const e = i + size >= nal.length ? 0x40 : 0;
        out.push(Buffer.concat([Buffer.from([(nal[0] & 0xe0) | 28, s | e | (nal[0] & 0x1f)]), nal.subarray(i, i + size)]));
    }
    return out;
}

test('depacketizer rebuilds STAP-A and FU-A frames', () => {
    const d = new H264Depacketizer();
    let seq = 0;
    const push = (payload, ts, marker) => d.push(payload, { seq: seq++, timestamp: ts, marker });
    assert.deepEqual(push(stapA(sps, pps), 100, false), []);
    const parts = fuA(idr, 2);
    const frames = parts.flatMap((p, i) => push(p, 100, i === parts.length - 1));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].key, true);
    assert.deepEqual(frames[0].nals.map((n) => n.toString('hex')), [sps, pps, idr].map((n) => n.toString('hex')));
    const next = push(slice, 200, true);
    assert.equal(next[0].key, false);
});

test('depacketizer waits for a key frame after a lost packet', () => {
    const d = new H264Depacketizer({ sps, pps });
    assert.equal(d.push(slice, { seq: 1, timestamp: 1, marker: true }).length, 0, 'no key frame yet');
    const key = d.push(idr, { seq: 2, timestamp: 2, marker: true });
    assert.equal(key[0].key, true);
    assert.equal(key[0].nals.length, 3, 'SPS and PPS from the SDP are added to the key frame');
    assert.equal(d.push(slice, { seq: 3, timestamp: 3, marker: true }).length, 1);
    assert.equal(d.push(slice, { seq: 5, timestamp: 4, marker: true }).length, 0, 'gap in sequence numbers');
    assert.equal(d.push(slice, { seq: 6, timestamp: 5, marker: true }).length, 0, 'still waiting for a key frame');
    assert.equal(d.push(idr, { seq: 7, timestamp: 6, marker: true }).length, 1);
});

test('SDP and login challenge parsing', () => {
    const track = parseSdp([
        'v=0', 'm=audio 0 RTP/AVP 97', 'a=control:trackID=2',
        'm=video 0 RTP/AVP 96', 'a=rtpmap:96 H264/90000',
        `a=fmtp:96 packetization-mode=1;sprop-parameter-sets=${sps.toString('base64')},${pps.toString('base64')}`,
        'a=control:trackID=1',
    ].join('\r\n'));
    assert.equal(track.encoding, 'H264');
    assert.equal(track.control, 'trackID=1');
    assert.deepEqual([...track.sps], [...sps]);
    assert.equal(parseSdp('m=video 0 RTP/AVP 96\r\na=rtpmap:96 H265/90000').encoding, 'H.265');
    assert.deepEqual(parseChallenge('Digest realm="cam", nonce="n1", qop="auth,auth-int"'), {
        scheme: 'digest', realm: 'cam', nonce: 'n1', opaque: undefined, qop: 'auth',
    });
    assert.equal(parseChallenge('Basic realm="x"').scheme, 'basic');
});

function play(url) {
    return new Promise((resolve) => {
        const client = new RtspClient(url, { timeoutMs: 1000 });
        const frames = [];
        client.on('frame', (f) => {
            frames.push(f);
            if (frames.length === 30) {
                client.stop();
                resolve({ frames });
            }
        });
        client.on('error', (error) => resolve({ error, frames }));
        client.start();
    });
}

test('plays the fake camera stream', async (t) => {
    const server = await new FakeRtspServer().start();
    t.after(() => server.stop());
    const { frames, error } = await play(server.url);
    assert.equal(error, undefined, error?.message);
    assert.equal(frames[0].key, true, 'starts on a key frame');
    assert.match(frames[0].codec, /^avc1\.4D40/);
    assert.ok(frames.filter((f) => f.key).length >= 1);
    // Every frame is complete Annex B with exactly one picture.
    for (const f of frames) {
        const pictures = splitAnnexB(f.data).filter((n) => [1, 5].includes(nalType(n)));
        assert.equal(pictures.length, 1);
    }
});

test('logs in with Digest when the camera asks', async (t) => {
    const server = await new FakeRtspServer({ auth: { username: 'admin', password: 'p@ss' } }).start();
    t.after(() => server.stop());
    const withLogin = await play(`rtsp://admin:p%40ss@127.0.0.1:${server.port}/live/av1`);
    assert.equal(withLogin.error, undefined, withLogin.error?.message);
    const noLogin = await play(server.url);
    assert.match(noLogin.error.userMessage, /asks for a login/);
    const wrong = await play(`rtsp://admin:nope@127.0.0.1:${server.port}/live/av1`);
    assert.match(wrong.error.userMessage, /did not accept the video username or password/);
});

test('plain-words errors for wrong path, H.265 and nothing listening', async (t) => {
    const server = await new FakeRtspServer().start();
    const h265 = await new FakeRtspServer({ encoding: 'H265' }).start();
    t.after(async () => { await server.stop(); await h265.stop(); });
    assert.match((await play(`rtsp://127.0.0.1:${server.port}/live/av9`)).error.userMessage, /no video stream at this address/);
    assert.match((await play(h265.url)).error.userMessage, /sends H\.265/);
    const port = server.port;
    await server.stop();
    assert.match((await play(`rtsp://127.0.0.1:${port}/live/av1`)).error.userMessage, /refused the video connection/);
});
