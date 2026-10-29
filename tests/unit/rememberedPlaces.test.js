import test from 'node:test';
import assert from 'node:assert/strict';

import {TILES, tileRect} from '../../src/tileDecision.js';
import {MAX_APPLICATIONS, appKeyOf, freeSizeFor, parsePlaces, placementFor, placementForSecondWindow, rememberFree, rememberInitialSize, rememberOnClose, rememberWindow, serialisePlaces} from '../../src/rememberedPlaces.js';

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

const monitorsOf = workAreas => workAreas.map(workArea => ({workArea}));
const rectFor = (places, key, monitors) => placementFor(places, key, monitors)?.rect ?? null;

test('an application with nothing remembered gets no place (it keeps its own)', () => {
    assert.equal(placementFor({}, 'org.example.Editor', monitorsOf([WORK])), null);
    assert.equal(placementFor({other: {frame: FRAME}}, 'org.example.Editor', monitorsOf([WORK])), null);
});

test('a remembered free window goes to its frame', () => {
    assert.deepEqual(placementFor({a: {frame: FRAME}}, 'a', monitorsOf([WORK])), {kind: 'free', rect: FRAME});
});

test('a frame reaching out of the work area is moved back inside', () => {
    const out = {x: 1500, y: 800, width: 800, height: 600};
    assert.deepEqual(rectFor({a: {frame: out}}, 'a', monitorsOf([WORK])), {x: 1120, y: 480, width: 800, height: 600});
    const above = {x: -50, y: 0, width: 800, height: 600};
    assert.deepEqual(rectFor({a: {frame: above}}, 'a', monitorsOf([WORK])), {x: 0, y: 32, width: 800, height: 600});
});

test('a frame larger than the work area is shrunk to it', () => {
    const big = {x: 0, y: 0, width: 3000, height: 2000};
    assert.deepEqual(rectFor({a: {frame: big}}, 'a', monitorsOf([WORK])), WORK);
});

test('with several monitors the frame goes onto the work area nearest to its centre', () => {
    const second = {x: 1920, y: 0, width: 1280, height: 1024};
    const onSecond = {x: 2000, y: 100, width: 600, height: 400};
    assert.deepEqual(rectFor({a: {frame: onSecond}}, 'a', monitorsOf([WORK, second])), onSecond);

    const gone = {x: 5000, y: 300, width: 600, height: 400}; // right of everything
    assert.deepEqual(rectFor({a: {frame: gone}}, 'a', monitorsOf([WORK, second])), {x: 2600, y: 300, width: 600, height: 400});
});

test('without any monitor the frame is returned unchanged', () => {
    assert.deepEqual(rectFor({a: {frame: FRAME}}, 'a', monitorsOf([])), FRAME);
});

// --- tiled and maximised windows: remembering ---

const LEFT_TILE = {x: 0, y: 32, width: 960, height: 1048}; // the left half of WORK
const RIGHT_TILE = {x: 960, y: 32, width: 960, height: 1048}; // the right half of WORK
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

test('a tiled window with no known size keeps the free size the application had', () => {
    const fromFree = rememberWindow({a: {frame: FRAME}}, 'a', {frame: LEFT_TILE, tile: 'left', sizeBefore: null});
    assert.deepEqual(fromFree, {a: {frame: LEFT_TILE, tile: 'left', sizeBefore: {width: FRAME.width, height: FRAME.height}}});

    const fromTiled = rememberWindow(
        {a: {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE}}, 'a', {frame: RIGHT_TILE, tile: 'right'});
    assert.deepEqual(fromTiled.a.sizeBefore, SIZE_BEFORE);
});

test('a tiled window\'s own earlier size wins over the stored one', () => {
    const places = rememberWindow({a: {frame: FRAME}}, 'a', {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE});
    assert.deepEqual(places.a.sizeBefore, SIZE_BEFORE);
});

test('the size of a Tile is never taken for the free size of the application', () => {
    // The application has no free size on record; a tiled window without one must not get its Tile's size.
    assert.deepEqual(rememberWindow({}, 'a', {frame: LEFT_TILE, tile: 'left'}), {a: {frame: LEFT_TILE, tile: 'left'}});
    const tiledWithout = {a: {frame: LEFT_TILE, tile: 'left'}};
    assert.deepEqual(rememberWindow(tiledWithout, 'a', {frame: RIGHT_TILE, tile: 'right'}).a, {frame: RIGHT_TILE, tile: 'right'});
});

