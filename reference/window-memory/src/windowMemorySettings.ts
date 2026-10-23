// REFERENCE ONLY - NOT PART OF SnapTile. It imports modules SnapTile does not have.
// See ../README.md.

// The window memory group of the settings module (ADR 0008): the remembered frame per
// application, stored as one text value. Unreadable data reads as nothing remembered.
// Free of any GNOME API so it can be tested with plain Node.
import {
    parseRememberedFrames,
    type RememberedFrames,
} from '../components/windowMemory/frameMemory.ts';
import type { SettingsStorage } from './storage';

export const KEY_REMEMBERED_WINDOWS = 'remembered-windows';

export default class WindowMemorySettings {
    private readonly _storage: SettingsStorage;

    constructor(storage: SettingsStorage) {
        this._storage = storage;
    }

    get entries(): RememberedFrames {
        return parseRememberedFrames(
            this._storage.getString(KEY_REMEMBERED_WINDOWS)
        );
    }

    setEntries(entries: RememberedFrames) {
        this._storage.setString(
            KEY_REMEMBERED_WINDOWS,
            JSON.stringify(entries)
        );
    }

    clear() {
        this.setEntries({});
    }
}
