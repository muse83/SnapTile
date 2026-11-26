// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 muse83

import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {clearOfEdges} from './tileDecision.js';
import {LOOK_TYPES} from './windowLook.js';

// How often a window is pulled in again without the user touching it before SnapTile gives up
// on it: an application that puts its window back where it wants it after every move (some
// X11 applications do) would otherwise be moved back and forth for ever.
const MAX_CORRECTIONS = 3;

/**
 * Gives every free window the Window margin (ADR 0018): a window that is in no Tile, not
 * maximised, not in a GNOME half and not full screen is kept one margin away from every edge of
 * its monitor's work area (top bar, dock, screen edge) that it is inside of, as a tiled window
 * is kept from the edges of its Tile. It is moved, and made smaller if it does not fit. This
 * happens when the window shows, when it changes size or place on its own (an application, an
 * unmaximise), when the user lets go of it after moving or resizing it, and when the work areas
 * change; never while the user holds it. Everything it adds is removed again by destroy().
 *
 * Mutter tells a window's new frame only once the application has taken it, so a frame read
 * while a resize is on its way is the old one, and moving the window on from there would make
 * Mutter drop the resize. So a window is left alone while it waits for a new frame: after it
 * left the maximised state, and after place(), through which the window memory puts a free
 * window at its remembered place. Any new size or place ends the wait, also one that is not
 * what was asked for (an application that keeps its size, a terminal on its character grid).
 */
export class FreeMargin {
    constructor(monitorSizes, tiledWindows) {
        this._monitorSizes = monitorSizes;
        this._tiledWindows = tiledWindows;
        this._monitorSizes.watch(() => this._checkAll());
        // window -> {ids, shown, held, idleId, maximized, awaited, corrections}; awaited is
        // whether a new frame is on its way (after place() or an unmaximise); corrections counts
        // the times the window was pulled in since the user last touched it.
        this._windows = new Map();
        this._signals = [];
        this._enabled = false;
    }

    /** Call from the extension's enable(). */
    enable() {
        this._enabled = true;
        // DragSnap records a drop into a Tile in its own grab-op-end handler; the check here
        // runs later, from an idle callback, so it finds the window tiled whatever the order.
        this._signals.push(
            [global.display, global.display.connect('window-created',
                (display, window) => this._watch(window, false))],
            [global.display, global.display.connect('grab-op-begin',
                (display, window) => this._hold(window, true))],
            [global.display, global.display.connect('grab-op-end',
                (display, window) => this._hold(window, false))],
            [global.display, global.display.connect('workareas-changed',
                () => this._checkAll())],
            [global.window_manager, global.window_manager.connect('map',
                (manager, actor) => this._shown(actor.meta_window))]);
        for (const actor of global.get_window_actors())
            this._watch(actor.meta_window, true);
    }

    /** Call from the extension's disable(). */
    destroy() {
        this._enabled = false;
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        for (const window of [...this._windows.keys()])
            this._unwatch(window);
    }

    /**
     * Puts a free window at `rect` ({x, y, width, height}), pulled in where it would come closer
     * to an edge of the work area than the margin, and leaves it alone until it is there.
     */
    place(window, rect) {
        const monitor = monitorOf(rect) ?? window.get_monitor();
        const wanted = monitor < 0 ? null : clearOfEdges(rect, workAreaOf(monitor),
            this._monitorSizes.lookOf(monitor).margin);
        const frame = wanted ?? rect;
        const entry = this._windows.get(window);
        if (entry && !sameRect(frame, window.get_frame_rect()))
            entry.awaited = true;
        window.move_resize_frame(true, frame.x, frame.y, frame.width, frame.height);
    }

