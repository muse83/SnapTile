import test from 'node:test';
import assert from 'node:assert/strict';

import {TILES, tileRect} from '../../src/tileDecision.js';
import {MAX_APPLICATIONS, appKeyOf, parsePlaces, placementFor, rememberFree, rememberOnClose, rememberWindow, serialisePlaces} from '../../src/rememberedPlaces.js';

const FRAME = {x: 100, y: 120, width: 800, height: 600};
const WORK = {x: 0, y: 32, width: 1920, height: 1048};

// What the shell knows about an ordinary application window.
const WINDOW = {
    normal: true, hasParent: false, attachedDialog: false, canMove: true, canResize: true,
    fullscreen: false, appId: 'org.example.Editor', wmClass: 'org.example.Editor',
    gtkWindowPath: '/org/example/Editor/window/1',
};

// --- reading the stored text ---

test('valid stored places are read back', () => {
    const text = JSON.stringify({'org.example.Editor': {frame: FRAME}, firefox: {frame: FRAME}});
    assert.deepEqual(parsePlaces(text), {'org.example.Editor': {frame: FRAME}, firefox: {frame: FRAME}});
});

test('unreadable stored data reads as nothing remembered', () => {
    for (const text of ['', 'not json', '[1,2]', 'null', '5', '"text"'])
        assert.deepEqual(parsePlaces(text), {}, `for ${JSON.stringify(text)}`);
});

test('corrupt entries are dropped and good ones kept', () => {
    const text = JSON.stringify({
        good: {frame: FRAME},
        zeroSize: {frame: {...FRAME, width: 0}},
        negativeSize: {frame: {...FRAME, height: -5}},
        textCoordinate: {frame: {...FRAME, x: 'left'}},
        noFrame: {},
        notAnObject: 5,
        nothing: null,
    });
    assert.deepEqual(parsePlaces(text), {good: {frame: FRAME}});
});

test('what is stored reads back as the same places', () => {
    const places = {a: {frame: FRAME}, b: {frame: {...FRAME, x: 0}}};
    assert.deepEqual(parsePlaces(serialisePlaces(places)), places);
});

// --- remembering a free window ---

test('a closed free window is remembered by its frame, per application', () => {
    const places = rememberFree({}, 'org.example.Editor', FRAME);
    assert.deepEqual(places, {'org.example.Editor': {frame: FRAME}});
});

test('remembering again replaces the place and makes the application the most recent', () => {
    const first = rememberFree(rememberFree({}, 'a', FRAME), 'b', FRAME);
    const again = rememberFree(first, 'a', {...FRAME, x: 5});
    assert.deepEqual(Object.keys(again), ['b', 'a']);
    assert.equal(again.a.frame.x, 5);
});

test('remembering does not change the places it was given, nor keep the frame object', () => {
    const before = {a: {frame: FRAME}};
    const frame = {...FRAME};
    const after = rememberFree(before, 'b', frame);
    frame.x = 999;
    assert.deepEqual(before, {a: {frame: FRAME}});
    assert.equal(after.b.frame.x, FRAME.x);
});

test('a window that closed before it ever had a size is not remembered', () => {
    const before = {a: {frame: FRAME}};
    assert.deepEqual(rememberFree(before, 'b', {x: 0, y: 0, width: 0, height: 0}), before);
    assert.deepEqual(rememberFree(before, 'a', {x: 0, y: 0, width: 0, height: 0}), before);
});

// --- last action wins ---

test('closing a window that was moved last remembers its frame', () => {
    const before = {a: {frame: FRAME}};
    const moved = {...FRAME, x: 5};
    assert.deepEqual(rememberOnClose(before, 'a', {frame: moved}, 3, [1, 2]), {a: {frame: moved}});
});

test('closing a window does not overwrite a younger save of another window of the application', () => {
    const before = {a: {frame: FRAME}};
    assert.equal(rememberOnClose(before, 'a', {frame: {...FRAME, x: 5}}, 2, [1, 7]), before);
});

