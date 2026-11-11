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
        this.state = state;
        this.writes = [];
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

    cut(me, input) {
        this.state.video.mixEffects[me].programInput = input;
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

    async setUpstreamKeyerOnAir(onAir, me = 0, keyer = 0) {
        this.writes.push(['usk', me, keyer, onAir]);
        this.state.video.mixEffects[me].upstreamKeyers[keyer].onAir = onAir;
        this.#changed(`video.mixEffects.${me}.upstreamKeyers.${keyer}.onAir`);
    }
}
