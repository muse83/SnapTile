import test from 'node:test';
import assert from 'node:assert/strict';

import {decideTile, pixelsPerCm} from '../../src/tileDecision.js';

// 1000 x 600 px on 250 x 150 mm: 40 px per cm, so 1 cm = 40 px and 3 cm = 120 px.
// The work area leaves 30 px for a top bar.
const MON = {
    x: 0, y: 0, width: 1000, height: 600, widthMm: 250, heightMm: 150,
    workArea: {x: 0, y: 30, width: 1000, height: 570},
};

function at(x, y, extra = {}) {
    return decideTile({pointer: {x, y}, monitors: [MON], ...extra});
}

const tileAt = (x, y) => at(x, y)?.tile ?? null;

test('corner squares are quarters', () => {
    assert.equal(tileAt(0, 0), 'top-left');
    assert.equal(tileAt(999, 0), 'top-right');
    assert.equal(tileAt(0, 599), 'bottom-left');
    assert.equal(tileAt(999, 599), 'bottom-right');
});

test('quarter rectangles fill a quarter of the work area', () => {
    assert.deepEqual(at(0, 0).rect, {x: 0, y: 30, width: 500, height: 285});
    assert.deepEqual(at(999, 599).rect, {x: 500, y: 315, width: 500, height: 285});
});

test('corner square boundary is exactly 1 cm', () => {
    assert.equal(tileAt(39, 0), 'top-left');
    assert.equal(tileAt(40, 0), 'full');
    assert.equal(tileAt(0, 39), 'top-left');
    assert.equal(tileAt(0, 40), 'top-half');
    assert.equal(tileAt(959, 0), 'full');
    assert.equal(tileAt(960, 0), 'top-right');
    assert.equal(tileAt(999, 560), 'bottom-right');
    assert.equal(tileAt(999, 559), 'bottom-half');
});

test('side strip 1 to 3 cm from a corner is the top or bottom half', () => {
    assert.equal(tileAt(0, 40), 'top-half');
    assert.equal(tileAt(0, 119), 'top-half');
    assert.equal(tileAt(0, 120), 'left');
    assert.equal(tileAt(999, 40), 'top-half');
    assert.equal(tileAt(999, 119), 'top-half');
    assert.equal(tileAt(999, 120), 'right');
    assert.equal(tileAt(0, 559), 'bottom-half');
    assert.equal(tileAt(0, 480), 'bottom-half');
    assert.equal(tileAt(0, 479), 'left');
    assert.equal(tileAt(999, 480), 'bottom-half');
    assert.equal(tileAt(999, 479), 'right');
});

test('half rectangles span the work area', () => {
    assert.deepEqual(at(0, 40).rect, {x: 0, y: 30, width: 1000, height: 285});
    assert.deepEqual(at(0, 559).rect, {x: 0, y: 315, width: 1000, height: 285});
    assert.deepEqual(at(0, 300).rect, {x: 0, y: 30, width: 500, height: 570});
    assert.deepEqual(at(999, 300).rect, {x: 500, y: 30, width: 500, height: 570});
});

test('rest of the top edge is the whole screen, no half strip on top or bottom', () => {
    assert.equal(tileAt(500, 0), 'full');
    assert.equal(tileAt(100, 0), 'full');
    assert.equal(tileAt(900, 39), 'full');
    assert.deepEqual(at(500, 0).rect, MON.workArea);
});

test('strip depth is 1 cm: just outside gives no tile', () => {
    assert.equal(tileAt(500, 40), null);
    assert.equal(tileAt(40, 300), null);
    assert.equal(tileAt(959, 300), null);
    assert.equal(tileAt(500, 559), null);
    assert.equal(tileAt(500, 560), 'third-2');
});

test('bottom edge gives the third under the pointer', () => {
    assert.equal(tileAt(100, 599), 'third-1');
    assert.equal(tileAt(333, 599), 'third-1');
    assert.equal(tileAt(334, 599), 'third-2');
    assert.equal(tileAt(666, 599), 'third-2');
    assert.equal(tileAt(667, 599), 'third-3');
    assert.equal(tileAt(0, 599), 'bottom-left');
    assert.deepEqual(at(500, 599).rect, {x: 334, y: 30, width: 333, height: 570});
    assert.deepEqual(at(100, 599).rect, {x: 0, y: 30, width: 334, height: 570});
    assert.deepEqual(at(900, 599).rect, {x: 667, y: 30, width: 333, height: 570});
});

