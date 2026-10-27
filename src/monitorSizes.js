// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 muse83

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
 * again after the monitors were rearranged. Until Mutter has answered, after the start and after
 * every change of the monitors, the names are not known: the answer before describes the
 * arrangement before, so it is not given out (ADR 0012).
 */
export class MonitorSizes {
    constructor() {
        this._listeners = [];
        this._settledListeners = [];
        this._pending = 0; // questions asked of Mutter that are not answered yet
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

    /**
     * `callback` is called each time every question asked of Mutter has been answered, also
     * when an answer failed (then the names stay unknown), so it can go on with what waited.
     */
    whenSettled(callback) {
        this._settledListeners.push(callback);
    }

    /** Whether the names of the monitors are known: Mutter has answered all questions asked. */
    isSettled() {
        return this._pending === 0;
    }

    /** Asks Mutter again. */
    refresh() {
        this._pending++;
        Gio.DBus.session.call(BUS_NAME, OBJECT_PATH, BUS_NAME, 'GetCurrentState',
            null, null, Gio.DBusCallFlags.NONE, -1, this._cancellable, (connection, result) => {
                let answered = false;
                try {
                    this._store(connection.call_finish(result).recursiveUnpack());
                    answered = true;
                } catch (e) {
                    if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return; // destroy() ran: nothing waits for this answer any more
                    console.warn(`SnapTile: could not read monitor sizes: ${e.message}`);
                    this._idByPosition.clear(); // what we hold describes an arrangement of before
                }
                this._pending--;
                if (answered)
                    this._listeners.forEach(callback => callback());
                if (this._pending === 0)
                    this._settledListeners.forEach(callback => callback());
            });
    }

    /** {widthMm, heightMm} of the monitor at this index of the layout manager, or {}. */
    get(monitorIndex) {
        const monitor = Main.layoutManager.monitors[monitorIndex];
        return (monitor && this._byPosition.get(`${monitor.x},${monitor.y}`)) ?? {};
    }

    /** The id of the monitor at this index of the layout manager, or undefined if not known (yet). */
    idOf(monitorIndex) {
        if (!this.isSettled())
            return undefined; // the answer we hold is for the arrangement before
        const monitor = Main.layoutManager.monitors[monitorIndex];
        return monitor ? this._idByPosition.get(`${monitor.x},${monitor.y}`) : undefined;
    }

    destroy() {
        if (this._monitorsChangedId)
            Main.layoutManager.disconnect(this._monitorsChangedId);
        this._monitorsChangedId = 0;
        this._listeners = [];
        this._settledListeners = [];
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
