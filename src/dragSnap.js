// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 muse83

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {anchoredOrigin, decideTile, tileRect} from './tileDecision.js';
import {TilePreview} from './tilePreview.js';

// How often the pointer is read during a drag. The shell offers no pointer signal while
// Mutter holds the window grab, so it is polled (see docs/research/edge-tiling-feasibility.md).
const POLL_INTERVAL_MS = 30;

/**
 * Drag a window to an Edge zone, see the Tile preview, release to snap. Dragging a tiled
 * window out gives it back the size it had before. It records every tiled window (Tile and
 * size from before) in the TiledWindows it is given, which the extension owns and clears.
 * Everything it creates itself (signals, timer, preview) is removed by destroy().
 *
 * The window memory puts a reopened window into its Tile through snapWindow(), the same path a
 * drop takes, but with the earlier size it remembered (or none) instead of the current one.
 */
export class DragSnap {
    constructor(monitorSizes, tiledWindows) {
        this._tiledWindows = tiledWindows;
        this._monitorSizes = monitorSizes;
        this._preview = new TilePreview();
        this._tracked = new Map(); // window id -> {window, unmanagedId, sizeChangedId}
        this._drag = null; // {window, state, sourceId} while a move is running
        this._signals = [];
    }

    /** Call from the extension's enable(). */
    enable() {
        this._signals.push(
            [global.display, global.display.connect('grab-op-begin',
                (display, window, op) => this._onGrabBegin(window, op))],
            [global.display, global.display.connect('grab-op-end',
                (display, window, op) => this._onGrabEnd(window, op))]);
    }

    /** Call from the extension's disable(). Also ends a drag that is still running. */
    destroy() {
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];