test('a free window is remembered without any earlier size', () => {
    const places = rememberWindow({a: {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE}}, 'a', {frame: FRAME});
    assert.deepEqual(places, {a: {frame: FRAME}});
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
    assert.deepEqual(placementFor(places, 'a', monitorsOf([WORK])), {
        kind: 'tile', tile: 'left', rect: LEFT_TILE, workArea: WORK, sizeBefore: SIZE_BEFORE,
    });
});

test('a Tile without a known earlier size is placed without inventing one', () => {
    const placement = placementFor({a: {frame: LEFT_TILE, tile: 'left'}}, 'a', monitorsOf([WORK]));
    assert.equal(placement.kind, 'tile');
    assert.equal(placement.sizeBefore, null);
});

test('a Tile on the second monitor stays on the second monitor', () => {
    const rightHalf = {x: 2560, y: 0, width: 640, height: 1024};
    const places = {a: {frame: rightHalf, tile: 'right'}};
    assert.deepEqual(placementFor(places, 'a', monitorsOf([WORK, SECOND])), {
        kind: 'tile', tile: 'right', rect: rightHalf, workArea: SECOND, sizeBefore: null,
    });
});

test('a Tile follows its monitor when the work area changed', () => {
    const smaller = {x: 0, y: 32, width: 1000, height: 600};
    const placement = placementFor({a: {frame: LEFT_TILE, tile: 'left'}}, 'a', monitorsOf([smaller]));
    assert.deepEqual(placement.rect, {x: 0, y: 32, width: 500, height: 600});
});

test('a Tile of a vanished monitor goes to the nearest remaining monitor', () => {
    const gone = {x: 3200, y: 0, width: 640, height: 1024}; // third monitor, now unplugged
    const placement = placementFor({a: {frame: gone, tile: 'right'}}, 'a', monitorsOf([WORK, SECOND]));
    assert.equal(placement.kind, 'tile');
    assert.deepEqual(placement.workArea, SECOND);
    assert.deepEqual(placement.rect, {x: 2560, y: 0, width: 640, height: 1024});
});

test('every one of the 14 Tiles can be remembered and put back', () => {
    for (const tile of TILES) {
        const rect = tileRect(tile, WORK);
        const places = rememberWindow({}, 'a', {frame: rect, tile});
        assert.deepEqual(placementFor(places, 'a', monitorsOf([WORK])).rect, rect, tile);
    }
});

test('a window maximised with the button comes back maximised on its monitor', () => {
    assert.deepEqual(placementFor({a: {frame: WORK, maximized: true}}, 'a', monitorsOf([WORK])), {kind: 'maximized', monitor: 0});
    assert.deepEqual(placementFor({a: {frame: SECOND, maximized: true}}, 'a', monitorsOf([WORK, SECOND])), {kind: 'maximized', monitor: 1});
});

test('a maximised window of a vanished monitor goes to the nearest remaining monitor', () => {
    const gone = {x: 5000, y: 0, width: 1280, height: 1024};
    assert.deepEqual(placementFor({a: {frame: gone, maximized: true}}, 'a', monitorsOf([WORK, SECOND])), {kind: 'maximized', monitor: 1});
});

test('the whole-screen Tile is a Tile, not the maximised flag', () => {
    const placement = placementFor({a: {frame: WORK, tile: 'full'}}, 'a', monitorsOf([WORK]));
    assert.equal(placement.kind, 'tile');
    assert.deepEqual(placement.rect, WORK);
});

// --- several monitors: the monitor is remembered and the position kept relative to it ---

// A monitor as the shell glue describes it: the work area and an id that survives re-plugging
// and rearranging (connector, vendor, product and serial, as Mutter itself tells monitors apart).
const LEFT_MONITOR = {id: 'DP-1', workArea: WORK};
const RIGHT_MONITOR = {id: 'HDMI-1', workArea: SECOND};
const ON_RIGHT = {x: 2020, y: 100, width: 600, height: 400}; // 100 right and 100 down in SECOND

