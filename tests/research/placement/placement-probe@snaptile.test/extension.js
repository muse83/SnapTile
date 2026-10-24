// Research only, never shipped. Records the life of every new window (which signal fires
// when, what is known about the window then, what was painted) and, when asked, places the
// window at one chosen moment. Also offers org.snaptile.Test.Eval like the smoke helper.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const IFACE = `<node><interface name="org.snaptile.Test">
  <method name="Eval"><arg type="s" direction="in" name="code"/>
    <arg type="b" direction="out" name="ok"/><arg type="s" direction="out" name="result"/></method>
</interface></node>`;

const RECORD_MS = 2500; // how long after creation the painted frames of a window are recorded

const rectOf = r => r ? [r.x, r.y, r.width, r.height] : null;

export default class PlacementProbe extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/org/snaptile/Test');
        this._owner = Gio.bus_own_name_on_connection(Gio.DBus.session, 'org.snaptile.Test',
            Gio.BusNameOwnerFlags.NONE, null, null);

        this._lines = [];
        this._windows = new Map(); // id -> {window, created, lastFrame, placed}
        this._place = null;
        this._signals = [];
        const on = (object, name, fn) => this._signals.push([object, object.connect(name, fn)]);
        on(global.display, 'window-created', (d, w) => this._created(w));
        on(global.window_manager, 'map', (wm, actor) => this._hook('map', actor.meta_window));
        on(global.stage, 'after-paint', () => this._painted());
    }

    disable() {
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        Gio.bus_unown_name(this._owner);
        this._dbus.unexport();
        this._dbus = null;
    }

    /** setPlace({hook, rect:[x,y,w,h], via:'move_resize'|'unmaximize_move_resize'|'move'|'snap', match:'*', tile}) or null. match is a title prefix, '*' for any. */
    setPlace(place) {
        this._place = place;
        return 1;
    }

    /** Returns the recorded lines as one text and forgets them. */
    takeLog() {
        const text = this._lines.join('\n');
        this._lines = [];
        return text;
    }

    /** Everything the shell can tell about the window whose title starts with `prefix`: all properties and the plain getters. */
    describe(prefix) {
        const w = global.get_window_actors().map(a => a.meta_window).find(x => (x.get_title() ?? '').startsWith(prefix));
        if (!w)
            return null;
        const out = {};
        for (const spec of w.constructor.list_properties()) {
            try {
                const v = w[spec.name.replace(/-/g, '_')];
                out[`prop:${spec.name}`] = (v !== null && typeof v === 'object') ? `${v}` : v;
            } catch (e) {
                out[`prop:${spec.name}`] = `error ${e}`;
            }
        }
        for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(w))) {
            if (!/^(get_|is_|has_|allows_|can_|showing_|skip|appears)/.test(name))
                continue;
            if (['get_compositor_private', 'get_display', 'get_workspace', 'get_stable_sequence', 'get_id', 'get_user_time', 'get_pid'].includes(name))
                continue;
            try {
                const v = w[name]();
                out[`fn:${name}`] = (v !== null && typeof v === 'object') ? `${v}` : v;
            } catch (e) { /* needs arguments */ }
        }
        return out;
    }

    /** Writes the recorded lines to a file and forgets them. */
    dump(path) {
        GLib.file_set_contents(path, this.takeLog() + '\n');
        return 1;
    }

    forget() {
        this._windows.clear();
        return 1;
    }

    _now() {
        return Math.round(GLib.get_monotonic_time() / 1000);
    }

    _snapshot(w) {
        const actor = w.get_compositor_private();
        return {
            title: w.get_title(),
            appId: w.get_gtk_application_id(),
            cls: w.get_wm_class(),
            type: w.get_window_type(),
            parent: w.get_transient_for()?.get_title() ?? null,
            parentCls: w.get_transient_for()?.get_wm_class() ?? null,
            move: w.allows_move(),
            resize: w.allows_resize(),
            gtkWindowPath: w.gtk_window_object_path ?? null,
            fullscreen: w.is_fullscreen(),
            maximized: w.is_maximized(),
            frame: rectOf(w.get_frame_rect()),
            buffer: rectOf(w.get_buffer_rect()),
            actor: actor ? {mapped: actor.mapped, visible: actor.visible, opacity: actor.opacity} : null,
        };
    }

    _log(w, ev, extra = {}) {
        const entry = this._windows.get(w.get_id());
        const t = entry ? this._now() - entry.created : 0;
        this._lines.push(JSON.stringify({id: w.get_id(), t, ev, ...extra}));
    }

    _created(w) {
        this._windows.set(w.get_id(), {window: w, created: this._now(), lastFrame: '', placed: false});
        w.connect('unmanaged', () => this._log(w, 'unmanaged'));
        // Moments before the window is shown: the application names itself.
        for (const prop of ['title', 'gtk-application-id', 'wm-class'])
            w.connect(`notify::${prop}`, () => this._hook(`notify::${prop}`, w));
        w.connect('position-changed', () => this._hook('position-changed', w));
        w.connect('size-changed', () => this._hook('size-changed', w));
        this._hook('window-created', w);
        // 'first-frame' lives on the actor, which may not exist yet at creation.
        const connect = () => {
            const actor = w.get_compositor_private();
            if (!actor)
                return false;
            actor.connect('first-frame', () => this._hook('first-frame', w));
            return true;
        };
        if (!connect()) {
            const id = global.window_manager.connect('map', (wm, actor) => {
                if (actor.meta_window !== w)
                    return;
                global.window_manager.disconnect(id);
                actor.connect('first-frame', () => this._hook('first-frame', w));
            });
        }
    }

    _hook(name, w) {
        const entry = this._windows.get(w.get_id());
        if (!entry)
            return;
        this._log(w, name, this._snapshot(w));

        const place = this._place;
        if (!place || place.hook !== name || entry.placed)
            return;
        const title = w.get_title() ?? '';
        if (place.match !== '*' && !title.startsWith(place.match))
            return;
        entry.placed = true;
        const [x, y, width, height] = place.rect;
        const before = rectOf(w.get_frame_rect());
        try {
            if (place.via === 'unmaximize_wait') {
                // Unmaximising is answered later by the client; place when the size has changed.
                const id = w.connect('size-changed', () => {
                    w.disconnect(id);
                    w.move_resize_frame(true, x, y, width, height);
                    this._log(w, 'placed-after-unmaximize', {after: rectOf(w.get_frame_rect())});
                });
                w.unmaximize();
            } else if (place.via === 'unmaximize_move_resize') {
                if (w.is_maximized())
                    w.unmaximize();
                w.move_resize_frame(true, x, y, width, height);
            } else if (place.via === 'move')
                w.move_frame(true, x, y);
            else if (place.via === 'snap') {
                const area = Main.layoutManager.getWorkAreaForMonitor(0);
                Main.extensionManager.lookup('snaptile@muse83').stateObj._dragSnap._snap(w, {
                    rect: {x, y, width, height},
                    workArea: {x: area.x, y: area.y, width: area.width, height: area.height},
                    tile: place.tile,
                });
            }
            else
                w.move_resize_frame(true, x, y, width, height);
            this._log(w, 'placed', {at: name, via: place.via, before, after: rectOf(w.get_frame_rect())});
        } catch (e) {
            this._log(w, 'place-error', {error: `${e}`});
        }
    }

    // One line per painted frame in which the picture of a window differs from the last one.
    _painted() {
        const now = this._now();
        for (const entry of this._windows.values()) {
            const w = entry.window;
            if (now - entry.created > RECORD_MS)
                continue;
            const actor = w.get_compositor_private();
            if (!actor || !actor.mapped)
                continue;
            const state = JSON.stringify([rectOf(w.get_frame_rect()), rectOf(w.get_buffer_rect()),
                Math.round(actor.x), Math.round(actor.y), Math.round(actor.width), Math.round(actor.height), actor.opacity]);
            if (state === entry.lastFrame)
                continue;
            entry.lastFrame = state;
            this._log(w, 'frame', {frame: rectOf(w.get_frame_rect()), buffer: rectOf(w.get_buffer_rect()),
                actor: [Math.round(actor.x), Math.round(actor.y), Math.round(actor.width), Math.round(actor.height)],
                opacity: actor.opacity});
        }
    }

    Eval(code) {
        try {
            const result = new Function('Main', 'imports', 'probe', `return (${code});`)(Main, imports, this);
            return [true, JSON.stringify(result ?? null)];
        } catch (e) {
            return [false, `${e}`];
        }
    }
}
