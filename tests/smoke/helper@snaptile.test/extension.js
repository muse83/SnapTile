// Test only, never shipped. Exposes org.snaptile.Test.Eval on the session bus.
import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const IFACE = `<node><interface name="org.snaptile.Test">
  <method name="Eval"><arg type="s" direction="in" name="code"/>
    <arg type="b" direction="out" name="ok"/><arg type="s" direction="out" name="result"/></method>
</interface></node>`;

export default class TestHelper extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/org/snaptile/Test');
        this._owner = Gio.bus_own_name_on_connection(Gio.DBus.session, 'org.snaptile.Test',
            Gio.BusNameOwnerFlags.NONE, null, null);
    }

    disable() {
        Gio.bus_unown_name(this._owner);
        this._dbus.unexport();
        this._dbus = null;
    }

    Eval(code) {
        try {
            const result = new Function('Main', 'imports', `return (${code});`)(Main, imports);
            return [true, JSON.stringify(result ?? null)];
        } catch (e) {
            return [false, `${e}`];
        }
    }
}