test('a free window is remembered with its monitor and its position relative to that monitor', () => {
    const places = rememberWindow({}, 'a', {frame: ON_RIGHT}, [LEFT_MONITOR, RIGHT_MONITOR]);
    assert.deepEqual(places, {a: {frame: ON_RIGHT, monitor: 'HDMI-1', offset: {x: 100, y: 100}}});
});

test('the monitor is the one whose work area is nearest to the centre of the frame', () => {
    const onLeft = {x: 300, y: 200, width: 600, height: 400};
    const places = rememberWindow({}, 'a', {frame: onLeft}, [LEFT_MONITOR, RIGHT_MONITOR]);
    assert.deepEqual(places.a, {frame: onLeft, monitor: 'DP-1', offset: {x: 300, y: 168}});
});

test('a tiled or maximised window is remembered with its monitor but with no relative position', () => {
    const tileRectOnRight = tileRect('left', SECOND);
    const tiled = rememberWindow({}, 'a', {frame: tileRectOnRight, tile: 'left'}, [LEFT_MONITOR, RIGHT_MONITOR]);
    assert.deepEqual(tiled.a, {frame: tileRectOnRight, tile: 'left', monitor: 'HDMI-1'});
    const maximised = rememberWindow({}, 'a', {frame: SECOND, maximized: true}, [LEFT_MONITOR, RIGHT_MONITOR]);
    assert.deepEqual(maximised.a, {frame: SECOND, maximized: true, monitor: 'HDMI-1'});
});

test('without monitors, or with monitors that have no id, no monitor is remembered', () => {
    assert.deepEqual(rememberWindow({}, 'a', {frame: ON_RIGHT}), {a: {frame: ON_RIGHT}});
    assert.deepEqual(rememberWindow({}, 'a', {frame: ON_RIGHT}, []), {a: {frame: ON_RIGHT}});
    assert.deepEqual(rememberWindow({}, 'a', {frame: ON_RIGHT}, [{workArea: WORK}, {workArea: SECOND}]),
        {a: {frame: ON_RIGHT}});
});

// A monitor the shell could not name yet (Mutter has not answered): only its work area is known.
const UNNAMED = [{workArea: WORK}, {workArea: SECOND}];
const REMEMBERED_ON_RIGHT = rememberWindow({}, 'a', {frame: ON_RIGHT}, [LEFT_MONITOR, RIGHT_MONITOR]);
const MOVED_ON_RIGHT = {x: 2100, y: 150, width: 600, height: 400};

test('a save that cannot name the monitor keeps the monitor remembered before, with the new relative position', () => {
    const places = rememberWindow(REMEMBERED_ON_RIGHT, 'a', {frame: MOVED_ON_RIGHT}, UNNAMED);
    assert.deepEqual(places.a, {frame: MOVED_ON_RIGHT, monitor: 'HDMI-1', offset: {x: 180, y: 150}});
});

test('a save that can name the monitor replaces the one remembered before', () => {
    const onLeft = {x: 300, y: 200, width: 600, height: 400};
    const places = rememberWindow(REMEMBERED_ON_RIGHT, 'a', {frame: onLeft}, [LEFT_MONITOR, RIGHT_MONITOR]);
    assert.deepEqual(places.a, {frame: onLeft, monitor: 'DP-1', offset: {x: 300, y: 168}});
});

test('a save that cannot name the monitor stores none for an application that never had one', () => {
    const before = {a: {frame: FRAME}};
    assert.deepEqual(rememberWindow(before, 'a', {frame: MOVED_ON_RIGHT}, UNNAMED).a, {frame: MOVED_ON_RIGHT});
    assert.deepEqual(rememberWindow(before, 'b', {frame: MOVED_ON_RIGHT}, UNNAMED).b, {frame: MOVED_ON_RIGHT});
});

test('a window that clearly moved to another monitor is not left with the old one', () => {
    const onLeft = {x: 300, y: 200, width: 600, height: 400};
    assert.deepEqual(rememberWindow(REMEMBERED_ON_RIGHT, 'a', {frame: onLeft}, UNNAMED).a, {frame: onLeft});
});

