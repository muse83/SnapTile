// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 muse83

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {tileOfFrame} from './tileDecision.js';
import {appKeyOf, freeSizeFor, parsePlaces, placementFor, placementForSecondWindow, rememberInitialSize, rememberOnClose, rememberWindow, serialisePlaces} from './rememberedPlaces.js';

// The application of the Extensions manager; its windows include the preferences window of this
// extension, which runs in another process and must stay open while it closes the others.
const EXTENSIONS_APP_ID = 'org.gnome.Shell.Extensions';

// Every grab that resizes a window, by mouse or keyboard (GNOME 50 and 51 name them alike).
const RESIZE_OPS = new Set(Object.entries(Meta.GrabOp)
    .filter(([name]) => name.includes('RESIZING')).map(([, op]) => op));

/**
 * Window memory (ADR 0007, ADR 0009, ADR 0010, ADR 0011, ADR 0012, ADR 0015, ADR 0016): remembers the place of an application's window when the
 * user finishes moving or resizing it, when it closes and when the extension is disabled, and
 * puts the next new window of that application there: the size and position of a free window,
 * the Tile of a tiled one (through the drag's own snap path), or maximised. A new window of an
 * application that already has an open window is never put into a Tile or maximised: it opens
 * free and offset from the open window (placementForSecondWindow). The decisions live
 * in rememberedPlaces.js; this class connects them to the windows and to the settings. It
 * creates only signal connections, which destroy() removes; there is no timer.
 *
 * The switch "enabled" in the settings turns remembering and placing off without touching what
 * is stored. The preferences window clears the memory by resetting "places"; the copy kept
 * here follows every change of the stored text, so a clear reaches windows that are open now.
 *
 * A place is remembered with the monitor the window was on (by id, see MonitorSizes) and, for a
 * free window, its position relative to that monitor (ADR 0012). While Mutter has not told the
 * monitors' names (after the start, after the monitors changed) a save waits for the answer, so
 * the monitor it stores is the right one; what is still waiting when the extension is disabled
 * is saved without names, which keeps the monitor remembered before (rememberWindow).
 */
export class WindowMemory {
    /**
     * @param settings the extension's Gio.Settings
     * @param tiledWindows the shared TiledWindows
     * @param dragSnap the DragSnap, whose snap path puts a reopened window into its Tile
     * @param monitorSizes the MonitorSizes, to turn 1 cm into pixels for a second window and to
     *   tell the monitors apart
     */
    constructor(settings, tiledWindows, dragSnap, monitorSizes) {
        this._settings = settings;
        this._monitorSizes = monitorSizes;
        this._tiledWindows = tiledWindows;
        this._dragSnap = dragSnap;
        this._places = {};
        this._signals = [];
        // Every window watched until it closes: {closingId, arriving, unmaximizedId, savedAt,
        // forgotten, openingSizeId, openingSize}. Arriving marks a window created since enable
        // that is not placed yet; unmaximizedId is the wait for a window that maximised itself
        // to say it has its free size back; savedAt is when the window last saved its place (a
        // number from _saves, 0: never), to tell which of an application's windows saved last;
        // forgotten marks a window that was open when the memory was cleared: it saves nothing,
        // not even when it closes, until the user moves or resizes it again (see
        // _forgetOpenWindows); openingSizeId is the connection that follows an application
        // resizing its new window and openingSize the size it last stored (see
        // _rememberOpeningSize); grab is what the window was when the user took hold of it,
        // {free, size, op}, to tell a free resize (the only thing that replaces the application's
        // free size, ADR 0016) from a move or a resize out of a Tile.
        this._windows = new Map();
        this._saves = 0;
        // Saves that wait for the monitors' names, in order: functions that store the place.
        this._waiting = [];
    }

