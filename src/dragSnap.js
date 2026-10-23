import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {anchoredOrigin, decideTile} from './tileDecision.js';
import {SizeMemory} from './sizeMemory.js';
import {MonitorSizes} from './monitorSizes.js';
import {TilePreview} from './tilePreview.js';

// How often the pointer is read during a drag. The shell offers no pointer signal while
// Mutter holds the window grab, so it is polled (see docs/research/edge-tiling-feasibility.md).
const POLL_INTERVAL_MS = 30;
// How long a snapped window gets to reach its final size (it has in 100 ms in every test).
const SETTLE_MS = 150;

/**
 * Drag a window to an Edge zone, see the Tile preview, release to snap. Dragging a tiled
 * window out gives it back the size it had before. Everything it creates (signals, timer,
 * preview) is removed by destroy().
 */
export class DragSnap {
    constructor() {
        this._memory = new SizeMemory();
        this._monitorSizes = new MonitorSizes();
        this._preview = new TilePreview();
        this._tiled = new Map(); // window id -> {window, unmanagedId, settleId}
        this._drag = null; // {window, state, sourceId} while a move is running
        this._signals = [];
    }

    /** Call from the extension's enable(). */
    enable() {
        this._monitorSizes.refresh();
        this._signals.push(
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed',
                () => this._monitorSizes.refresh())],
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
        for (const entry of this._tiled.values()) {
            this._stopSettling(entry);
            entry.window.disconnect(entry.unmanagedId);
        }
        this._tiled.clear();
        this._monitorSizes.destroy();
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

        this._restoreSize(window);
        this._drag = {window, state: null, sourceId: 0};
        this._drag.sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL_MS, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _onGrabEnd(window, op) {
        if (op !== Meta.GrabOp.MOVING || this._drag?.window !== window)
            return;

        const result = this._decide();
        this._stopPolling();
        this._preview.hide();
        if (result)
            this._snap(window, result);
    }

    _update() {
        const result = this._decide();
        if (result)
            this._preview.show(this._drag.window, result.rect);
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

    _snap(window, {rect, workArea}) {
        const frame = window.get_frame_rect();
        this._memory.remember(window.get_id(), {width: frame.width, height: frame.height});
        const entry = this._track(window);

        if (window.is_maximized())
            window.unmaximize();
        window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
        // A window with a minimum size larger than the Tile ends up bigger than asked for,
        // and Mutter then leaves it where the drag put it. Once the size has settled, hang
        // it on the Tile's top left corner (the Tile itself stays as it is).
        this._stopSettling(entry);
        entry.settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            entry.settleId = 0;
            const settled = window.get_frame_rect();
            const origin = anchoredOrigin(rect, settled, workArea);
            if (origin.x !== settled.x || origin.y !== settled.y)
                window.move_frame(true, origin.x, origin.y);
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopSettling(entry) {
        if (entry.settleId) {
            GLib.source_remove(entry.settleId);
            entry.settleId = 0;
        }
    }

    /** Gives a tiled window its earlier size back when it is dragged out of the Tile. */
    _restoreSize(window) {
        const size = this._untrack(window);
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
        if (!this._tiled.has(id)) {
            const unmanagedId = window.connect('unmanaged', () => this._untrack(window));
            this._tiled.set(id, {window, unmanagedId, settleId: 0});
        }
        return this._tiled.get(id);
    }

    /** Stops tracking a window and returns the size it had before tiling, if any. */
    _untrack(window) {
        const id = window.get_id();
        const entry = this._tiled.get(id);
        if (entry) {
            this._stopSettling(entry);
            window.disconnect(entry.unmanagedId);
            this._tiled.delete(id);
        }
        return this._memory.restore(id);
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