test('a monitor of the list that is known and is not the one nearest is never kept for a window on an unnamed one', () => {
    const monitors = [LEFT_MONITOR, {workArea: SECOND}]; // the right monitor has no id (yet)
    const onRight = rememberWindow({a: {frame: ON_RIGHT, monitor: 'DP-1', offset: {x: 5, y: 5}}}, 'a',
        {frame: MOVED_ON_RIGHT}, monitors);
    assert.deepEqual(onRight.a, {frame: MOVED_ON_RIGHT});
});

test('a tiled or maximised window that cannot name its monitor keeps the one remembered before, with no relative position', () => {
    const tileOnRight = tileRect('left', SECOND);
    const tiled = rememberWindow(REMEMBERED_ON_RIGHT, 'a', {frame: tileOnRight, tile: 'left'}, UNNAMED);
    // The free size from before stays, for a tiled as for a maximised window.
    const freeSize = {width: 600, height: 400};
    assert.deepEqual(tiled.a, {frame: tileOnRight, tile: 'left', sizeBefore: freeSize, monitor: 'HDMI-1'});
    const maximised = rememberWindow(REMEMBERED_ON_RIGHT, 'a', {frame: SECOND, maximized: true}, UNNAMED);
    assert.deepEqual(maximised.a, {frame: SECOND, maximized: true, sizeBefore: freeSize, monitor: 'HDMI-1'});
});

test('with no monitor information at all the monitor remembered before is kept, without a relative position', () => {
    for (const monitors of [undefined, []]) {
        const places = rememberWindow(REMEMBERED_ON_RIGHT, 'a', {frame: MOVED_ON_RIGHT}, monitors);
        assert.deepEqual(places.a, {frame: MOVED_ON_RIGHT, monitor: 'HDMI-1'});
    }
});

test('a window closing without a monitor name keeps the monitor remembered before', () => {
    const places = rememberOnClose(REMEMBERED_ON_RIGHT, 'a', {frame: MOVED_ON_RIGHT}, 0, [], UNNAMED);
    assert.deepEqual(places.a, {frame: MOVED_ON_RIGHT, monitor: 'HDMI-1', offset: {x: 180, y: 150}});
});

test('a window closing is remembered with its monitor too', () => {
    const places = rememberOnClose({}, 'a', {frame: ON_RIGHT}, 0, [], [LEFT_MONITOR, RIGHT_MONITOR]);
    assert.deepEqual(places.a.monitor, 'HDMI-1');
});

test('the monitor and the relative position survive being stored and read back', () => {
    const places = rememberWindow({}, 'a', {frame: ON_RIGHT}, [LEFT_MONITOR, RIGHT_MONITOR]);
    assert.deepEqual(parsePlaces(serialisePlaces(places)), places);
});

test('a corrupt monitor or relative position drops that entry and keeps the good ones', () => {
    const good = {frame: ON_RIGHT, monitor: 'HDMI-1', offset: {x: 100, y: 100}};
    const text = JSON.stringify({
        good,
        monitorNotText: {frame: ON_RIGHT, monitor: 5, offset: {x: 100, y: 100}},
        monitorEmpty: {frame: ON_RIGHT, monitor: '', offset: {x: 100, y: 100}},
        offsetTextual: {frame: ON_RIGHT, monitor: 'HDMI-1', offset: {x: 'left', y: 100}},
        offsetNotObject: {frame: ON_RIGHT, monitor: 'HDMI-1', offset: 7},
        offsetWithoutMonitor: {frame: ON_RIGHT, offset: {x: 100, y: 100}},
    });
    assert.deepEqual(parsePlaces(text), {good});
});

test('a window reopens on its monitor at the same place relative to it, also when the monitors moved', () => {
    const places = {a: {frame: ON_RIGHT, monitor: 'HDMI-1', offset: {x: 100, y: 100}}};
    // The right monitor is now to the left of the other one, and 40 pixels lower.
    const moved = {id: 'HDMI-1', workArea: {x: -1280, y: 40, width: 1280, height: 1024}};
    const other = {id: 'DP-1', workArea: {x: 0, y: 32, width: 1920, height: 1048}};
    assert.deepEqual(rectFor(places, 'a', [other, moved]), {x: -1180, y: 140, width: 600, height: 400});
});

