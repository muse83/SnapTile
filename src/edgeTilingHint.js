// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 muse83

import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const MUTTER_SCHEMA = 'org.gnome.mutter';
const EDGE_TILING_KEY = 'edge-tiling';

const HINT_TITLE = 'Switch off GNOME edge tiling';
const HINT_BODY =
    'SnapTile does its own edge snapping, so two previews would appear. ' +
    'Open Settings → Multitasking and switch off "Active Screen Edges", ' +
    'or run: gsettings set org.gnome.mutter edge-tiling false';

/**
 * Shows a notification when GNOME's own edge tiling is on and removes it as soon as the
 * user switches that setting off. Only ever reads the setting; the user switches it off
 * themselves (see ADR 0003). The notification keeps normal urgency, so Do Not Disturb
 * silences it like any other.
 */
export class EdgeTilingHint {
    constructor() {
        this._source = null;
        this._settings = null;
        this._changedId = 0;
    }

    /** Call from the extension's enable(). Shows the hint if the setting is on. */
    show() {
        this._settings = getMutterSettings();
        if (!this._settings)
            return;

        this._changedId = this._settings.connect(`changed::${EDGE_TILING_KEY}`, () => {
            if (!this._settings.get_boolean(EDGE_TILING_KEY))
                this._removeNotification();
        });

        if (!this._settings.get_boolean(EDGE_TILING_KEY))
            return;

        this._source = new MessageTray.Source({
            title: 'SnapTile',
            iconName: 'view-dual-symbolic',
        });
        this._source.connect('destroy', () => {
            this._source = null;
        });
        Main.messageTray.add(this._source);

        const notification = new MessageTray.Notification({
            source: this._source,
            title: HINT_TITLE,
            body: HINT_BODY,
        });
        this._source.addNotification(notification);
    }

    /** Call from the extension's disable(). Removes the hint and stops watching. */
    destroy() {
        if (this._changedId) {
            this._settings.disconnect(this._changedId);
            this._changedId = 0;
        }
        this._settings = null;
        this._removeNotification();
    }

    _removeNotification() {
        this._source?.destroy();
        this._source = null;
    }
}

function getMutterSettings() {
    const schemaSource = Gio.SettingsSchemaSource.get_default();
    if (!schemaSource.lookup(MUTTER_SCHEMA, true))
        return null;
    return new Gio.Settings({schema_id: MUTTER_SCHEMA});
}
