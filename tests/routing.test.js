import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/main/store/settings.js';
import * as R from '../src/main/store/routing.js';

const base = () => S.defaultSettings();

test('screens: named outputs, each aux belongs to one screen', () => {
    let s = base();
    let out = R.saveScreen(s, { name: 'LED wall', aux: [0] });
    assert.ok(out.ok);
    s = out.settings;
    s = R.saveScreen(s, { name: 'Lobby TVs', aux: [3, 4], note: 'Converters 4 and 5' }).settings;
    assert.deepEqual(s.routing.screens.map((x) => [x.name, x.aux]), [['LED wall', [0]], ['Lobby TVs', [3, 4]]]);
    // Taking aux 4 for a new screen takes it away from the lobby.
    s = R.saveScreen(s, { name: 'Cry room', aux: [4] }).settings;
    assert.deepEqual(s.routing.screens.find((x) => x.name === 'Lobby TVs').aux, [3]);
    // Taking all of a screen's outputs forgets it.
    s = R.saveScreen(s, { name: 'Lobby again', aux: [3] }).settings;
    assert.equal(s.routing.screens.some((x) => x.name === 'Lobby TVs'), false);
    // Names must be given and different.
    assert.equal(R.saveScreen(s, { name: '', aux: [5] }).ok, false);
    assert.equal(R.saveScreen(s, { name: 'led WALL', aux: [5] }).ok, false);
    assert.equal(R.saveScreen(s, { name: 'Stage', aux: [] }).ok, false);
    // Edit keeps the id; forget removes it.
    const led = s.routing.screens[0];
    s = R.saveScreen(s, { id: led.id, name: 'LED wall', aux: [0, 1], operators: false }).settings;
    assert.equal(s.routing.screens[0].id, led.id);
    assert.equal(s.routing.screens[0].operators, false);
    s = R.removeScreen(s, led.id).settings;
    assert.equal(s.routing.screens.some((x) => x.id === led.id), false);
});

test('mix names', () => {
    let s = R.setMixName(base(), 1, 'Side screens').settings;
    assert.deepEqual(s.routing.mixNames, ['', 'Side screens']);
    s = R.setMixName(s, 1, '').settings;
    assert.deepEqual(s.routing.mixNames, []);
    assert.equal(R.mixLabel(['Live stream'], 0), 'Live stream (M/E 1)');
    assert.equal(R.sourceLabel(10011, { mixNames: ['Live stream'] }), 'Live stream (M/E 1) preview');
    assert.equal(R.sourceLabel(10020, {}), 'M/E 2');
    assert.equal(R.sourceLabel(3, { names: { 3: 'Graphics' } }), 'Graphics');
});

test('routing buttons: save what screens show now, lit while they match', () => {
    let s = R.saveScreen(base(), { name: 'LED wall', aux: [0] }).settings;
    s = R.saveScreen(s, { name: 'Lobby TVs', aux: [3, 4] }).settings;
    const [led, lobby] = s.routing.screens;
    const aux = [10010, 2, 2, 10020, 10020];
    const out = R.addRouteButton(s, { label: 'Stream everywhere', screenIds: [led.id, lobby.id] }, aux);
    assert.ok(out.ok);
    s = out.settings;
    const b = s.routing.buttons[0];
    assert.deepEqual(b.set, [{ aux: 0, source: 10010 }, { aux: 3, source: 10020 }, { aux: 4, source: 10020 }]);
    assert.equal(R.buttonActive(b, aux), true);
    assert.equal(R.buttonActive(b, [10010, 2, 2, 10020, 5]), false);
    assert.equal(R.screenShowing(lobby, [0, 0, 0, 10020, 5]), 'mixed');
    assert.equal(R.screenShowing(lobby, aux), 10020);
    // Same label replaces.
    s = R.addRouteButton(s, { label: 'stream everywhere', screenIds: [led.id] }, [7]).settings;
    assert.equal(s.routing.buttons.length, 1);
    assert.deepEqual(s.routing.buttons[0].set, [{ aux: 0, source: 7 }]);
    // Rename, order, remove.
    s = R.addRouteButton(s, { label: 'Lobby: graphics', screenIds: [lobby.id] }, [0, 0, 0, 4, 4]).settings;
    const second = s.routing.buttons[1];
    s = R.moveRouteButton(s, second.id, -1).settings;
    assert.equal(s.routing.buttons[0].id, second.id);
    assert.equal(R.renameRouteButton(s, second.id, 'stream EVERYWHERE').ok, false, 'labels stay different');
    s = R.renameRouteButton(s, second.id, 'Lobby: slides').settings;
    assert.equal(s.routing.buttons[0].label, 'Lobby: slides');
    s = R.removeRouteButton(s, second.id).settings;
    assert.equal(s.routing.buttons.length, 1);
    assert.equal(R.addRouteButton(s, { label: 'x', screenIds: [] }, aux).ok, false);
});

test('routing survives a save and reload, and bad entries are dropped', () => {
    const raw = {
        routing: {
            mixNames: ['Live stream', 5],
            screens: [{ name: 'A', aux: [0, 0, 'x'] }, { name: '', aux: [1] }, { name: 'B', aux: [0] }],
            buttons: [{ label: 'Go', set: [{ aux: 0, source: 3 }, { aux: -1, source: 3 }] }, { label: 'go', set: [{ aux: 1, source: 1 }] }, { label: 'Empty', set: [] }],
        },
    };
    const s = S.normalizeSettings(raw);
    assert.deepEqual(s.routing.mixNames, ['Live stream', '5']);
    assert.deepEqual(s.routing.screens.map((x) => [x.name, x.aux]), [['A', [0]]]);
    assert.deepEqual(s.routing.buttons.map((b) => [b.label, b.set]), [['Go', [{ aux: 0, source: 3 }]]]);
    assert.deepEqual(S.normalizeSettings({}).routing, R.defaultRouting());
});
