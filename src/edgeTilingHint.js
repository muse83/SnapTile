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
 * Shows a notification when GNOME's own edge tiling is on. Only ever reads the
 * setting; the user switches it off themselves (see ADR 0003).
 */
export class EdgeTilingHint {
    constructor() {
        this._source = null;
    }

    /** Call from the extension's enable(). Shows the hint if the setting is on. */
    show() {
        if (!isGnomeEdgeTilingOn())
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

    /** Call from the extension's disable(). Removes the hint and its source. */
    destroy() {
        this._source?.destroy();
        this._source = null;
    }
}

function isGnomeEdgeTilingOn() {
    const schemaSource = Gio.SettingsSchemaSource.get_default();
    if (!schemaSource.lookup(MUTTER_SCHEMA, true))
        return false;
    const settings = new Gio.Settings({schema_id: MUTTER_SCHEMA});
    return settings.get_boolean(EDGE_TILING_KEY);
}
