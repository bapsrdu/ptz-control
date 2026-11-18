// The ATEM as a full switcher, for Booth Video: program and preview, cut,
// auto, the T-bar, transition style and rate, upstream and downstream keys,
// fade to black, macros, aux outputs, streaming and recording.
//
// Universal PTZ Controller uses AtemLink on its own, which only touches the
// lower-thirds key and aux outputs. Booth Video switches, so it uses this.
//
// view() returns a plain snapshot of the switcher for the window. Every
// command is logged (newest last) for the Status page.

import { Enums } from 'atem-connection';
import { AtemLink } from './link.js';

const LOG_MAX = 200;

export class AtemSwitcher extends AtemLink {
    constructor(options) {
        super(options);
        this.log = [];
        this.tally = {}; // source -> { program, preview }, from the switcher's own tally
        this.tbarAtTop = {}; // me -> the T-bar rests at the top
        this.on('status', () => {
            if (this.connected && this.atem && !this.atem.__boothTally) {
                this.atem.__boothTally = true;
                this.atem.on?.('receivedCommands', (commands) => {
                    for (const c of commands) {
                        if (c?.constructor?.rawName === 'TlSr' && c.properties) {
                            this.tally = { ...c.properties };
                            this.emit('change');
                        }
                    }
                });
            }
        });
    }