    /** Call from the extension's enable(). Windows that are open now are never moved. */
    enable() {
        this._places = parsePlaces(this._settings.get_string('places'));

        this._dragSnap.setDefaultSizeSource(window => this._defaultSizeOf(window));
        for (const actor of global.get_window_actors()) {
            this._watch(actor.meta_window, false);
            this._adoptIfTiled(actor.meta_window);
        }

        this._monitorSizes.whenSettled(() => this._runWaiting());

        // A request made while the extension was off is stale now and must not close anything.
        if (this._settings.get_boolean('close-all-windows'))
            this._settings.set_boolean('close-all-windows', false);

        this._signals.push(
            [this._settings, this._settings.connect('changed::places',
                () => this._followStoredPlaces())],
            [this._settings, this._settings.connect('changed::close-all-windows',
                () => this._closeAllWindows())],
            [global.display, global.display.connect('window-created',
                (display, window) => this._watch(window, true))],
            [global.display, global.display.connect('grab-op-begin',
                (display, window, op) => this._onGrabBegin(window, op))],
            [global.display, global.display.connect('grab-op-end',
                (display, window, op) => this._saveAfterGrab(window, op))],
            [global.window_manager, global.window_manager.connect('map',
                (manager, actor) => this._place(actor.meta_window))]);
    }

    /** Call from the extension's disable(). Saves every open window first (if switched on). */
    destroy() {
        this._dragSnap.setDefaultSizeSource(null);
        try {
            if (this._isMemoryOn()) {
                this._runWaiting();
                this._saveOpenWindows();
            }
            Gio.Settings.sync(); // the session may end right after disable, so write it out now
        } finally {
            this._waiting = [];
            for (const [object, id] of this._signals)
                object.disconnect(id);
            this._signals = [];
            for (const [window, entry] of this._windows) {
                window.disconnect(entry.closingId);
                if (entry.unmaximizedId)
                    window.disconnect(entry.unmaximizedId);
                this._stopFollowingOpeningSize(window);
            }
            this._windows.clear();
        }
    }

    /**
     * The free size the window's application is known to have, to give it back when it leaves a
     * Tile (ADR 0015), or null: none known, the window is left alone, or the memory is switched off.
     */
    _defaultSizeOf(window) {
        const key = this._isMemoryOn() ? appKeyOf(factsOf(window)) : null;
        return key === null ? null : freeSizeFor(this._places, key);
    }

    /**
     * A window that is open when the extension starts and sits in a Tile was tiled before (by
     * an earlier run): it is recorded as tiled again, with its application's free size, so
     * dragging it out gives that size back and saving it keeps its Tile (ADR 0015).
     */
    _adoptIfTiled(window) {
        if (this._isMemoryOn() && appKeyOf(factsOf(window)) !== null)
            this._dragSnap.adoptTiled(window, this._defaultSizeOf(window));
    }

    /** The switch of the preferences window: whether windows are remembered and placed. */
    _isMemoryOn() {
        return this._settings.get_boolean('enabled');
    }

    /**
     * The stored text changed. Our own writes arrive here too and are told apart by being the
     * text we hold; anything else (the clear button, a hand edit) replaces what we hold.
     */
    _followStoredPlaces() {
        const text = this._settings.get_string('places');
        if (text === serialisePlaces(this._places))
            return;
        this._places = parsePlaces(text);
        this._waiting = []; // they would bring back what was cleared or replaced
        // What the open windows saved is gone or replaced, so none of them has a later save
        // that its siblings must respect when they close.
        for (const entry of this._windows.values())
            entry.savedAt = 0;
        if (Object.keys(this._places).length === 0)
            this._forgetOpenWindows(); // cleared: the open windows must not fill it again
    }

    /**
     * The memory was cleared: every window that is open now forgets what it would have saved.
     * It saves nothing again, also not when it closes, until the user moves or resizes it.
     */
    _forgetOpenWindows() {
        for (const [window, entry] of this._windows) {
            entry.forgotten = true;
            this._stopFollowingOpeningSize(window);
        }
    }

    /**
     * The preferences window asks to clear the memory and close every window (it clears the
     * stored places itself). The windows are asked to close the way their close button does, so
     * an application may still ask about unsaved work or refuse; one that stays open saves
     * nothing until the user moves it. The preferences window of another process stays.
     */
    _closeAllWindows() {
        if (!this._settings.get_boolean('close-all-windows'))
            return;
        this._settings.set_boolean('close-all-windows', false);
        this._forgetOpenWindows();
        for (const actor of global.get_window_actors()) {
            const window = actor.meta_window;
            if (window.get_window_type() === Meta.WindowType.NORMAL &&
                window.get_gtk_application_id() !== EXTENSIONS_APP_ID)
                window.delete(global.get_current_time());
        }
    }

