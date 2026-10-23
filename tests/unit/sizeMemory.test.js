import test from 'node:test';
import assert from 'node:assert/strict';

import {SizeMemory} from '../../src/sizeMemory.js';

const SIZE = {width: 640, height: 480};

test('restores the size from before tiling', () => {
    const memory = new SizeMemory();
    memory.remember('w1', SIZE);
    assert.deepEqual(memory.restore('w1'), SIZE);
});

test('keeps the first size when a tiled window is tiled again', () => {
    const memory = new SizeMemory();
    memory.remember('w1', SIZE);
    memory.remember('w1', {width: 500, height: 500});
    assert.deepEqual(memory.restore('w1'), SIZE);
});

test('restoring forgets the size, the next tiling remembers a new one', () => {
    const memory = new SizeMemory();
    memory.remember('w1', SIZE);
    memory.restore('w1');
    assert.equal(memory.restore('w1'), null);
    memory.remember('w1', {width: 300, height: 200});
    assert.deepEqual(memory.restore('w1'), {width: 300, height: 200});
});

test('a window that never had a free size gets none invented', () => {
    const memory = new SizeMemory();
    memory.remember('w1', null);
    memory.remember('w1', SIZE); // already tiled: must not pick up the tiled size
    assert.equal(memory.restore('w1'), null);
});

test('a window SnapTile never tiled has nothing to restore', () => {
    assert.equal(new SizeMemory().restore('w9'), null);
});

test('windows are independent and can be forgotten', () => {
    const memory = new SizeMemory();
    memory.remember('a', SIZE);
    memory.remember('b', {width: 10, height: 10});
    memory.forget('a');
    assert.equal(memory.restore('a'), null);
    assert.deepEqual(memory.restore('b'), {width: 10, height: 10});
});

test('the stored size is a copy', () => {
    const memory = new SizeMemory();
    const size = {width: 1, height: 2};
    memory.remember('w', size);
    size.width = 99;
    assert.deepEqual(memory.restore('w'), {width: 1, height: 2});
});
