// A pretend ATEM for the app tests. It has the same methods and events the app
// uses from atem-connection's Atem class, plus helpers to cut and route.
//
// Start the app with PTZ_FAKE_ATEM=1 and it uses this instead of a real
// switcher. The instance is on globalThis.ptzFakeAtem in the main process.

import { EventEmitter } from 'node:events';
import { AtemStateUtil, Enums } from 'atem-connection';

export class FakeAtem extends EventEmitter {
    constructor({ meCount = 2, inputCount = 20, auxCount = 12, dskCount = 2 } = {}) {
        super();
        const state = AtemStateUtil.Create();
        state.info.productIdentifier = 'Fake ATEM 2 M/E';
        state.info.capabilities = { mixEffects: meCount, auxilliaries: auxCount, downstreamKeyers: dskCount, superSources: 1 };
        for (let id = 1; id <= inputCount; id += 1) {
            state.inputs[id] = { inputId: id, longName: `Input ${id}`, shortName: `IN${id}`, internalPortType: Enums.InternalPortType.External };
        }
        for (let me = 0; me < meCount; me += 1) {
            for (const id of [10010 + me * 10, 10011 + me * 10]) {
                state.inputs[id] = { inputId: id, longName: `ME ${me + 1}`, shortName: `ME${me + 1}`, internalPortType: Enums.InternalPortType.MEOutput };
            }
            const m = AtemStateUtil.getMixEffect(state, me);
            m.programInput = 1;
            m.previewInput = 2;
            m.transitionProperties.selection = [Enums.TransitionSelection.Background];
            state.info.mixEffects[me] = { keyCount: 4 };
            for (let k = 0; k < 4; k += 1) {
                const usk = AtemStateUtil.getUpstreamKeyer(m, k);
                usk.onAir = false;
                usk.fillSource = 0;
            }
        }
        for (let i = 0; i < auxCount; i += 1) {
            state.video.auxilliaries[i] = 10010;
            state.inputs[8001 + i] = { inputId: 8001 + i, longName: `Output ${i + 1}`, shortName: `AUX${i + 1}`, internalPortType: Enums.InternalPortType.Auxiliary };
        }
        for (let d = 0; d < dskCount; d += 1) {
            const dsk = AtemStateUtil.getDownstreamKeyer(state, d);
            dsk.onAir = false;
            dsk.inTransition = false;
            dsk.sources = { fillSource: 15, cutSource: 15 };
        }
        state.macro.macroProperties = [
            { isUsed: true, hasUnsupportedOps: false, name: 'Walk-in', description: '' },
            { isUsed: true, hasUnsupportedOps: false, name: 'Sermon', description: '' },
        ];
        state.macro.macroPlayer = { isRunning: false, isWaiting: false, loop: false, macroIndex: 0 };
        state.streaming = { status: { state: Enums.StreamingStatus.Idle, error: 0 }, service: { serviceName: '', url: '', key: '', bitrates: [0, 0] } };
        state.recording = { status: { state: Enums.RecordingStatus.Idle, error: 0 }, properties: { filename: '', workingSet1DiskId: 0, workingSet2DiskId: 0, recordInAllCameras: false }, disks: {} };
        for (let me = 0; me < meCount; me += 1) {
            const m = state.video.mixEffects[me];
            m.transitionProperties.style = 0;
            m.transitionProperties.nextStyle = 0;
            m.transitionProperties.nextSelection = [Enums.TransitionSelection.Background];
            m.transitionSettings.mix = { rate: 30 };
            m.transitionPosition = { inTransition: false, remainingFrames: 0, handlePosition: 0 };
            m.fadeToBlack = { isFullyBlack: false, inTransition: false, remainingFrames: 0, rate: 25 };
        }
        this.state = state;
        this.writes = [];
        this.autoMs = 400; // how long a pretend fade takes
    }

    async connect() {
        setTimeout(() => this.emit('connected'), 20);
    }

    async disconnect() {}

    async destroy() {}