    _watch(window, arriving) {
        if (this._windows.has(window))
            return;
        const closingId = window.connect('unmanaging', () => {
            this._stopFollowingOpeningSize(window);
            this._saveOnClose(window);
            this._windows.delete(window); // the window is going away, its connections with it
        });
        this._windows.set(window, {closingId, arriving, unmaximizedId: 0, savedAt: 0, forgotten: false, openingSizeId: 0, openingSize: null, grab: null});
    }

    /**
     * What this window is, for saving: {key, state} (see rememberWindow), or null when the
     * window is left alone. A window maximised with the window button counts as maximised even
     * if it was tiled before; a tiled window is remembered by its Tile, whose rectangle is read
     * from the record (the window's own frame may still be the one from the drag).
     */
    _stateOf(window) {
        const key = appKeyOf(factsOf(window));
        if (key === null)
            return null;
        const tiled = this._tiledWindows.get(window.get_id());
        if (window.is_maximized()) {
            return {key, state: {
                frame: plainRect(window.get_frame_rect()),
                maximized: true,
                sizeBefore: tiled?.sizeBefore,
            }};
        }
        if (tiled)
            return {key, state: {frame: tiled.frame, tile: tiled.tile, sizeBefore: tiled.sizeBefore}};
        return {key, state: {frame: plainRect(window.get_frame_rect())}};
    }

    /**
     * The user took hold of a window to move or resize it. Notes what it is now: only a window
     * that is free (in no Tile, not maximised, not in a GNOME half) can have its size replaced
     * by the user resizing it (ADR 0016). Drag-to-snap has already let go of a tiled window when
     * a resize starts, so a Tile is told by the window's frame, as when SnapTile starts.
     */
    _onGrabBegin(window, op) {
        this._stopFollowingOpeningSize(window);
        const entry = this._windows.get(window);
        if (!entry)
            return;
        const {width, height} = window.get_frame_rect();
        entry.grab = {free: this._isFree(window), size: {width, height}, op};
    }

    /** Whether the window sits in no Tile and is not maximised, in a GNOME half or full screen. */
    _isFree(window) {
        if (isMaximizedOrHalf(window) || window.is_fullscreen() || this._tiledWindows.get(window.get_id()))
            return false;
        const monitor = window.get_monitor();
        return monitor < 0 || tileOfFrame(plainRect(window.get_frame_rect()),
            plainRect(Main.layoutManager.getWorkAreaForMonitor(monitor))) === null;
    }

    /**
     * The user let go of a window after moving or resizing it (mouse or keyboard). Drag-to-snap
     * handles the same signal first (it is enabled first) and records a snapped window as
     * tiled, so a drop into a Tile is saved as that Tile and not as a free place. The size is
     * saved as the application's free size only if a free window was resized (ADR 0016).
     */
    _saveAfterGrab(window, op) {
        const entry = this._windows.get(window);
        const grab = entry?.grab;
        if (entry)
            entry.grab = null;
        const found = entry && this._isMemoryOn() && this._stateOf(window);
        if (!found)
            return;
        if (grab?.free && (RESIZE_OPS.has(op) || RESIZE_OPS.has(grab.op))) {
            const {width, height} = window.get_frame_rect();
            found.state.resized = width !== grab.size.width || height !== grab.size.height;
        }
        entry.forgotten = false;
        entry.savedAt = ++this._saves;
        this._whenMonitorsKnown(() =>
            this._store(rememberWindow(this._places, found.key, found.state, this._monitors())));
    }

    /** A window closes: its place counts unless another window of the application saved later. */
    _saveOnClose(window) {
        const entry = this._windows.get(window);
        const found = this._isMemoryOn() && !entry.forgotten && this._stateOf(window);
        if (!found)
            return;
        const others = [...this._windows]
            .filter(([other]) => other !== window && appKeyOf(factsOf(other)) === found.key)
            .map(([, otherEntry]) => otherEntry.savedAt);
        const closingSavedAt = entry.savedAt;
        this._whenMonitorsKnown(() =>
            this._store(rememberOnClose(this._places, found.key, found.state, closingSavedAt, others,
                this._monitors())));
    }

    /** Runs the save now, or as soon as Mutter has told the monitors' names if it has not yet. */
    _whenMonitorsKnown(save) {
        if (this._monitorSizes.isSettled())
            save();
        else
            this._waiting.push(save);
    }

