// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 muse83

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {tileRect} from './tileDecision.js';

// How far Mutter's half may differ from SnapTile's, for an odd screen width. It must stay smaller
// than the Window margin, or a window SnapTile put into a Tile itself would pass for a half.
const HALF_SLACK_PX = 1;

/**
 * Turns a window that GNOME put into the left or right half of the screen (Super+Left,
 * Super+Right; Mutter sees it as maximised in one direction only) into a window in SnapTile's
 * left or right half Tile. GNOME gives such a window the whole half with no gap around it, so
 * without this only SnapTile's own tiling would have the Window margin. As a Tile the window
 * also gets the window memory and the Third shortcuts like any other tiled window (ADR 0017).
 * Maximised windows are left alone: they have no margin. Everything it adds is removed again by
 * destroy().
 */
export class GnomeHalves {
    constructor(dragSnap) {
        this._dragSnap = dragSnap;
        this._windows = new Map(); // window -> ids of its signals
        this._createdId = 0;
        this._pending = new Map(); // window -> id of its idle source
    }

    /** Call from the extension's enable(). Also takes windows that are in a GNOME half already. */
    enable() {
        this._createdId = global.display.connect('window-created',
            (display, window) => this._watch(window));
        for (const actor of global.get_window_actors())
            this._watch(actor.meta_window);
    }

    /** Call from the extension's disable(). */
    destroy() {
        if (this._createdId)
            global.display.disconnect(this._createdId);
        this._createdId = 0;
        for (const [window, ids] of this._windows)
            ids.forEach(id => window.disconnect(id));
        this._windows.clear();
        for (const id of this._pending.values())
            GLib.source_remove(id);
        this._pending.clear();
    }

    _watch(window) {
        if (this._windows.has(window))
            return;
        const check = () => this._check(window);
        const ids = ['notify::maximized-vertically', 'notify::maximized-horizontally', 'size-changed']
            .map(name => window.connect(name, check));
        ids.push(window.connect('unmanaged', () => {
            this._windows.delete(window);
            this._cancel(window);
        }));
        this._windows.set(window, ids);
        check();
    }

    _check(window) {
        if (!this._halfOf(window) || this._pending.has(window))
            return;
        // Not inside Mutter's own handling of the tiling: it would undo what is done there. By
        // the time it runs the window may have been maximised, moved on or closed, so it looks again.
        this._pending.set(window, GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._pending.delete(window);
            const tile = this._halfOf(window);
            if (tile)
                this._dragSnap.snapToTile(window, tile);
            return GLib.SOURCE_REMOVE;
        }));
    }

    // 'left' or 'right' if GNOME has the window in that half right now, otherwise null. The flags
    // change before the window has its new size, so the half is told by the frame as well, and
    // the check runs again at every size change until the frame is that of a half. A window that
    // SnapTile put into a Tile sits a margin inside it: that is not a half, or the old frame
    // would be taken for the new half when GNOME moves the window on to the other one. (With a
    // margin of 0 or 1 px that cannot be told apart; the window is then just tiled again.)
    _halfOf(window) {
        const monitor = window.get_monitor();
        if (!window.maximized_vertically || window.maximized_horizontally || monitor < 0)
            return null;
        const frame = window.get_frame_rect();
        const {x, y, width, height} = Main.layoutManager.getWorkAreaForMonitor(monitor);
        return ['left', 'right'].find(name => {
            const half = tileRect(name, {x, y, width, height});
            return ['x', 'y', 'width', 'height'].every(side =>
                Math.abs(frame[side] - half[side]) <= HALF_SLACK_PX);
        }) ?? null;
    }

    _cancel(window) {
        const id = this._pending.get(window);
        if (id)
            GLib.source_remove(id);
        this._pending.delete(window);
    }
}