test('a window never saved is older than a window that was', () => {
    const before = {a: {frame: FRAME}};
    assert.equal(rememberOnClose(before, 'a', {frame: {...FRAME, x: 5}}, 0, [4]), before);
});

test('when no window of the application was saved, the closing one is the last action', () => {
    const closed = {...FRAME, x: 5};
    assert.deepEqual(rememberOnClose({}, 'a', {frame: closed}, 0, [0, 0]), {a: {frame: closed}});
    assert.deepEqual(rememberOnClose({}, 'a', {frame: closed}, 0, []), {a: {frame: closed}});
});

// --- how many applications are kept ---

const manyApplications = count => {
    let places = {};
    for (let i = 0; i < count; i++)
        places = rememberFree(places, `app.n${i}`, {...FRAME, x: i});
    return places;
};

test('at most 200 applications are kept', () => {
    assert.equal(MAX_APPLICATIONS, 200);
    assert.equal(Object.keys(manyApplications(200)).length, 200);
    assert.equal(Object.keys(manyApplications(250)).length, 200);
});

test('the least recently used applications are dropped first', () => {
    const places = manyApplications(250);
    const keys = Object.keys(places);
    assert.equal(keys[0], 'app.n50');
    assert.equal(keys[199], 'app.n249');
    assert.equal(places['app.n49'], undefined);
});

test('using an old application again saves it from being dropped', () => {
    let places = manyApplications(200);
    places = rememberFree(places, 'app.n0', FRAME); // the oldest is used again
    places = rememberFree(places, 'app.new', FRAME); // one too many: n1 is now the oldest
    assert.ok(places['app.n0']);
    assert.equal(places['app.n1'], undefined);
    assert.equal(Object.keys(places).length, 200);
});

test('stored data with more than 200 applications is cut to the 200 most recent when read', () => {
    const stored = serialisePlaces(manyApplications(200));
    const text = JSON.stringify({old: {frame: FRAME}, ...JSON.parse(stored)});
    const places = parsePlaces(text);
    assert.equal(Object.keys(places).length, 200);
    assert.equal(places.old, undefined);
});

// --- where a new window goes ---

const rectFor = (places, key, workAreas) => placementFor(places, key, workAreas)?.rect ?? null;

test('an application with nothing remembered gets no place (it keeps its own)', () => {
    assert.equal(placementFor({}, 'org.example.Editor', [WORK]), null);
    assert.equal(placementFor({other: {frame: FRAME}}, 'org.example.Editor', [WORK]), null);
});

test('a remembered free window goes to its frame', () => {
    assert.deepEqual(placementFor({a: {frame: FRAME}}, 'a', [WORK]), {kind: 'free', rect: FRAME});
});

test('a frame reaching out of the work area is moved back inside', () => {
    const out = {x: 1500, y: 800, width: 800, height: 600};
    assert.deepEqual(rectFor({a: {frame: out}}, 'a', [WORK]), {x: 1120, y: 480, width: 800, height: 600});
    const above = {x: -50, y: 0, width: 800, height: 600};
    assert.deepEqual(rectFor({a: {frame: above}}, 'a', [WORK]), {x: 0, y: 32, width: 800, height: 600});
});

test('a frame larger than the work area is shrunk to it', () => {
    const big = {x: 0, y: 0, width: 3000, height: 2000};
    assert.deepEqual(rectFor({a: {frame: big}}, 'a', [WORK]), WORK);
});

test('with several monitors the frame goes onto the work area nearest to its centre', () => {
    const second = {x: 1920, y: 0, width: 1280, height: 1024};
    const onSecond = {x: 2000, y: 100, width: 600, height: 400};
    assert.deepEqual(rectFor({a: {frame: onSecond}}, 'a', [WORK, second]), onSecond);

    const gone = {x: 5000, y: 300, width: 600, height: 400}; // right of everything
    assert.deepEqual(rectFor({a: {frame: gone}}, 'a', [WORK, second]), {x: 2600, y: 300, width: 600, height: 400});
});

test('without any monitor the frame is returned unchanged', () => {
    assert.deepEqual(rectFor({a: {frame: FRAME}}, 'a', []), FRAME);
});