    /** Carries out the saves that waited for the monitors' names, if the memory is still on. */
    _runWaiting() {
        const waiting = this._waiting;
        this._waiting = [];
        if (!this._isMemoryOn())
            return;
        for (const save of waiting)
            save();
    }

    /**
     * The extension is being disabled: every open window saves its place, the one used most
     * recently last so that it wins.
     */
    _saveOpenWindows() {
        const recentFirst = global.display.get_tab_list(Meta.TabList.NORMAL, null);
        const rank = window => {
            const index = recentFirst.indexOf(window);
            return index === -1 ? recentFirst.length : index; // not in the list: oldest
        };
        const monitors = this._monitors();
        let places = this._places;
        const saving = [...this._windows.keys()].filter(window => !this._windows.get(window).forgotten);
        for (const window of saving.sort((a, b) => rank(b) - rank(a))) {
            const found = this._stateOf(window);
            if (found)
                places = rememberWindow(places, found.key, found.state, monitors);
        }
        this._store(places);
    }

    /** Keeps the places and writes them to the settings if they changed. */
    _store(places) {
        if (places === this._places)
            return;
        this._places = places;
        this._settings.set_string('places', serialisePlaces(places));
    }

    /** Called when a window is shown; places it if it is a new one with a remembered place. */
    _place(window) {
        const entry = this._windows.get(window);
        if (!entry?.arriving)
            return; // already open when the extension was enabled, or shown again after hiding
        entry.arriving = false;
        if (!this._isMemoryOn())
            return; // a window that opens while switched off is "already open" once it is on again

        const key = appKeyOf(factsOf(window));
        if (key === null)
            return;

        const siblings = this._openWindowsOf(window, key);
        const isSecond = siblings.length > 0;
        const placement = this._placementOf(window, key, siblings);
        this._rememberOpeningSize(window, key);
        if (placement === null)
            return;

        if (!window.is_maximized() || placement.kind === 'maximized') {
            this._put(window, placement);
            return;
        }
        // An application that maximises itself at start ignores a plain placement, and one
        // asked right after un-maximising loses it (a Tile too). So wait for the window to say
        // it is back to a free size (its next size change), then place it. See
        // docs/research/window-placement-on-wayland.md.
        entry.unmaximizedId = window.connect('size-changed', () => {
            window.disconnect(entry.unmaximizedId);
            entry.unmaximizedId = 0;
            if (window.is_fullscreen()) // full screen wins, a Tile must not be forced on it
                return;
            // A second window is asked again: its own default size is only known now. A first
            // window keeps its placement, also if a window of the application opened meanwhile.
            const placementNow = isSecond ?
                this._placementOf(window, key, this._openWindowsOf(window, key)) : placement;
            if (placementNow)
                this._put(window, placementNow);
        });
        window.unmaximize();
    }

    /**
     * The size a window opens with is its application's free size until the user changes it
     * (ADR 0015), so it is remembered the moment the window shows, unless the application knows
     * a free size already or the window does not open free (maximised or full screen). An
     * application may resize its window right after it showed (restoring its own size, as
     * Electron applications do); until the user takes hold of the window, or it is tiled,
     * maximised or closed, the remembered size follows those resizes.
     */
    _rememberOpeningSize(window, key) {
        if (isMaximizedOrHalf(window) || window.is_fullscreen() ||
            freeSizeFor(this._places, key) !== null)
            return;
        const entry = this._windows.get(window);
        this._storeOpeningSize(window, key);
        entry.openingSizeId = window.connect('size-changed', () => {
            if (!this._isMemoryOn() || isMaximizedOrHalf(window) || window.is_fullscreen() ||
                this._tiledWindows.get(window.get_id()) !== null) {
                this._stopFollowingOpeningSize(window);
                return;
            }
            const {width, height} = window.get_frame_rect();
            if (width !== entry.openingSize.width || height !== entry.openingSize.height)
                this._storeOpeningSize(window, key);
        });
    }