test('thirds leave no gap and no overlap on odd widths', () => {
    const mon = {...MON, width: 1001, workArea: {x: 0, y: 30, width: 1001, height: 570}};
    const rects = [100, 500, 900].map(x =>
        decideTile({pointer: {x, y: 599}, monitors: [mon]}).rect);
    assert.equal(rects[0].x, 0);
    assert.equal(rects[0].x + rects[0].width, rects[1].x);
    assert.equal(rects[1].x + rects[1].width, rects[2].x);
    assert.equal(rects[2].x + rects[2].width, 1001);
});

test('thirds follow the work area, not the monitor', () => {
    const mon = {...MON, workArea: {x: 60, y: 30, width: 900, height: 570}};
    const r = decideTile({pointer: {x: 500, y: 599}, monitors: [mon]});
    assert.equal(r.tile, 'third-2');
    assert.deepEqual(r.rect, {x: 360, y: 30, width: 300, height: 570});
});

// Merged thirds: feed each result's state into the next sample.
function walk(xs, y = 599) {
    let state = null;
    let last = null;
    for (const x of xs) {
        last = at(x, y, {state});
        state = last?.state ?? null;
    }
    return last;
}

test('merging works in all four directions', () => {
    assert.equal(walk([100, 500]).tile, 'two-thirds-left');
    assert.equal(walk([500, 900]).tile, 'two-thirds-right');
    assert.equal(walk([500, 100]).tile, 'two-thirds-left');
    assert.equal(walk([900, 500]).tile, 'two-thirds-right');
});

test('merged rectangle covers exactly two thirds', () => {
    assert.deepEqual(walk([100, 500]).rect, {x: 0, y: 30, width: 667, height: 570});
    assert.deepEqual(walk([500, 900]).rect, {x: 334, y: 30, width: 666, height: 570});
});

test('moving back into the first third gives the single third again', () => {
    assert.equal(walk([100, 500, 100]).tile, 'third-1');
    assert.equal(walk([900, 500, 900]).tile, 'third-3');
    assert.equal(walk([100, 500, 100, 500]).tile, 'two-thirds-left');
});

test('merge continues from the third the pointer came from', () => {
    assert.equal(walk([100, 500, 900]).tile, 'two-thirds-right');
    assert.equal(walk([900, 500, 100]).tile, 'two-thirds-left');
    assert.equal(walk([100, 500, 900, 500]).tile, 'third-2');
});

test('staying in a merged state while moving inside the same third', () => {
    assert.equal(walk([100, 500, 520, 480]).tile, 'two-thirds-left');
});

test('a missed third falls back to the single current third', () => {
    assert.equal(walk([100, 900]).tile, 'third-3');
    assert.equal(walk([900, 100]).tile, 'third-1');
});

test('whole screen is never produced by merging', () => {
    for (const path of [[100, 500, 900], [900, 500, 100], [100, 900], [500, 100, 500, 900]])
        assert.notEqual(walk(path).tile, 'full');
});

test('leaving the bottom strip clears the preview and the merge', () => {
    let state = null;
    state = at(100, 599, {state}).state;
    state = at(500, 599, {state}).state;
    assert.equal(at(500, 300, {state}), null);
    // coming back starts over with a single third
    assert.equal(at(500, 599, {state: null}).tile, 'third-2');
});

test('moving from the strip into a corner gives the quarter and drops the merge', () => {
    let state = at(500, 599).state;
    const corner = at(0, 599, {state});
    assert.equal(corner.tile, 'bottom-left');
    assert.equal(corner.state, null);
});

test('look sizes are converted to pixels for the monitor', () => {
    // 40 px/cm: 2 mm = 8 px, 0.83 mm = 3.32 px
    assert.deepEqual(at(0, 0).look, {radius: 8, margin: 3});
});

test('pixelsPerCm uses the physical size', () => {
    assert.equal(pixelsPerCm(MON), 40);
    assert.equal(pixelsPerCm({...MON, width: 2000}), 80);
});

test('pixelsPerCm falls back to 96 DPI for unusable sizes', () => {
    const fallback = 96 / 2.54;
    for (const [widthMm, heightMm] of [
        [0, 0], [0, 150], [250, 0], [16, 9], [16, 10], [160, 90], [160, 100],
        [1600, 900], [1600, 1000],
        [5000, 3000], // implied DPI far below 50
        [20, 12],     // implied DPI far above 400
        [undefined, undefined], [NaN, NaN], [-250, -150],
    ])
        assert.equal(pixelsPerCm({...MON, widthMm, heightMm}), fallback, `${widthMm}x${heightMm}`);
});