    #record(command, detail, sent) {
        this.log.push({ time: Date.now(), command, detail, sent });
        if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    }

    // Runs one switcher command. name is for the log; detail says what it does in words.
    async #run(command, detail, fn) {
        if (!this.connected) {
            this.#record(command, detail, false);
            this.emit('log');
            return { ok: false, message: 'The switcher is not connected.' };
        }
        this.#record(command, detail, true);
        this.emit('log');
        try {
            await fn(this.atem);
            return { ok: true };
        } catch (err) {
            return { ok: false, message: `The switcher did not accept that: ${err?.message || err}` };
        }
    }

    #me(me) {
        const n = this.atem?.state?.info?.capabilities?.mixEffects ?? this.atem?.state?.video?.mixEffects?.length ?? 1;
        const i = Number(me) || 0;
        return Math.max(0, Math.min(n - 1, i));
    }

    // --- Commands. me, keyer, dsk, aux and macro are counted from 0. ---------

    cut(me) {
        me = this.#me(me);
        return this.#run('DCut', `Cut on M/E ${me + 1}`, (a) => a.cut(me));
    }

    auto(me) {
        me = this.#me(me);
        return this.#run('DAut', `Fade (auto) on M/E ${me + 1}`, (a) => a.autoTransition(me));
    }

    setPreview(input, me) {
        me = this.#me(me);
        return this.#run('CPvI', `Next on M/E ${me + 1}: ${this.name(input)}`, (a) => a.changePreviewInput(Number(input), me));
    }

    setProgram(input, me) {
        me = this.#me(me);
        return this.#run('CPgI', `Live on M/E ${me + 1}: ${this.name(input)}`, (a) => a.changeProgramInput(Number(input), me));
    }

    fadeToBlack(me) {
        me = this.#me(me);
        return this.#run('FtbA', `Fade to black on M/E ${me + 1}`, (a) => a.fadeToBlack(me));
    }

    // position: 0..1 of the lever's travel.
    setPosition(position, me) {
        me = this.#me(me);
        const p = Math.max(0, Math.min(1, Number(position) || 0));
        const run = this.#run('CTPs', `T-bar on M/E ${me + 1} to ${Math.round(p * 100)}%`, (a) => a.setTransitionPosition(Math.round(p * 10000), me));
        if (p >= 1) this.tbarAtTop[me] = !this.tbarAtTop[me];
        return run;
    }

    // style: 0 mix, 1 dip, 2 wipe, 3 DVE, 4 sting.
    setStyle(style, me) {
        me = this.#me(me);
        const names = ['mix', 'dip', 'wipe', 'DVE', 'sting'];
        return this.#run('CTTp', `Transition on M/E ${me + 1}: ${names[style] ?? style}`, (a) => a.setTransitionStyle({ nextStyle: Number(style) }, me));
    }

    // selection: bit 0 background, bit k+1 key k.
    setNextSelection(bits, me) {
        me = this.#me(me);
        const list = [];
        for (let i = 0; i < 5; i += 1) if (bits & (1 << i)) list.push(1 << i);
        if (!list.length) return Promise.resolve({ ok: false, message: 'The next transition has to take something.' });
        return this.#run('CTTp', `Next transition on M/E ${me + 1} takes ${describeSelection(bits)}`, (a) => a.setTransitionStyle({ nextSelection: list }, me));
    }

    // frames: 1..250.
    setMixRate(frames, me) {
        me = this.#me(me);
        const r = Math.max(1, Math.min(250, Math.round(Number(frames) || 30)));
        return this.#run('CTMx', `Mix rate on M/E ${me + 1}: ${r} frames`, (a) => a.setMixTransitionSettings({ rate: r }, me));
    }

    setKeyOnAir(keyer, on, me) {
        me = this.#me(me);
        return this.#run('CKOn', `M/E ${me + 1} Key ${keyer + 1} ${on ? 'on' : 'off'}`, (a) => a.setUpstreamKeyerOnAir(Boolean(on), me, Number(keyer)));
    }

    setDskOnAir(dsk, on) {
        return this.#run('CDsL', `DSK ${dsk + 1} ${on ? 'on' : 'off'} (cut)`, (a) => a.setDownstreamKeyOnAir(Boolean(on), Number(dsk)));
    }

    setDskTie(dsk, tie) {
        return this.#run('CDsT', `DSK ${dsk + 1} tie ${tie ? 'on' : 'off'}`, (a) => a.setDownstreamKeyTie(Boolean(tie), Number(dsk)));
    }

    dskAuto(dsk) {
        return this.#run('DDsA', `DSK ${dsk + 1} auto`, (a) => a.autoDownstreamKey(Number(dsk)));
    }

    runMacro(index) {
        return this.#run('MAct', `Run macro ${index + 1}`, (a) => a.macroRun(Number(index)));
    }

    stopMacro() {
        return this.#run('MAct', 'Stop the macro', (a) => a.macroStop());
    }

    setAuxSource(aux, source) {
        return this.#run('CAuS', `Aux ${aux + 1}: ${this.name(source)}`, (a) => a.setAuxSource(Number(source), Number(aux)));
    }

    setStreaming(on) {
        return this.#run('StrS', on ? 'Start streaming' : 'Stop streaming', (a) => (on ? a.startStreaming() : a.stopStreaming()));
    }

    setRecording(on) {
        return this.#run('RcTM', on ? 'Start recording' : 'Stop recording', (a) => (on ? a.startRecording() : a.stopRecording()));
    }

    name(input) {
        const i = this.atem?.state?.inputs?.[input];
        return i?.longName || `Input ${input}`;
    }

    // --- A plain snapshot for the window. ------------------------------------

    view() {
        const s = this.state;
        const base = { status: this.status, log: this.log.slice(-LOG_MAX) };
        if (!s) return { ...base, connected: false };
        const caps = s.info?.capabilities ?? {};
        const meCount = caps.mixEffects ?? s.video.mixEffects.length;
        const auxCount = caps.auxilliaries ?? s.video.auxilliaries.length;
        const dskCount = caps.downstreamKeyers ?? s.video.downstreamKeyers.length;
        const P = Enums.InternalPortType;
        const inputs = {};
        for (const i of Object.values(s.inputs ?? {})) {
            if (!i) continue;
            inputs[i.inputId] = {
                id: i.inputId,
                long: i.longName || `Input ${i.inputId}`,
                short: i.shortName || String(i.inputId),
                external: i.internalPortType === P.External,
                kind: i.internalPortType,
                availability: i.sourceAvailability,
                meAvailability: i.meAvailability,
            };
        }
        const ids = Object.keys(inputs).map(Number).sort((a, b) => a - b);
        // Sources a person would put on a bus: not aux outputs, M/E outputs or monitors.
        const busSources = ids.filter((id) => {
            const k = inputs[id].kind;
            return k !== P.Auxiliary && k !== P.MEOutput && k !== P.AudioMonitor && k !== P.Multiviewer
                && !(id >= 8000 && id < 9000) && !(id >= 10010 && id < 11000);
        });
        const auxSources = ids.filter((id) => {
            const i = inputs[id];
            if (i.kind === P.Auxiliary || i.kind === P.AudioMonitor) return false;
            if (i.availability !== undefined && !(i.availability & Enums.SourceAvailability.Auxiliary)) return false;
            return true;
        });
        const mes = [];
        for (let me = 0; me < meCount; me += 1) {
            const m = s.video.mixEffects[me];
            const keyCount = s.info?.mixEffects?.[me]?.keyCount ?? m?.upstreamKeyers?.length ?? 0;
            const sel = m?.transitionProperties?.nextSelection ?? [1];
            const bits = sel.reduce((a, b) => a | b, 0);
            const runSel = (m?.transitionProperties?.selection ?? sel).reduce((a, b) => a | b, 0);
            mes.push({
                program: m?.programInput ?? null,
                preview: m?.previewInput ?? null,
                inTransition: Boolean(m?.transitionPosition?.inTransition),
                position: (m?.transitionPosition?.handlePosition ?? 0) / 10000,
                style: m?.transitionProperties?.nextStyle ?? 0,
                runningStyle: m?.transitionProperties?.style ?? 0,
                nextSelection: bits,
                runningSelection: runSel,
                mixRate: m?.transitionSettings?.mix?.rate ?? 30,
                ftbBlack: Boolean(m?.fadeToBlack?.isFullyBlack),
                ftbInTransition: Boolean(m?.fadeToBlack?.inTransition),
                keys: Array.from({ length: keyCount }, (_, k) => {
                    const u = m?.upstreamKeyers?.[k];
                    return { onAir: Boolean(u?.onAir), fill: u?.fillSource ?? null, cut: u?.cutSource ?? null };
                }),
                tbarAtTop: Boolean(this.tbarAtTop[me]),
            });
        }
        const dsks = Array.from({ length: dskCount }, (_, d) => {
            const k = s.video.downstreamKeyers[d];
            return {
                onAir: Boolean(k?.onAir),
                tie: Boolean(k?.properties?.tie),
                inTransition: Boolean(k?.inTransition),
                fill: k?.sources?.fillSource ?? null,
                cut: k?.sources?.cutSource ?? null,
                rate: k?.properties?.rate ?? null,
            };
        });
        const macros = (s.macro?.macroProperties ?? [])
            .map((p, i) => (p?.isUsed ? { index: i, name: p.name || `Macro ${i + 1}` } : null))
            .filter(Boolean);
        const player = s.macro?.macroPlayer;
        const stream = s.streaming?.status?.state;
        const rec = s.recording?.status?.state;
        return {
            ...base,
            connected: true,
            product: s.info?.productIdentifier || 'ATEM',
            version: s.info?.apiVersion ? `${(s.info.apiVersion >> 16) & 0xffff}.${s.info.apiVersion & 0xffff}` : '',
            meCount,
            auxCount,
            dskCount,
            inputs,
            busSources,
            auxSources,
            mes,
            dsks,
            aux: Array.from({ length: auxCount }, (_, i) => (Number.isInteger(s.video.auxilliaries[i]) ? s.video.auxilliaries[i] : null)),
            macros,
            macroRunning: player?.isRunning ? player.macroIndex : null,
            hasStreaming: Boolean(s.streaming),
            streaming: stream === Enums.StreamingStatus.Streaming,
            streamConnecting: stream === Enums.StreamingStatus.Connecting,
            hasRecording: Boolean(s.recording),
            recording: rec === Enums.RecordingStatus.Recording,
            tally: this.tally,
        };
    }
}

export function describeSelection(bits) {
    const parts = [];
    if (bits & 1) parts.push('background');
    for (let k = 0; k < 4; k += 1) if (bits & (2 << k)) parts.push(`key ${k + 1}`);
    return parts.join(' and ') || 'nothing';
}