// --- tiled and maximised windows: remembering ---

const LEFT_TILE = {x: 0, y: 32, width: 960, height: 1048}; // the left half of WORK
const SIZE_BEFORE = {width: 700, height: 500};

test('a tiled window is remembered by its Tile, the Tile rectangle and its earlier size', () => {
    const places = rememberWindow({}, 'a', {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE});
    assert.deepEqual(places, {a: {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE}});
});

test('a tiled window that never had a free size is remembered without one', () => {
    for (const sizeBefore of [null, undefined]) {
        const places = rememberWindow({}, 'a', {frame: LEFT_TILE, tile: 'left', sizeBefore});
        assert.deepEqual(places, {a: {frame: LEFT_TILE, tile: 'left'}});
    }
});

test('a size is never invented for a tiled window from what was stored before', () => {
    const before = {a: {frame: FRAME}};
    const places = rememberWindow(before, 'a', {frame: LEFT_TILE, tile: 'left', sizeBefore: null});
    assert.deepEqual(places, {a: {frame: LEFT_TILE, tile: 'left'}});
});

test('a window maximised with the window button is remembered by the flag', () => {
    const places = rememberWindow({}, 'a', {frame: WORK, maximized: true});
    assert.deepEqual(places, {a: {frame: WORK, maximized: true}});
});

test('a maximised window keeps the free size the application had, so it is not lost', () => {
    const fromFree = rememberWindow({a: {frame: FRAME}}, 'a', {frame: WORK, maximized: true});
    assert.deepEqual(fromFree.a.sizeBefore, {width: FRAME.width, height: FRAME.height});

    const fromTiled = rememberWindow(
        {a: {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE}}, 'a', {frame: WORK, maximized: true});
    assert.deepEqual(fromTiled.a.sizeBefore, SIZE_BEFORE);

    const again = rememberWindow(fromFree, 'a', {frame: WORK, maximized: true});
    assert.deepEqual(again.a.sizeBefore, {width: FRAME.width, height: FRAME.height});
});

test('a maximised window\'s own earlier size wins over the stored one', () => {
    const places = rememberWindow(
        {a: {frame: FRAME}}, 'a', {frame: WORK, maximized: true, sizeBefore: SIZE_BEFORE});
    assert.deepEqual(places.a.sizeBefore, SIZE_BEFORE);
});

test('a maximised window with no known free size is remembered with the flag only', () => {
    assert.deepEqual(rememberWindow({}, 'a', {frame: WORK, maximized: true}).a, {frame: WORK, maximized: true});
    const fromTiledWithoutSize = {a: {frame: LEFT_TILE, tile: 'left'}};
    assert.deepEqual(
        rememberWindow(fromTiledWithoutSize, 'a', {frame: WORK, maximized: true}).a, {frame: WORK, maximized: true});
});

test('a free window after a tiled one leaves nothing of the Tile behind', () => {
    const before = {a: {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE}};
    assert.deepEqual(rememberFree(before, 'a', FRAME), {a: {frame: FRAME}});
    const maximised = {a: {frame: WORK, maximized: true}};
    assert.deepEqual(rememberFree(maximised, 'a', FRAME), {a: {frame: FRAME}});
});

test('a closing tiled window follows the same last-action rule as a free one', () => {
    const before = {a: {frame: FRAME}};
    const tiled = {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE};
    assert.deepEqual(rememberOnClose(before, 'a', tiled, 3, [1]), {a: {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE}});
    assert.equal(rememberOnClose(before, 'a', tiled, 1, [3]), before);
});

test('remembering a tiled window does not change the places it was given, nor keep its objects', () => {
    const before = {a: {frame: FRAME}};
    const state = {frame: {...LEFT_TILE}, tile: 'left', sizeBefore: {...SIZE_BEFORE}};
    const after = rememberWindow(before, 'b', state);
    state.frame.x = 99;
    state.sizeBefore.width = 99;
    assert.deepEqual(before, {a: {frame: FRAME}});
    assert.deepEqual(after.b, {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE});
});

