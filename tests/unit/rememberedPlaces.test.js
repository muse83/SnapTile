import test from 'node:test';
import assert from 'node:assert/strict';

import {MAX_APPLICATIONS, appKeyOf, parsePlaces, placeFor, rememberFree, rememberOnClose, serialisePlaces} from '../../src/rememberedPlaces.js';

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
    assert.deepEqual(rememberOnClose(before, 'a', moved, 3, [1, 2]), {a: {frame: moved}});
});

test('closing a window does not overwrite a younger save of another window of the application', () => {
    const before = {a: {frame: FRAME}};
    assert.equal(rememberOnClose(before, 'a', {...FRAME, x: 5}, 2, [1, 7]), before);
});

test('a window never saved is older than a window that was', () => {
    const before = {a: {frame: FRAME}};
    assert.equal(rememberOnClose(before, 'a', {...FRAME, x: 5}, 0, [4]), before);
});

test('when no window of the application was saved, the closing one is the last action', () => {
    const closed = {...FRAME, x: 5};
    assert.deepEqual(rememberOnClose({}, 'a', closed, 0, [0, 0]), {a: {frame: closed}});
    assert.deepEqual(rememberOnClose({}, 'a', closed, 0, []), {a: {frame: closed}});
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

test('an application with nothing remembered gets no place (it keeps its own)', () => {
    assert.equal(placeFor({}, 'org.example.Editor', [WORK]), null);
    assert.equal(placeFor({other: {frame: FRAME}}, 'org.example.Editor', [WORK]), null);
});

test('a remembered frame inside the work area is used as it is', () => {
    assert.deepEqual(placeFor({a: {frame: FRAME}}, 'a', [WORK]), FRAME);
});

test('a frame reaching out of the work area is moved back inside', () => {
    const out = {x: 1500, y: 800, width: 800, height: 600};
    assert.deepEqual(placeFor({a: {frame: out}}, 'a', [WORK]), {x: 1120, y: 480, width: 800, height: 600});
    const above = {x: -50, y: 0, width: 800, height: 600};
    assert.deepEqual(placeFor({a: {frame: above}}, 'a', [WORK]), {x: 0, y: 32, width: 800, height: 600});
});

test('a frame larger than the work area is shrunk to it', () => {
    const big = {x: 0, y: 0, width: 3000, height: 2000};
    assert.deepEqual(placeFor({a: {frame: big}}, 'a', [WORK]), WORK);
});

test('with several monitors the frame goes onto the work area nearest to its centre', () => {
    const second = {x: 1920, y: 0, width: 1280, height: 1024};
    const onSecond = {x: 2000, y: 100, width: 600, height: 400};
    assert.deepEqual(placeFor({a: {frame: onSecond}}, 'a', [WORK, second]), onSecond);

    const gone = {x: 5000, y: 300, width: 600, height: 400}; // right of everything
    assert.deepEqual(placeFor({a: {frame: gone}}, 'a', [WORK, second]), {x: 2600, y: 300, width: 600, height: 400});
});

test('without any monitor the frame is returned unchanged', () => {
    assert.deepEqual(placeFor({a: {frame: FRAME}}, 'a', []), FRAME);
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