test('the monitor wins over the old absolute position', () => {
    // The two monitors swapped places: where the window used to be is now the other monitor.
    const places = {a: {frame: ON_RIGHT, monitor: 'HDMI-1', offset: {x: 100, y: 100}}};
    const swappedRight = {id: 'HDMI-1', workArea: {x: 0, y: 0, width: 1280, height: 1024}};
    const swappedLeft = {id: 'DP-1', workArea: {x: 1280, y: 32, width: 1920, height: 1048}};
    assert.deepEqual(rectFor(places, 'a', [swappedRight, swappedLeft]), {x: 100, y: 100, width: 600, height: 400});
});

test('a vanished monitor lets the nearest monitor to the last absolute position take the window', () => {
    const places = {a: {frame: {x: 3400, y: 300, width: 600, height: 400}, monitor: 'DP-3', offset: {x: 100, y: 300}}};
    // Nearest to the old centre is the right monitor, so the old absolute position is kept as far
    // as it fits there.
    assert.deepEqual(rectFor(places, 'a', [LEFT_MONITOR, RIGHT_MONITOR]), {x: 2600, y: 300, width: 600, height: 400});
    // The same laptop without its dock: only the built-in panel is left, the window is moved inside it.
    assert.deepEqual(rectFor(places, 'a', [LEFT_MONITOR]), {x: 1320, y: 300, width: 600, height: 400});
});

test('a window without a stored monitor still goes by its absolute position', () => {
    assert.deepEqual(rectFor({a: {frame: ON_RIGHT}}, 'a', [LEFT_MONITOR, RIGHT_MONITOR]), ON_RIGHT);
});

test('a monitor of the list without an id is never taken for the remembered one', () => {
    const places = {a: {frame: ON_RIGHT, monitor: 'HDMI-1', offset: {x: 100, y: 100}}};
    // Nothing matches, so the absolute position decides: the second work area is nearest.
    assert.deepEqual(rectFor(places, 'a', monitorsOf([WORK, SECOND])), ON_RIGHT);
});

test('a remembered size larger than the work area of its monitor is shrunk to it', () => {
    const places = {a: {frame: {x: 2020, y: 100, width: 1600, height: 1200}, monitor: 'HDMI-1', offset: {x: 100, y: 100}}};
    assert.deepEqual(rectFor(places, 'a', [LEFT_MONITOR, RIGHT_MONITOR]), SECOND);
});

test('a relative position that reaches out of a smaller monitor is moved back inside', () => {
    const places = {a: {frame: ON_RIGHT, monitor: 'HDMI-1', offset: {x: 100, y: 100}}};
    const smaller = {id: 'HDMI-1', workArea: {x: 1920, y: 0, width: 640, height: 480}};
    assert.deepEqual(rectFor(places, 'a', [LEFT_MONITOR, smaller]), {x: 1960, y: 80, width: 600, height: 400});
});

test('a Tile goes to the Tile of its own monitor, also when the monitors moved', () => {
    const places = {a: {frame: tileRect('right', SECOND), tile: 'right', monitor: 'HDMI-1'}};
    const moved = {id: 'HDMI-1', workArea: {x: -1280, y: 0, width: 1280, height: 1024}};
    const placement = placementFor(places, 'a', [LEFT_MONITOR, moved]);
    assert.equal(placement.kind, 'tile');
    assert.deepEqual(placement.workArea, moved.workArea);
    assert.deepEqual(placement.rect, {x: -640, y: 0, width: 640, height: 1024});
});

test('a Tile of a vanished monitor applies on the monitor nearest to its last position', () => {
    const gone = {x: 3200, y: 0, width: 640, height: 1024};
    const places = {a: {frame: gone, tile: 'right', monitor: 'DP-3'}};
    const placement = placementFor(places, 'a', [LEFT_MONITOR, RIGHT_MONITOR]);
    assert.equal(placement.kind, 'tile');
    assert.deepEqual(placement.workArea, SECOND);
    assert.deepEqual(placement.rect, {x: 2560, y: 0, width: 640, height: 1024});
});