test('a tiled or maximised window without a size is ignored, like a free one', () => {
    const before = {a: {frame: FRAME}};
    assert.equal(rememberWindow(before, 'b', {frame: {x: 0, y: 0, width: 0, height: 0}, tile: 'left'}), before);
    assert.equal(rememberWindow(before, 'b', {frame: {x: 0, y: 0, width: 0, height: 0}, maximized: true}), before);
});

test('a name that is no Tile is not remembered as one', () => {
    const before = {a: {frame: FRAME}};
    assert.equal(rememberWindow(before, 'b', {frame: LEFT_TILE, tile: 'middle'}), before);
});

// --- tiled and maximised windows: stored text ---

test('tiled and maximised places read back as they were stored', () => {
    const places = {
        t: {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE},
        u: {frame: LEFT_TILE, tile: 'two-thirds-right'},
        m: {frame: WORK, maximized: true, sizeBefore: SIZE_BEFORE},
        n: {frame: WORK, maximized: true},
        f: {frame: FRAME},
    };
    assert.deepEqual(parsePlaces(serialisePlaces(places)), places);
});

test('entries of the earlier version, with a frame only, still read as free windows', () => {
    assert.deepEqual(parsePlaces('{"a": {"frame": {"x": 1, "y": 2, "width": 3, "height": 4}}}'),
        {a: {frame: {x: 1, y: 2, width: 3, height: 4}}});
});

test('a corrupt tile, size or flag drops that entry and keeps the good ones', () => {
    const good = {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE};
    const text = JSON.stringify({
        good,
        noSuchTile: {frame: LEFT_TILE, tile: 'middle'},
        tileNotText: {frame: LEFT_TILE, tile: 5},
        zeroSize: {frame: LEFT_TILE, tile: 'left', sizeBefore: {width: 0, height: 10}},
        textSize: {frame: LEFT_TILE, tile: 'left', sizeBefore: {width: 'wide', height: 10}},
        sizeNotObject: {frame: LEFT_TILE, tile: 'left', sizeBefore: 7},
        flagNotTrue: {frame: WORK, maximized: 'yes'},
        flagFalse: {frame: WORK, maximized: false},
        tiledAndMaximised: {frame: WORK, tile: 'full', maximized: true},
    });
    assert.deepEqual(parsePlaces(text), {good});
});

test('the Tile, its size and the flag are copies of what was read', () => {
    const parsed = parsePlaces(JSON.stringify({a: {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE, extra: 1}}));
    assert.deepEqual(parsed, {a: {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE}});
});

// --- tiled and maximised windows: where a new window goes ---

const SECOND = {x: 1920, y: 0, width: 1280, height: 1024};

test('a remembered Tile goes to the same Tile of the work area, with the earlier size to give back', () => {
    const places = {a: {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE}};
    assert.deepEqual(placementFor(places, 'a', [WORK]), {
        kind: 'tile', tile: 'left', rect: LEFT_TILE, workArea: WORK, sizeBefore: SIZE_BEFORE,
    });
});

test('a Tile without a known earlier size is placed without inventing one', () => {
    const placement = placementFor({a: {frame: LEFT_TILE, tile: 'left'}}, 'a', [WORK]);
    assert.equal(placement.kind, 'tile');
    assert.equal(placement.sizeBefore, null);
});

test('a Tile on the second monitor stays on the second monitor', () => {
    const rightHalf = {x: 2560, y: 0, width: 640, height: 1024};
    const places = {a: {frame: rightHalf, tile: 'right'}};
    assert.deepEqual(placementFor(places, 'a', [WORK, SECOND]), {
        kind: 'tile', tile: 'right', rect: rightHalf, workArea: SECOND, sizeBefore: null,
    });
});

test('a Tile follows its monitor when the work area changed', () => {
    const smaller = {x: 0, y: 32, width: 1000, height: 600};
    const placement = placementFor({a: {frame: LEFT_TILE, tile: 'left'}}, 'a', [smaller]);
    assert.deepEqual(placement.rect, {x: 0, y: 32, width: 500, height: 600});
});