    #changed(path) {
        this.emit('stateChanged', this.state, [path]);
    }

    // --- Test helpers -------------------------------------------------------

    nameInput(id, name) {
        this.state.inputs[id].longName = name;
        this.#changed(`inputs.${id}`);
    }

    // cut(me, input) puts input on program (a test helper); cut(me) is the
    // switcher's own Cut: program and preview swap.
    async cut(me = 0, input) {
        const m = this.state.video.mixEffects[me];
        if (input !== undefined) {
            m.programInput = input;
        } else {
            this.writes.push(['cut', me]);
            [m.programInput, m.previewInput] = [m.previewInput, m.programInput];
        }
        this.#changed(`video.mixEffects.${me}.programInput`);
    }

    preview(me, input) {
        this.state.video.mixEffects[me].previewInput = input;
        this.#changed(`video.mixEffects.${me}.previewInput`);
    }

    route(aux, source) {
        this.state.video.auxilliaries[aux] = source;
        this.#changed(`video.auxilliaries.${aux}`);
    }

    // --- Writes the app may make --------------------------------------------

    async setDownstreamKeyOnAir(onAir, key = 0) {
        this.writes.push(['dsk', key, onAir]);
        this.state.video.downstreamKeyers[key].onAir = onAir;
        this.#changed(`video.downstreamKeyers.${key}.onAir`);
    }

    async setAuxSource(source, bus = 0) {
        this.writes.push(['aux', bus, source]);
        this.state.video.auxilliaries[bus] = source;
        this.#changed(`video.auxilliaries.${bus}`);
    }

    async changePreviewInput(input, me = 0) {
        this.writes.push(['preview', me, input]);
        this.state.video.mixEffects[me].previewInput = input;
        this.#changed(`video.mixEffects.${me}.previewInput`);
    }

    async changeProgramInput(input, me = 0) {
        this.writes.push(['program', me, input]);
        this.state.video.mixEffects[me].programInput = input;
        this.#changed(`video.mixEffects.${me}.programInput`);
    }

    async autoTransition(me = 0) {
        this.writes.push(['auto', me]);
        const m = this.state.video.mixEffects[me];
        if (m.transitionPosition.inTransition) return;
        m.transitionPosition = { inTransition: true, remainingFrames: 30, handlePosition: 0 };
        this.#changed(`video.mixEffects.${me}.transitionPosition`);
        const start = Date.now();
        const tick = setInterval(() => {
            const f = Math.min(1, (Date.now() - start) / this.autoMs);
            m.transitionPosition = { inTransition: f < 1, remainingFrames: Math.round((1 - f) * 30), handlePosition: f < 1 ? Math.round(f * 10000) : 0 };
            if (f >= 1) {
                clearInterval(tick);
                [m.programInput, m.previewInput] = [m.previewInput, m.programInput];
            }
            this.#changed(`video.mixEffects.${me}.transitionPosition`);
        }, 40);
    }

    async setTransitionPosition(position, me = 0) {
        this.writes.push(['position', me, position]);
        const m = this.state.video.mixEffects[me];
        if (position >= 10000) {
            [m.programInput, m.previewInput] = [m.previewInput, m.programInput];
            m.transitionPosition = { inTransition: false, remainingFrames: 0, handlePosition: 0 };
        } else {
            m.transitionPosition = { inTransition: position > 0, remainingFrames: 0, handlePosition: position };
        }
        this.#changed(`video.mixEffects.${me}.transitionPosition`);
    }

    async setTransitionStyle(props, me = 0) {
        this.writes.push(['style', me, props]);
        const t = this.state.video.mixEffects[me].transitionProperties;
        if (props.nextStyle !== undefined) { t.nextStyle = props.nextStyle; t.style = props.nextStyle; }
        if (props.nextSelection) { t.nextSelection = props.nextSelection; t.selection = props.nextSelection; }
        this.#changed(`video.mixEffects.${me}.transitionProperties`);
    }

    async setMixTransitionSettings(props, me = 0) {
        this.writes.push(['mixRate', me, props.rate]);
        this.state.video.mixEffects[me].transitionSettings.mix = { rate: props.rate };
        this.#changed(`video.mixEffects.${me}.transitionSettings.mix`);
    }

    async fadeToBlack(me = 0) {
        this.writes.push(['ftb', me]);
        const f = this.state.video.mixEffects[me].fadeToBlack;
        f.isFullyBlack = !f.isFullyBlack;
        this.#changed(`video.mixEffects.${me}.fadeToBlack`);
    }

    async setDownstreamKeyTie(tie, key = 0) {
        this.writes.push(['dskTie', key, tie]);
        const d = this.state.video.downstreamKeyers[key];
        d.properties = { ...(d.properties ?? {}), tie };
        this.#changed(`video.downstreamKeyers.${key}.properties`);
    }

    async autoDownstreamKey(key = 0) {
        this.writes.push(['dskAuto', key]);
        const d = this.state.video.downstreamKeyers[key];
        d.onAir = !d.onAir;
        this.#changed(`video.downstreamKeyers.${key}.onAir`);
    }

    async macroRun(index = 0) {
        this.writes.push(['macro', index]);
        this.state.macro.macroPlayer = { isRunning: true, isWaiting: false, loop: false, macroIndex: index };
        this.#changed('macro.macroPlayer');
        setTimeout(() => {
            this.state.macro.macroPlayer = { isRunning: false, isWaiting: false, loop: false, macroIndex: index };
            this.#changed('macro.macroPlayer');
        }, 300);
    }

    async macroStop() {
        this.writes.push(['macroStop']);
        this.state.macro.macroPlayer = { ...this.state.macro.macroPlayer, isRunning: false };
        this.#changed('macro.macroPlayer');
    }

    async startStreaming() {
        this.writes.push(['stream', true]);
        this.state.streaming.status = { state: Enums.StreamingStatus.Streaming, error: 0 };
        this.#changed('streaming.status');
    }

    async stopStreaming() {
        this.writes.push(['stream', false]);
        this.state.streaming.status = { state: Enums.StreamingStatus.Idle, error: 0 };
        this.#changed('streaming.status');
    }

    async startRecording() {
        this.writes.push(['record', true]);
        this.state.recording.status = { state: Enums.RecordingStatus.Recording, error: 0 };
        this.#changed('recording.status');
    }

    async stopRecording() {
        this.writes.push(['record', false]);
        this.state.recording.status = { state: Enums.RecordingStatus.Idle, error: 0 };
        this.#changed('recording.status');
    }

    async setUpstreamKeyerOnAir(onAir, me = 0, keyer = 0) {
        this.writes.push(['usk', me, keyer, onAir]);
        this.state.video.mixEffects[me].upstreamKeyers[keyer].onAir = onAir;
        this.#changed(`video.mixEffects.${me}.upstreamKeyers.${keyer}.onAir`);
    }
}