test('a maximised window goes to its monitor, or to the nearest one when that is gone', () => {
    const places = {a: {frame: SECOND, maximized: true, monitor: 'HDMI-1'}};
    const swappedRight = {id: 'HDMI-1', workArea: {x: 0, y: 0, width: 1280, height: 1024}};
    const swappedLeft = {id: 'DP-1', workArea: {x: 1280, y: 32, width: 1920, height: 1048}};
    assert.deepEqual(placementFor(places, 'a', [swappedLeft, swappedRight]), {kind: 'maximized', monitor: 1});
    const gone = {a: {frame: SECOND, maximized: true, monitor: 'DP-3'}};
    assert.deepEqual(placementFor(gone, 'a', [LEFT_MONITOR, RIGHT_MONITOR]), {kind: 'maximized', monitor: 1});
});

test('with no monitors at all the frame is returned unchanged, whatever monitor was stored', () => {
    const places = {a: {frame: ON_RIGHT, monitor: 'HDMI-1', offset: {x: 100, y: 100}}};
    assert.deepEqual(placementFor(places, 'a', []), {kind: 'free', rect: ON_RIGHT});
});

// --- a second window of an application ---

// A 1920x1080 panel of 345x194 mm: 55.65 pixels per centimetre, so the offset is 56 pixels.
const PANEL = {width: 1920, height: 1080, widthMm: 345, heightMm: 194, workArea: WORK};
const OFFSET = 56;
const OPEN = {x: 100, y: 120, width: 800, height: 600};
const OWN = {width: 640, height: 480};

function second(places, siblings, {monitors = [PANEL], defaultSize = OWN} = {}) {
    return placementForSecondWindow(places, 'org.example.Editor', {defaultSize, siblings, monitors});
}

test('a second window opens about 1 cm right and down from the open window, with the remembered size', () => {
    const placement = second({'org.example.Editor': {frame: FRAME}}, [OPEN]);
    assert.deepEqual(placement, {kind: 'free', rect: {x: 100 + OFFSET, y: 120 + OFFSET, width: 800, height: 600}});
});

test('without a remembered size the second window keeps its application\'s own default size', () => {
    const placement = second({}, [OPEN]);
    assert.deepEqual(placement.rect, {x: 100 + OFFSET, y: 120 + OFFSET, ...OWN});
});

test('the offset is measured in real centimetres of the monitor the open window is on', () => {
    const sparse = {...PANEL, widthMm: 690, heightMm: 388}; // the same pixels on a panel twice as big
    assert.equal(second({}, [OPEN], {monitors: [sparse]}).rect.x, 100 + 28);
    assert.equal(second({}, [OPEN], {monitors: [PANEL]}).rect.x, 100 + 56);
});

test('a monitor of unknown size is measured with the 96 DPI fallback of the Edge zones', () => {
    const unknown = {width: 1920, height: 1080, workArea: WORK};
    assert.equal(second({}, [OPEN], {monitors: [unknown]}).rect.x, 100 + 38); // 1 cm = 37.8 px
});

test('the offset of the monitor the open window is on counts, not that of the first monitor', () => {
    const right = {...PANEL, widthMm: 690, heightMm: 388, workArea: {x: 1920, y: 32, width: 1920, height: 1048}};
    const open = {x: 2100, y: 120, width: 800, height: 600};
    assert.equal(second({}, [open], {monitors: [PANEL, right]}).rect.x, 2100 + 28);
});

test('the offset starts from the most recently used open window, the first of the list', () => {
    const older = {x: 700, y: 300, width: 400, height: 300};
    assert.deepEqual(second({}, [OPEN, older]).rect, {x: 100 + OFFSET, y: 120 + OFFSET, ...OWN});
});

test('a spot another window of the application sits on exactly is stepped over', () => {
    const taken = {x: 100 + OFFSET, y: 120 + OFFSET, width: 300, height: 200};
    assert.deepEqual(second({}, [OPEN, taken]).rect, {x: 100 + 2 * OFFSET, y: 120 + 2 * OFFSET, ...OWN});
});

test('a spot that is only close to another window is not stepped over', () => {
    const near = {x: 100 + OFFSET + 1, y: 120 + OFFSET, width: 800, height: 600};
    assert.equal(second({}, [OPEN, near]).rect.x, 100 + OFFSET);
});