test('zones use the fallback size on a placeholder monitor', () => {
    const mon = {...MON, widthMm: 160, heightMm: 90};
    const px = 96 / 2.54; // about 37.8
    assert.equal(decideTile({pointer: {x: 37, y: 0}, monitors: [mon]}).tile, 'top-left');
    assert.equal(decideTile({pointer: {x: Math.ceil(px) + 1, y: 0}, monitors: [mon]}).tile, 'full');
});

// Two monitors side by side, different size and density.
const LEFT = {
    x: 0, y: 0, width: 1000, height: 600, widthMm: 250, heightMm: 150,
    workArea: {x: 0, y: 30, width: 1000, height: 570},
};
const RIGHT = {
    x: 1000, y: 0, width: 2000, height: 600, widthMm: 500, heightMm: 150, // 40 px/cm too
    workArea: {x: 1000, y: 0, width: 2000, height: 600},
};
const pair = (x, y, extra) => decideTile({pointer: {x, y}, monitors: [LEFT, RIGHT], ...extra});

test('no zone on the edge where another monitor connects', () => {
    assert.equal(pair(999, 300), null);
    assert.equal(pair(1000, 300), null);
    assert.equal(pair(999, 100), null);
});

test('free edges of both monitors still have zones', () => {
    assert.equal(pair(0, 300).tile, 'left');
    assert.equal(pair(2999, 300).tile, 'right');
    assert.equal(pair(500, 0).tile, 'full');
    assert.equal(pair(1500, 0).tile, 'full');
});

test('corner next to a neighbour falls back to the remaining free edge', () => {
    // top-right of the left monitor: right edge is shared, top edge is free
    assert.equal(pair(999, 0).tile, 'full');
    // bottom-right of the left monitor: bottom edge is free, so thirds
    assert.equal(pair(999, 599).tile, 'third-3');
    // corners on the free sides stay quarters
    assert.equal(pair(0, 0).tile, 'top-left');
    assert.equal(pair(2999, 599).tile, 'bottom-right');
});

test('quarters and thirds are placed in the work area of the monitor under the pointer', () => {
    assert.deepEqual(pair(2999, 0).rect, {x: 2000, y: 0, width: 1000, height: 300});
    assert.deepEqual(pair(2000, 599).rect, {x: 1667, y: 0, width: 667, height: 600});
});

test('a monitor only blocks the part of the edge it actually touches', () => {
    const small = {...LEFT, height: 300, workArea: {x: 0, y: 30, width: 1000, height: 270}};
    const monitors = [small, RIGHT];
    assert.equal(decideTile({pointer: {x: 999, y: 100}, monitors}), null);
    // monitors that merely touch at a corner do not block anything
    const diag = {...RIGHT, y: 300, workArea: {x: 1000, y: 300, width: 2000, height: 600}};
    assert.equal(decideTile({pointer: {x: 999, y: 100}, monitors: [small, diag]}).tile, 'top-half');
});

test('zones are sized per monitor', () => {
    const dense = { // 80 px per cm: 1 cm = 80 px
        x: 0, y: 0, width: 2000, height: 1200, widthMm: 250, heightMm: 150,
        workArea: {x: 0, y: 0, width: 2000, height: 1200},
    };
    const d = (x, y) => decideTile({pointer: {x, y}, monitors: [dense]})?.tile ?? null;
    assert.equal(d(79, 0), 'top-left');
    assert.equal(d(80, 0), 'full');
    assert.equal(d(0, 239), 'top-half');
    assert.equal(d(0, 240), 'left');
    assert.deepEqual(decideTile({pointer: {x: 0, y: 0}, monitors: [dense]}).look, {radius: 16, margin: 7});
});

test('a pointer outside every monitor gives no tile', () => {
    assert.equal(at(-5, 100), null);
    assert.equal(at(1000, 100), null);
});

test('a pointer that moves to another monitor drops the merge', () => {
    const state = pair(500, 599).state;
    const r = pair(1500, 599, {state});
    assert.equal(r.tile, 'third-1');
});

test('a large low-density monitor keeps its real size', () => {
    // 1920 px on 1200 mm (about 40 DPI): 16 px per cm, not the 96 DPI fallback
    const tv = {...MON, width: 1920, widthMm: 1200, height: 1080, heightMm: 680};
    assert.equal(pixelsPerCm(tv), 16);
});
