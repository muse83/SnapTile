import test from 'node:test';
import assert from 'node:assert/strict';

import {TiledWindows} from '../../src/tiledWindows.js';

const SIZE = {width: 640, height: 480};
const LEFT = {x: 0, y: 32, width: 640, height: 688}; // the rectangle of the Tile the window sits in
const RIGHT = {x: 640, y: 32, width: 640, height: 688};

test('tells the Tile a window sits in and its size from before tiling', () => {
    const tiled = new TiledWindows();
    tiled.tile('w1', 'left', SIZE, LEFT);
    assert.deepEqual(tiled.get('w1'), {tile: 'left', sizeBefore: SIZE, frame: LEFT});
});

test('a window SnapTile never tiled is not in any Tile', () => {
    const tiled = new TiledWindows();
    assert.equal(tiled.get('w9'), null);
    assert.equal(tiled.release('w9'), null);
});

test('tiling again moves the window to the new Tile but keeps the first size', () => {
    const tiled = new TiledWindows();
    tiled.tile('w1', 'left', SIZE, LEFT);
    tiled.tile('w1', 'right', {width: 500, height: 500}, RIGHT);
    assert.deepEqual(tiled.get('w1'), {tile: 'right', sizeBefore: SIZE, frame: RIGHT});
});

test('releasing hands back the size from before and ends the tiling', () => {
    const tiled = new TiledWindows();
    tiled.tile('w1', 'left', SIZE, LEFT);
    assert.deepEqual(tiled.release('w1'), SIZE);
    assert.equal(tiled.get('w1'), null);
    assert.equal(tiled.release('w1'), null);
});

test('the next tiling after a release remembers a new size', () => {
    const tiled = new TiledWindows();
    tiled.tile('w1', 'left', SIZE, LEFT);
    tiled.release('w1');
    tiled.tile('w1', 'full', {width: 300, height: 200}, LEFT);
    assert.deepEqual(tiled.get('w1'), {tile: 'full', sizeBefore: {width: 300, height: 200}, frame: LEFT});
});

test('a window that never had a free size gets none invented from its Tile', () => {
    const tiled = new TiledWindows();
    tiled.tile('w1', 'left', null, LEFT);
    assert.deepEqual(tiled.get('w1'), {tile: 'left', sizeBefore: null, frame: LEFT});
    assert.equal(tiled.release('w1'), null);
});

test('tiling again fills in a size that was unknown, but never replaces a known one', () => {
    const tiled = new TiledWindows();
    tiled.tile('w1', 'left', null, LEFT);
    tiled.tile('w1', 'right', SIZE, RIGHT);
    assert.deepEqual(tiled.get('w1'), {tile: 'right', sizeBefore: SIZE, frame: RIGHT});
    tiled.tile('w1', 'left', {width: 1, height: 1}, LEFT);
    assert.deepEqual(tiled.get('w1').sizeBefore, SIZE);
});

test('windows are independent', () => {
    const tiled = new TiledWindows();
    tiled.tile('a', 'left', SIZE, LEFT);
    tiled.tile('b', 'right', {width: 10, height: 10}, RIGHT);
    tiled.release('a');
    assert.equal(tiled.get('a'), null);
    assert.deepEqual(tiled.get('b'), {tile: 'right', sizeBefore: {width: 10, height: 10}, frame: RIGHT});
});

test('clearing forgets every window', () => {
    const tiled = new TiledWindows();
    tiled.tile('a', 'left', SIZE, LEFT);
    tiled.tile('b', 'right', SIZE, LEFT);
    tiled.clear();
    assert.equal(tiled.get('a'), null);
    assert.equal(tiled.get('b'), null);
});

test('stored and returned sizes and rectangles are copies', () => {
    const tiled = new TiledWindows();
    const size = {width: 1, height: 2};
    const frame = {...LEFT};
    tiled.tile('w', 'left', size, frame);
    size.width = 99;
    frame.x = 99;
    tiled.get('w').sizeBefore.height = 99;
    tiled.get('w').frame.y = 99;
    assert.deepEqual(tiled.get('w').sizeBefore, {width: 1, height: 2});
    assert.deepEqual(tiled.get('w').frame, LEFT);
});