test('several taken spots in a row are all stepped over', () => {
    const third = [1, 2].map(step => ({x: 100 + step * OFFSET, y: 120 + step * OFFSET, width: 300, height: 200}));
    assert.deepEqual(second({}, [OPEN, ...third]).rect, {x: 100 + 3 * OFFSET, y: 120 + 3 * OFFSET, ...OWN});
});

test('stepping stops after 10 steps, the last spot is used even if it is taken', () => {
    const open = {x: 20, y: 40, width: 300, height: 200};
    const taken = Array.from({length: 12}, (unused, i) =>
        ({x: 20 + (i + 1) * OFFSET, y: 40 + (i + 1) * OFFSET, width: 300, height: 200}));
    const placement = second({}, [open, ...taken]);
    assert.deepEqual(placement.rect, {x: 20 + 10 * OFFSET, y: 40 + 10 * OFFSET, ...OWN});
});

test('a second window reaching out of the work area is moved back inside', () => {
    const nearCorner = {x: 1900, y: 1000, width: 800, height: 600};
    assert.deepEqual(second({'org.example.Editor': {frame: FRAME}}, [nearCorner]).rect,
        {x: 1920 - 800, y: 32 + 1048 - 600, width: 800, height: 600});
});

test('a second window larger than the work area is shrunk to it', () => {
    const placement = second({'org.example.Editor': {frame: {x: 0, y: 0, width: 5000, height: 4000}}}, [OPEN]);
    assert.deepEqual(placement.rect, {x: 0, y: 32, width: 1920, height: 1048});
});

test('a spot is compared after fitting into the work area, where it really ends up', () => {
    // The second step would reach out to the right and is pulled back to x 1120, where a window sits.
    const open = {x: 1060, y: 300, width: 800, height: 600};
    const siblings = [open, {x: 1116, y: 356, width: 800, height: 600}, {x: 1120, y: 412, width: 800, height: 600}];
    const placement = second({'org.example.Editor': {frame: FRAME}}, siblings);
    assert.deepEqual(placement.rect, {x: 1120, y: 300 + 3 * OFFSET, width: 800, height: 600});
});

test('a second window is never put into a Tile, whatever the application remembered', () => {
    const tiled = {'org.example.Editor': {frame: tileRect('left', WORK), tile: 'left', sizeBefore: {width: 520, height: 360}}};
    const placement = second(tiled, [tileRect('left', WORK)]);
    assert.equal(placement.kind, 'free');
    assert.deepEqual(placement.rect, {x: 0 + OFFSET, y: 32 + OFFSET, width: 520, height: 360});
});

test('a second window is never maximised, the free size is the one from before', () => {
    const maximised = {'org.example.Editor': {frame: WORK, maximized: true, sizeBefore: {width: 520, height: 360}}};
    const placement = second(maximised, [WORK]);
    assert.equal(placement.kind, 'free');
    assert.deepEqual(placement.rect, {x: OFFSET, y: 32 + OFFSET, width: 520, height: 360});
});

test('a tiled or maximised place without a known free size gives the application\'s own default size', () => {
    const tiled = {'org.example.Editor': {frame: tileRect('right', WORK), tile: 'right'}};
    assert.deepEqual(second(tiled, [tileRect('right', WORK)]).rect.width, OWN.width);
});

test('without any monitor the second window is offset with the fallback and not fitted', () => {
    const placement = second({}, [OPEN], {monitors: []});
    assert.deepEqual(placement.rect, {x: 100 + 38, y: 120 + 38, ...OWN});
});