test('a Tile of a vanished monitor goes to the nearest remaining monitor', () => {
    const gone = {x: 3200, y: 0, width: 640, height: 1024}; // third monitor, now unplugged
    const placement = placementFor({a: {frame: gone, tile: 'right'}}, 'a', [WORK, SECOND]);
    assert.equal(placement.kind, 'tile');
    assert.deepEqual(placement.workArea, SECOND);
    assert.deepEqual(placement.rect, {x: 2560, y: 0, width: 640, height: 1024});
});

test('every one of the 14 Tiles can be remembered and put back', () => {
    for (const tile of TILES) {
        const rect = tileRect(tile, WORK);
        const places = rememberWindow({}, 'a', {frame: rect, tile});
        assert.deepEqual(placementFor(places, 'a', [WORK]).rect, rect, tile);
    }
});

test('a window maximised with the button comes back maximised on its monitor', () => {
    assert.deepEqual(placementFor({a: {frame: WORK, maximized: true}}, 'a', [WORK]), {kind: 'maximized', monitor: 0});
    assert.deepEqual(placementFor({a: {frame: SECOND, maximized: true}}, 'a', [WORK, SECOND]), {kind: 'maximized', monitor: 1});
});

test('a maximised window of a vanished monitor goes to the nearest remaining monitor', () => {
    const gone = {x: 5000, y: 0, width: 1280, height: 1024};
    assert.deepEqual(placementFor({a: {frame: gone, maximized: true}}, 'a', [WORK, SECOND]), {kind: 'maximized', monitor: 1});
});

test('the whole-screen Tile is a Tile, not the maximised flag', () => {
    const placement = placementFor({a: {frame: WORK, tile: 'full'}}, 'a', [WORK]);
    assert.equal(placement.kind, 'tile');
    assert.deepEqual(placement.rect, WORK);
});

// --- which windows count ---

test('an ordinary application window is known by its application id', () => {
    assert.equal(appKeyOf(WINDOW), 'org.example.Editor');
});

test('without an application id the window class is the key', () => {
    assert.equal(appKeyOf({...WINDOW, appId: null, wmClass: 'xterm', gtkWindowPath: null}), 'xterm');
});

test('a window without a recognisable application is left alone', () => {
    assert.equal(appKeyOf({...WINDOW, appId: null, wmClass: null}), null);
    assert.equal(appKeyOf({...WINDOW, appId: '', wmClass: ''}), null);
});

test('dialogs and windows belonging to another window are left alone', () => {
    assert.equal(appKeyOf({...WINDOW, normal: false}), null, 'a window of dialog type');
    assert.equal(appKeyOf({...WINDOW, hasParent: true}), null, 'a window with a parent window');
    assert.equal(appKeyOf({...WINDOW, attachedDialog: true}), null, 'a dialog attached to its parent');
});

test('full-screen windows and windows that cannot be moved or resized are left alone', () => {
    assert.equal(appKeyOf({...WINDOW, fullscreen: true}), null);
    assert.equal(appKeyOf({...WINDOW, canMove: false}), null);
    assert.equal(appKeyOf({...WINDOW, canResize: false}), null);
});

test('a Nautilus file-manager window counts', () => {
    const files = {...WINDOW, appId: 'org.gnome.Nautilus', wmClass: 'org.gnome.Nautilus', gtkWindowPath: '/org/gnome/Nautilus/window/2'};
    assert.equal(appKeyOf(files), 'org.gnome.Nautilus');
});

test('the file chooser Nautilus opens without a parent window is left alone', () => {
    // A plain window of the Nautilus application: no parent, normal type, but no GTK window path.
    const chooser = {...WINDOW, appId: 'org.gnome.Nautilus', wmClass: 'org.gnome.Nautilus', gtkWindowPath: null};
    assert.equal(appKeyOf(chooser), null);
});

test('a missing GTK window path matters for Nautilus only', () => {
    assert.equal(appKeyOf({...WINDOW, gtkWindowPath: null}), 'org.example.Editor');
});