        this._stopPolling();
        this._preview.destroy();
        for (const entry of this._tracked.values()) {
            this._stopAnchoring(entry);
            entry.window.disconnect(entry.unmanagedId);
        }
        this._tracked.clear();
    }

    _onGrabBegin(window, op) {
        if (!window)
            return;
        if (op !== Meta.GrabOp.MOVING) {
            // Resized or moved by keyboard: the window no longer sits in its Tile.
            this._untrack(window);
            return;
        }
        if (!isTileable(window))
            return;

        this._drag = {window, state: null, sourceId: 0, tiled: null};
        this._restoreSize(window);
        this._drag.sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_MS, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _onGrabEnd(window, op) {
        if (op !== Meta.GrabOp.MOVING || this._drag?.window !== window)
            return;

        // Escape cancels the drag: Mutter puts the window back and ends the grab while the
        // button is still held. Only a release counts as a drop.
        const [, , modifiers] = global.get_pointer();
        const cancelled = (modifiers & Clutter.ModifierType.BUTTON1_MASK) !== 0;
        const result = cancelled ? null : this._decide();
        const {tiled} = this._drag;
        this._stopPolling();
        this._preview.hide();

        if (result)
            this._snap(window, result);
        else if (cancelled && tiled)
            this.snapWindow(window, {rect: tiled.frame, workArea: this._workAreaOf(window), tile: tiled.tile},
                tiled.sizeBefore);
    }

    _update() {
        const result = this._decide();
        if (result)
            this._preview.show(this._drag.window, result.visible, result.look.radius);
        else
            this._preview.hide();
    }

    /** The Tile under the pointer right now, remembering the thirds state for the next call. */
    _decide() {
        const [x, y] = global.get_pointer();
        const monitors = Main.layoutManager.monitors.map((monitor, index) => ({
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
            ...this._monitorSizes.get(index),
            workArea: plainRect(Main.layoutManager.getWorkAreaForMonitor(index)),
        }));
        const result = decideTile({pointer: {x, y}, monitors, state: this._drag.state});
        this._drag.state = result?.state ?? null;
        return result;
    }

    /** A drop: the window's size now is the size to give back when it is dragged out. */
    _snap(window, result) {
        const frame = window.get_frame_rect();
        this.snapWindow(window, result, {width: frame.width, height: frame.height});
    }

    /**
     * Puts a window into a Tile and records it as tiled.
     * @param {{rect, workArea, tile}} result the Tile, its rectangle and the work area it is in
     * @param {?{width: number, height: number}} sizeBefore the size to give back when the
     *   window is dragged out of the Tile; null if the window never had a free size, it then
     *   keeps its own
     */
    snapWindow(window, {rect, workArea, tile}, sizeBefore) {
        this._tiledWindows.tile(window.get_id(), tile, sizeBefore, rect);
        const entry = this._track(window);

        if (window.is_maximized())
            window.unmaximize();
        window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
        // A window with a minimum size larger than the Tile ends up bigger than asked for,
        // and Mutter then leaves it where the drag put it. So hang a window that is too big
        // on the Tile's top left corner (the Tile itself stays as it is): right away, when
        // the size is already final, and again whenever the size changes, until it is
        // dragged out or the extension is disabled. No guess about how long that takes.
        this._stopAnchoring(entry);
        const anchor = () => {
            if (window.is_maximized() || window.is_fullscreen())
                return;
            const current = window.get_frame_rect();
            if (current.width <= rect.width && current.height <= rect.height)
                return;
            const origin = anchoredOrigin(rect, current, workArea);
            if (origin.x !== current.x || origin.y !== current.y)
                window.move_frame(true, origin.x, origin.y);
        };
        entry.sizeChangedId = window.connect('size-changed', anchor);
        anchor();
    }

    /**
     * Puts a window into the named Tile on the monitor it is on, as a keyboard shortcut does.
     * Does nothing for a window that cannot be tiled. A maximised window has no free size to
     * give back (its frame is the whole screen), so it gets none; an already tiled one keeps
     * the size from before its first tiling.
     */
    snapToTile(window, tile) {
        if (!isTileable(window))
            return;
        const workArea = this._workAreaOf(window);
        const frame = window.get_frame_rect();
        const sizeBefore = window.is_maximized() ? null : {width: frame.width, height: frame.height};
        this.snapWindow(window, {rect: tileRect(tile, workArea), workArea, tile}, sizeBefore);
    }

    _workAreaOf(window) {
        return plainRect(Main.layoutManager.getWorkAreaForMonitor(window.get_monitor()));
    }

    _stopAnchoring(entry) {
        if (entry.sizeChangedId) {
            entry.window.disconnect(entry.sizeChangedId);
            entry.sizeChangedId = 0;
        }
    }

    /** Gives a tiled window its earlier size back when it is dragged out of the Tile. */
    _restoreSize(window) {
        const record = this._tiledWindows.get(window.get_id());
        const size = this._untrack(window);
        // What Escape needs to put the window back into its Tile, also if it has no earlier size.
        if (record)
            this._drag.tiled = {frame: record.frame, tile: record.tile, sizeBefore: size};
        if (!size)
            return;

        // Keep the pointer at the same relative place along the window, so it stays in hand.
        const [pointerX] = global.get_pointer();
        const frame = window.get_frame_rect();
        const x = Math.round(pointerX - size.width * (pointerX - frame.x) / frame.width);
        window.move_resize_frame(true, x, frame.y, size.width, size.height);
    }

    _track(window) {
        const id = window.get_id();
        if (!this._tracked.has(id)) {
            const unmanagedId = window.connect('unmanaged', () => this._untrack(window));
            this._tracked.set(id, {window, unmanagedId, sizeChangedId: 0});
        }
        return this._tracked.get(id);
    }

    /** Stops tracking a window and returns the size it had before tiling, if any. */
    _untrack(window) {
        const id = window.get_id();
        const entry = this._tracked.get(id);
        if (entry) {
            this._stopAnchoring(entry);
            window.disconnect(entry.unmanagedId);
            this._tracked.delete(id);
        }
        return this._tiledWindows.release(id);
    }

    _stopPolling() {
        if (this._drag?.sourceId)
            GLib.source_remove(this._drag.sourceId);
        this._drag = null;
    }
}

function isTileable(window) {
    return window.get_window_type() === Meta.WindowType.NORMAL &&
        window.allows_move() && window.allows_resize() && !window.is_fullscreen();
}

function plainRect({x, y, width, height}) {
    return {x, y, width, height};
}
