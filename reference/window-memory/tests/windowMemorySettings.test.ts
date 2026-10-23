// REFERENCE ONLY - NOT PART OF SnapTile. It imports modules SnapTile does not have.
// See ../README.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import WindowMemorySettings, {
    KEY_REMEMBERED_WINDOWS,
} from '../src/settings/windowMemorySettings.ts';
import { MemoryStorage } from '../src/settings/storage.ts';

const frame = { x: 1, y: 2, width: 300, height: 200 };

function setup(stored?: string) {
    const storage = new MemoryStorage();
    if (stored !== undefined) storage.setString(KEY_REMEMBERED_WINDOWS, stored);
    return { storage, memory: new WindowMemorySettings(storage) };
}

test('nothing stored reads as nothing remembered', () => {
    assert.deepEqual(setup().memory.entries, {});
});

test('broken stored data reads as nothing remembered', () => {
    assert.deepEqual(setup('{oops').memory.entries, {});
    assert.deepEqual(setup('[1,2]').memory.entries, {});
});

test('corrupt entries are dropped, good ones kept', () => {
    const { memory } = setup(
        JSON.stringify({ good: { frame }, bad: { frame: { x: 1 } } })
    );
    assert.deepEqual(memory.entries, { good: { frame } });
});

test('written entries read back', () => {
    const { memory } = setup();
    memory.setEntries({ app: { frame, maximized: true } });
    assert.deepEqual(memory.entries, { app: { frame, maximized: true } });
});

test('clear forgets everything', () => {
    const { storage, memory } = setup(JSON.stringify({ app: { frame } }));
    memory.clear();
    assert.deepEqual(memory.entries, {});
    assert.equal(storage.getString(KEY_REMEMBERED_WINDOWS), '{}');
});