    _watch(window, shown) {
        // Menus and tooltips are never application windows: not worth watching.
        if (this._windows.has(window) || window.is_override_redirect())
            return;
        const entry = {
            ids: [], shown, held: false, idleId: 0, maximized: isMaximizedOrHalf(window),
            awaited: false, corrections: 0,
        };
        const arrived = () => {
            entry.awaited = false;
            this._schedule(window);
        };
        const maximizedChanged = () => {
            const maximized = isMaximizedOrHalf(window);
            if (entry.maximized && !maximized)
                entry.awaited = true;
            entry.maximized = maximized;
            this._schedule(window);
        };
        entry.ids.push(
            window.connect('notify::maximized-horizontally', maximizedChanged),
            window.connect('notify::maximized-vertically', maximizedChanged),
            window.connect('notify::fullscreen', () => this._schedule(window)),
            window.connect('size-changed', arrived),
            window.connect('position-changed', arrived),
            window.connect('unmanaged', () => this._unwatch(window)));
        this._windows.set(window, entry);
        this._schedule(window);
    }

    _unwatch(window) {
        const entry = this._windows.get(window);
        if (!entry)
            return;
        entry.ids.forEach(id => window.disconnect(id));
        if (entry.idleId)
            GLib.source_remove(entry.idleId);
        this._windows.delete(window);
    }

    // Before a window shows, Mutter has not placed it yet.
    _shown(window) {
        const entry = this._windows.get(window);
        if (!entry)
            return;
        entry.shown = true;
        this._schedule(window);
    }

    // The user holds the window: it goes where the pointer takes it, and what was awaited no
    // longer counts. Once let go it is checked, and may be pulled in again.
    _hold(window, held) {
        const entry = window && this._windows.get(window);
        if (!entry)
            return;
        entry.held = held;
        entry.awaited = false;
        entry.corrections = 0;
        this._schedule(window);
    }

    _checkAll() {
        if (!this._enabled)
            return;
        for (const window of this._windows.keys())
            this._schedule(window);
    }

    // Not inside Mutter's own handling of a size or place change, and once for many changes in a
    // row. By the time it runs the window may have been tiled, maximised or closed: it looks again.
    _schedule(window) {
        const entry = this._windows.get(window);
        if (!entry || entry.idleId || !entry.shown || entry.held || entry.awaited)
            return;
        entry.idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            entry.idleId = 0;
            if (!entry.held && !entry.awaited && entry.corrections < MAX_CORRECTIONS &&
                this._isFree(window) && this._keepMargin(window))
                entry.corrections++;
            return GLib.SOURCE_REMOVE;
        });
    }

    // Pulls the window in where it is too close to an edge; whether it had to.
    _keepMargin(window) {
        const monitor = window.get_monitor();
        const frame = window.get_frame_rect();
        const wanted = clearOfEdges({x: frame.x, y: frame.y, width: frame.width, height: frame.height},
            workAreaOf(monitor), this._monitorSizes.lookOf(monitor).margin);
        if (!wanted)
            return false;
        // A window that cannot be resized keeps its size; one too big for the work area is then
        // hung at the margin and reaches beyond the far edge, which counts as kept.
        if (window.allows_resize())
            window.move_resize_frame(true, wanted.x, wanted.y, wanted.width, wanted.height);
        else
            window.move_frame(true, wanted.x, wanted.y);
        return true;
    }

    _isFree(window) {
        return LOOK_TYPES.includes(window.get_window_type()) && window.allows_move() &&
            !window.is_attached_dialog() && !window.minimized &&
            !isMaximizedOrHalf(window) && !window.is_fullscreen() && window.get_monitor() >= 0 &&
            this._tiledWindows.get(window.get_id()) === null;
    }
}

// Maximised, or in one of GNOME's own halves (Mutter sees those as maximised in one direction).
function isMaximizedOrHalf(window) {
    return window.is_maximized() || window.maximized_horizontally || window.maximized_vertically;
}

function workAreaOf(monitor) {
    const {x, y, width, height} = Main.layoutManager.getWorkAreaForMonitor(monitor);
    return {x, y, width, height};
}

// The index of the monitor the centre of `rect` is on, or null if it is on none.
function monitorOf(rect) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const index = Main.layoutManager.monitors.findIndex(m =>
        cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height);
    return index < 0 ? null : index;
}

function sameRect(a, b) {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
