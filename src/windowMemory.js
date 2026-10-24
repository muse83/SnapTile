import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {appKeyOf, parsePlaces, placementFor, placementForSecondWindow, rememberOnClose, rememberWindow, serialisePlaces} from './rememberedPlaces.js';

/**
 * Window memory (ADR 0007, ADR 0009, ADR 0010, ADR 0011): remembers the place of an application's window when the
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
 * Not yet here: several monitors that change beyond "the nearest monitor takes it".
 */
export class WindowMemory {
    /**
     * @param settings the extension's Gio.Settings
     * @param tiledWindows the shared TiledWindows
     * @param dragSnap the DragSnap, whose snap path puts a reopened window into its Tile
     * @param monitorSizes the MonitorSizes, to turn 1 cm into pixels for a second window
     */
    constructor(settings, tiledWindows, dragSnap, monitorSizes) {
        this._settings = settings;
        this._monitorSizes = monitorSizes;
        this._tiledWindows = tiledWindows;
        this._dragSnap = dragSnap;
        this._places = {};
        this._signals = [];
        // Every window watched until it closes: {closingId, arriving, unmaximizedId, savedAt}.
        // Arriving marks a window created since enable that is not placed yet; unmaximizedId is
        // the wait for a window that maximised itself to say it has its free size back; savedAt
        // is when the window last saved its place (a number from _saves, 0: never), to tell
        // which of an application's windows saved last.
        this._windows = new Map();
        this._saves = 0;
    }

    /** Call from the extension's enable(). Windows that are open now are never moved. */
    enable() {
        this._places = parsePlaces(this._settings.get_string('places'));

        for (const actor of global.get_window_actors())
            this._watch(actor.meta_window, false);

        this._signals.push(
            [this._settings, this._settings.connect('changed::places',
                () => this._followStoredPlaces())],
            [global.display, global.display.connect('window-created',
                (display, window) => this._watch(window, true))],
            [global.display, global.display.connect('grab-op-end',
                (display, window) => this._saveAfterGrab(window))],
            [global.window_manager, global.window_manager.connect('map',
                (manager, actor) => this._place(actor.meta_window))]);
    }

    /** Call from the extension's disable(). Saves every open window first (if switched on). */
    destroy() {
        try {
            if (this._isMemoryOn())
                this._saveOpenWindows();
            Gio.Settings.sync(); // the session may end right after disable, so write it out now
        } finally {
            for (const [object, id] of this._signals)
                object.disconnect(id);
            this._signals = [];
            for (const [window, entry] of this._windows) {
                window.disconnect(entry.closingId);
                if (entry.unmaximizedId)
                    window.disconnect(entry.unmaximizedId);
            }
            this._windows.clear();
        }
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
        // What the open windows saved is gone or replaced, so none of them has a later save
        // that its siblings must respect when they close.
        for (const entry of this._windows.values())
            entry.savedAt = 0;
    }

    _watch(window, arriving) {
        if (this._windows.has(window))
            return;
        const closingId = window.connect('unmanaging', () => {
            this._saveOnClose(window);
            this._windows.delete(window); // the window is going away, its connections with it
        });
        this._windows.set(window, {closingId, arriving, unmaximizedId: 0, savedAt: 0});
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
     * The user let go of a window after moving or resizing it (mouse or keyboard). Drag-to-snap
     * handles the same signal first (it is enabled first) and records a snapped window as
     * tiled, so a drop into a Tile is saved as that Tile and not as a free place.
     */
    _saveAfterGrab(window) {
        const entry = this._windows.get(window);
        const found = entry && this._isMemoryOn() && this._stateOf(window);
        if (!found)
            return;
        entry.savedAt = ++this._saves;
        this._store(rememberWindow(this._places, found.key, found.state));
    }

    /** A window closes: its place counts unless another window of the application saved later. */
    _saveOnClose(window) {
        const entry = this._windows.get(window);
        const found = this._isMemoryOn() && this._stateOf(window);
        if (!found)
            return;
        const others = [...this._windows]
            .filter(([other]) => other !== window && appKeyOf(factsOf(other)) === found.key)
            .map(([, otherEntry]) => otherEntry.savedAt);
        this._store(rememberOnClose(this._places, found.key, found.state, entry.savedAt, others));
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
        let places = this._places;
        for (const window of [...this._windows.keys()].sort((a, b) => rank(b) - rank(a))) {
            const found = this._stateOf(window);
            if (found)
                places = rememberWindow(places, found.key, found.state);
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
     * Where a new window of the application goes, or null to leave it to GNOME. The first
     * window gets the remembered place; a further one opens free and offset from the open
     * windows (ADR 0011). `siblings` are the application's other open windows, the most
     * recently used first.
     */
    _placementOf(window, key, siblings) {
        const monitors = Main.layoutManager.monitors.map((monitor, index) => ({
            width: monitor.width, height: monitor.height, ...this._monitorSizes.get(index),
            workArea: plainRect(Main.layoutManager.getWorkAreaForMonitor(index)),
        }));
        if (siblings.length === 0)
            return placementFor(this._places, key, monitors.map(monitor => monitor.workArea));

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

function plainRect({x, y, width, height}) {
    return {x, y, width, height};
}