    /** Stores the window's frame as the opening size, replacing the one it stored itself before. */
    _storeOpeningSize(window, key) {
        const entry = this._windows.get(window);
        const frame = plainRect(window.get_frame_rect());
        const previous = entry.openingSize;
        entry.openingSize = {width: frame.width, height: frame.height};
        const remember = () =>
            this._store(rememberInitialSize(this._places, key, frame, this._monitors(), previous));
        // A known application needs no monitor name for this, so its size is there at once.
        if (Object.hasOwn(this._places, key))
            remember();
        else
            this._whenMonitorsKnown(remember);
    }

    _stopFollowingOpeningSize(window) {
        const entry = this._windows.get(window);
        if (entry?.openingSizeId) {
            window.disconnect(entry.openingSizeId);
            entry.openingSizeId = 0;
        }
    }

    /**
     * The monitors now: the id (undefined until Mutter has told it), the work area, and, as the
     * Edge zones need them, the size in pixels and (if known) millimetres.
     */
    _monitors() {
        return Main.layoutManager.monitors.map((monitor, index) => ({
            id: this._monitorSizes.idOf(index),
            width: monitor.width, height: monitor.height, ...this._monitorSizes.get(index),
            workArea: plainRect(Main.layoutManager.getWorkAreaForMonitor(index)),
        }));
    }

    /**
     * Where a new window of the application goes, or null to leave it to GNOME. The first
     * window gets the remembered place; a further one opens free and offset from the open
     * windows (ADR 0011). `siblings` are the application's other open windows, the most
     * recently used first.
     */
    _placementOf(window, key, siblings) {
        const monitors = this._monitors();
        if (siblings.length === 0)
            return placementFor(this._places, key, monitors);

        const {width, height} = window.get_frame_rect();
        return placementForSecondWindow(this._places, key, {
            defaultSize: {width, height},
            siblings: siblings.map(other => plainRect(other.get_frame_rect())),
            monitors,
        });
    }

    /**
     * Carries out a placement. A Tile goes through the drag's snap path with the earlier size
     * that was remembered (or none): the window's current size is its application's own default
     * and must not become "the size before tiling".
     */
    _put(window, placement) {
        switch (placement.kind) {
        case 'free':
            window.move_resize_frame(true, placement.rect.x, placement.rect.y,
                placement.rect.width, placement.rect.height);
            break;
        case 'tile':
            this._dragSnap.snapWindow(window, placement, placement.sizeBefore);
            break;
        case 'maximized':
            if (window.get_monitor() !== placement.monitor)
                window.move_to_monitor(placement.monitor);
            if (!window.is_maximized())
                window.maximize();
            break;
        }
    }

    /**
     * The application's other windows that are shown and not closing, the most recently used
     * first. A window that is only being created, or is fading out, does not count: two
     * windows opened together must not both be taken for the first, and a window opened right
     * after one was closed is the first.
     */
    _openWindowsOf(window, key) {
        const others = global.get_window_actors()
            .filter(actor => actor.meta_window !== window && actor.mapped &&
                this._windows.has(actor.meta_window) && appKeyOf(factsOf(actor.meta_window)) === key)
            .map(actor => actor.meta_window);
        const recentFirst = global.display.get_tab_list(Meta.TabList.NORMAL, null);
        const rank = other => {
            const index = recentFirst.indexOf(other);
            return index === -1 ? recentFirst.length : index; // not in the list: oldest
        };
        return others.sort((a, b) => rank(a) - rank(b));
    }
}

/** What the shell knows about a window, in the plain form rememberedPlaces.js asks for. */
function factsOf(window) {
    return {
        normal: window.get_window_type() === Meta.WindowType.NORMAL,
        hasParent: window.get_transient_for() !== null,
        attachedDialog: window.is_attached_dialog(),
        canMove: window.allows_move(),
        // A maximised window reports that it cannot be resized, because it fills the screen.
        canResize: window.allows_resize() || window.is_maximized(),
        fullscreen: window.is_fullscreen(),
        appId: window.get_gtk_application_id(),
        wmClass: window.get_wm_class(),
        gtkWindowPath: window.get_gtk_window_object_path(),
    };
}

// Maximised, or in one of GNOME's own halves (Mutter sees those as maximised in one direction).
// Their size is the screen's, never the window's own.
function isMaximizedOrHalf(window) {
    return window.is_maximized() || window.maximized_horizontally || window.maximized_vertically;
}

function plainRect({x, y, width, height}) {
    return {x, y, width, height};
}
