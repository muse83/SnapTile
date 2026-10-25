import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BUS_NAME = 'org.gnome.Mutter.DisplayConfig';
const OBJECT_PATH = '/org/gnome/Mutter/DisplayConfig';

// Transforms 90, 270 and their flipped variants swap the panel's width and height.
const ROTATED_TRANSFORMS = [1, 3, 5, 7];

/**
 * Physical size in millimetres of each monitor, which Mutter only offers over D-Bus (the
 * shell's own monitor objects have none). Needed to turn centimetres into pixels. Missing
 * answers are fine: monitors without a size are measured with the 96 DPI fallback.
 *
 * The same answer names each monitor (connector, vendor, product and serial, as Mutter tells
 * monitors apart in its own configuration), which the window memory uses to find a monitor
 * again after the monitors were rearranged.
 */
export class MonitorSizes {
    constructor() {
        this._listeners = [];
        this._monitorsChangedId = 0;
        this._cancellable = new Gio.Cancellable();
        this._byPosition = new Map();
        this._idByPosition = new Map();
    }

    /** Asks Mutter now and again whenever the monitors change. Call from the extension's enable(). */
    enable() {
        this.refresh();
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed',
            () => this.refresh());
    }

    /** `callback` is called each time fresh sizes arrive from Mutter. */
    watch(callback) {
        this._listeners.push(callback);
    }

    /** Asks Mutter again. */
    refresh() {
        Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, BUS_NAME, 'GetCurrentState',
            null, null, Gio.DBusCallFlags.NONE, -1, this._cancellable, (connection, result) => {
                try {
                    this._store(connection.call_finish(result).recursiveUnpack());
                    this._listeners.forEach(callback => callback());
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`SnapTile: could not read monitor sizes: ${e.message}`);
                }
            });
    }

    /** {widthMm, heightMm} of the monitor at this index of the layout manager, or {}. */
    get(monitorIndex) {
        const monitor = Main.layoutManager.monitors[monitorIndex];
        return (monitor && this._byPosition.get(`${monitor.x},${monitor.y}`)) ?? {};
    }

    /** The id of the monitor at this index of the layout manager, or undefined if not known (yet). */
    idOf(monitorIndex) {
        const monitor = Main.layoutManager.monitors[monitorIndex];
        return monitor ? this._idByPosition.get(`${monitor.x},${monitor.y}`) : undefined;
    }

    destroy() {
        if (this._monitorsChangedId)
            Main.layoutManager.disconnect(this._monitorsChangedId);
        this._monitorsChangedId = 0;
        this._listeners = [];
        this._cancellable.cancel();
        this._byPosition.clear();
        this._idByPosition.clear();
    }

    _store([, monitors, logicalMonitors]) {
        const sizeByConnector = new Map();
        for (const [[connector], , properties] of monitors) {
            const widthMm = properties['width-mm'];
            const heightMm = properties['height-mm'];
            if (widthMm && heightMm)
                sizeByConnector.set(connector, {widthMm, heightMm});
        }

        this._byPosition.clear();
        this._idByPosition.clear();
        for (const [x, y, , transform, , [[connector, vendor, product, serial]]] of logicalMonitors) {
            this._idByPosition.set(`${x},${y}`, [connector, vendor, product, serial].join('|'));
            const size = sizeByConnector.get(connector);
            if (!size)
                continue;
            this._byPosition.set(`${x},${y}`, ROTATED_TRANSFORMS.includes(transform)
                ? {widthMm: size.heightMm, heightMm: size.widthMm}
                : size);
        }
    }
}
