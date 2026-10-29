// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 muse83

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Settings key of each shortcut -> the Tile it snaps the focused window to.
const SHORTCUTS = {
    'tile-left-third': 'third-1',
    'tile-middle-third': 'third-2',
    'tile-right-third': 'third-3',
};

/**
 * Keyboard shortcuts that snap the focused window into a Tile, through the same path a drop
 * takes. The keys are in the settings schema, so they can be changed with gsettings or dconf.
 * They work in the normal desktop only, not in the overview or on the lock screen. The
 * `thirds-shortcuts` switch in the settings turns them on and off while the extension runs.
 * destroy() removes them.
 */
export class KeyboardTiling {
    constructor(settings, dragSnap) {
        this._settings = settings;
        this._dragSnap = dragSnap;
        this._added = [];
        this._changedId = 0;
    }

    /** Call from the extension's enable(). */
    enable() {
        this._changedId = this._settings.connect('changed::thirds-shortcuts', () => this._sync());
        this._sync();
    }

    /** Call from the extension's disable(). */
    destroy() {
        if (this._changedId)
            this._settings.disconnect(this._changedId);
        this._changedId = 0;
        this._removeKeybindings();
    }

    _sync() {
        this._removeKeybindings();
        if (!this._settings.get_boolean('thirds-shortcuts'))
            return;
        for (const [key, tile] of Object.entries(SHORTCUTS)) {
            Main.wm.addKeybinding(key, this._settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL,
                () => this._snapFocused(tile));
            this._added.push(key);
        }
    }

    _removeKeybindings() {
        for (const key of this._added)
            Main.wm.removeKeybinding(key);
        this._added = [];
    }

    _snapFocused(tile) {
        const window = global.display.focus_window;
        if (window)
            this._dragSnap.snapToTile(window, tile);
    }
}