test('placing a second window does not change the places or keep the objects it was given', () => {
    const places = {'org.example.Editor': {frame: {...FRAME}}};
    const before = JSON.stringify(places);
    const siblings = [{...OPEN}];
    const placement = second(places, siblings);
    placement.rect.x = -1;
    assert.equal(JSON.stringify(places), before);
    assert.equal(siblings[0].x, 100);
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

// --- the free size of an application ---

test('the free size of an application is that of its free window', () => {
    assert.deepEqual(freeSizeFor({a: {frame: FRAME}}, 'a'), {width: FRAME.width, height: FRAME.height});
});

test('the free size of an application is the earlier size of a tiled or maximised window', () => {
    const tiled = {a: {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE}};
    assert.deepEqual(freeSizeFor(tiled, 'a'), SIZE_BEFORE);
    const maximised = {a: {frame: WORK, maximized: true, sizeBefore: SIZE_BEFORE}};
    assert.deepEqual(freeSizeFor(maximised, 'a'), SIZE_BEFORE);
});

test('no free size is known for an unknown application or a tiled window without an earlier size', () => {
    assert.equal(freeSizeFor({}, 'a'), null);
    assert.equal(freeSizeFor({a: {frame: LEFT_TILE, tile: 'left'}}, 'a'), null);
});

test('the free size handed out is a copy', () => {
    const places = {a: {frame: FRAME}};
    freeSizeFor(places, 'a').width = 1;
    assert.equal(places.a.frame.width, FRAME.width);
});

// --- the size a window has when it first opens ---

test('the first window of an unknown application is remembered by the size it opens with', () => {
    const places = rememberInitialSize({}, 'a', FRAME);
    assert.deepEqual(places, {a: {frame: FRAME}});
    assert.deepEqual(freeSizeFor(places, 'a'), {width: FRAME.width, height: FRAME.height});
});

test('the opening size comes with the monitor, like any free window', () => {
    const monitors = [{id: 'DP-1', workArea: WORK}];
    const places = rememberInitialSize({}, 'a', FRAME, monitors);
    assert.deepEqual(places.a, {frame: FRAME, monitor: 'DP-1', offset: {x: FRAME.x - WORK.x, y: FRAME.y - WORK.y}});
});

test('a size already known is never replaced by the opening size', () => {
    const free = {a: {frame: FRAME}};
    assert.equal(rememberInitialSize(free, 'a', {...FRAME, width: 300, height: 200}), free);
    const tiled = {a: {frame: LEFT_TILE, tile: 'left', sizeBefore: SIZE_BEFORE}};
    assert.equal(rememberInitialSize(tiled, 'a', FRAME), tiled);
});

test('a Tile or maximised place without a size gets the opening size and is otherwise left as it is', () => {
    const tiled = {other: {frame: FRAME}, a: {frame: LEFT_TILE, tile: 'left', monitor: 'DP-1'}};
    const places = rememberInitialSize(tiled, 'a', FRAME);
    assert.deepEqual(places.a, {frame: LEFT_TILE, tile: 'left', monitor: 'DP-1', sizeBefore: {width: FRAME.width, height: FRAME.height}});
    assert.deepEqual(Object.keys(places), ['other', 'a']);
    assert.equal(tiled.a.sizeBefore, undefined);

    const maximised = rememberInitialSize({a: {frame: WORK, maximized: true}}, 'a', FRAME);
    assert.deepEqual(maximised.a.sizeBefore, {width: FRAME.width, height: FRAME.height});
});

test('a frame without a size is not remembered as the opening size', () => {
    const places = {};
    assert.equal(rememberInitialSize(places, 'a', {...FRAME, width: 0}), places);
});

test('the opening size follows the application while it is still the one remembered for it', () => {
    const first = rememberInitialSize({}, 'a', FRAME);
    const bigger = {...FRAME, width: 1000, height: 700};
    const next = rememberInitialSize(first, 'a', bigger, [], {width: FRAME.width, height: FRAME.height});
    assert.deepEqual(next.a.frame, bigger);

    const tiled = rememberInitialSize({a: {frame: LEFT_TILE, tile: 'left'}}, 'a', FRAME);
    const followed = rememberInitialSize(tiled, 'a', bigger, [], {width: FRAME.width, height: FRAME.height});
    assert.deepEqual(followed.a.sizeBefore, {width: 1000, height: 700});
    assert.equal(followed.a.tile, 'left');
});

test('the opening size does not replace a size the user set or another window saved since', () => {
    const userSized = {a: {frame: {...FRAME, width: 900}}};
    const bigger = {...FRAME, width: 1000, height: 700};
    assert.equal(rememberInitialSize(userSized, 'a', bigger, [], {width: FRAME.width, height: FRAME.height}), userSized);
});
