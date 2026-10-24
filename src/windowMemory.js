import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {appKeyOf, parsePlaces, placeFor, rememberFree, serialisePlaces} from './rememberedPlaces.js';

/**
 * Window memory for free windows (ADR 0007, ADR 0009): remembers the size and position of an
 * application's window when it closes and puts the next new window of that application
 * there. The decisions live in rememberedPlaces.js; this class connects them to the windows
 * and to the settings. It creates only signal connections, which destroy() removes.
 *
 * Not yet here: tiled and maximised windows, a second window of an application (GNOME
 * places it as usual), saving while a window is still open, the limit of 200 applications,
 * the switch and the clear button, several monitors that change.
 */
export class WindowMemory {
    /** @param settings the extension's Gio.Settings, @param tiledWindows the shared TiledWindows */
    constructor(settings, tiledWindows) {
        this._settings = settings;
        this._tiledWindows = tiledWindows;
        this._places = {};
        this._signals = [];
        // Every window watched until it closes: {closingId, arriving, unmaximizedId}. Arriving
        // marks a window created since enable that is not placed yet; unmaximizedId is the
        // wait for a window that maximised itself to say it has its free size back.
        this._windows = new Map();
    }

    /** Call from the extension's enable(). Windows that are open now are never moved. */
    enable() {
        this._places = parsePlaces(this._settings.get_string('places'));

        for (const actor of global.get_window_actors())
            this._watch(actor.meta_window, false);

        this._signals.push(
            [global.display, global.display.connect('window-created',
                (display, window) => this._watch(window, true))],
            [global.window_manager, global.window_manager.connect('map',
                (manager, actor) => this._place(actor.meta_window))]);
    }

    /** Call from the extension's disable(). */
    destroy() {
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

    _watch(window, arriving) {
        if (this._windows.has(window))
            return;
        const closingId = window.connect('unmanaging', () => {
            this._remember(window);
            this._windows.delete(window); // the window is going away, its connections with it
        });
        this._windows.set(window, {closingId, arriving, unmaximizedId: 0});
    }

    _remember(window) {
        const key = appKeyOf(factsOf(window));
        // Tiled and maximised windows are not at their free size; until they are handled, they
        // leave the remembered place as it is.
        if (key === null || window.is_maximized() || this._tiledWindows.get(window.get_id()))
            return;

        this._places = rememberFree(this._places, key, plainRect(window.get_frame_rect()));
        this._settings.set_string('places', serialisePlaces(this._places));
    }

    /** Called when a window is shown; places it if it is a new one with a remembered place. */
    _place(window) {
        const entry = this._windows.get(window);
        if (!entry?.arriving)
            return; // already open when the extension was enabled, or shown again after hiding
        entry.arriving = false;

        const key = appKeyOf(factsOf(window));
        if (key === null || this._hasOtherOpenWindow(window, key))
            return;

        const workAreas = Main.layoutManager.monitors.map(
            (monitor, index) => plainRect(Main.layoutManager.getWorkAreaForMonitor(index)));
        const rect = placeFor(this._places, key, workAreas);
        if (rect === null)
            return;

        if (!window.is_maximized()) {
            window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
            return;
        }
        // An application that maximises itself at start ignores a plain placement, and one
        // asked right after un-maximising loses it. So wait for the window to say it is
        // back to a free size (its next size change), then place it. See
        // docs/research/window-placement-on-wayland.md.
        entry.unmaximizedId = window.connect('size-changed', () => {
            window.disconnect(entry.unmaximizedId);
            entry.unmaximizedId = 0;
            window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
        });
        window.unmaximize();
    }

    /**
     * Whether the application has another window that is shown and not closing. A window that
     * is only being created, or is fading out, does not count: two windows opened together
     * must not both be skipped, and a window opened right after one was closed is placed.
     */
    _hasOtherOpenWindow(window, key) {
        return global.get_window_actors().some(actor => actor.meta_window !== window &&
            actor.mapped && this._windows.has(actor.meta_window) &&
            appKeyOf(factsOf(actor.meta_window)) === key);
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
