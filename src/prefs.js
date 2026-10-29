// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 muse83

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * The preferences window (ADR 0007): the one switch and the one button that window memory has,
 * and the switch for the keyboard shortcuts of the thirds (ADR 0014).
 * The window runs in its own process; the running extension notices a cleared memory through
 * the settings it shares with this window.
 */
export default class SnapTilePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const remember = new Adw.SwitchRow({
            title: 'Remember and place windows',
            subtitle: 'Reopen windows where they were last closed. Switching off keeps what is remembered.',
        });
        settings.bind('enabled', remember, 'active', Gio.SettingsBindFlags.DEFAULT);

        const clear = new Gtk.Button({
            label: 'Clear',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        clear.connect('clicked', () => {
            settings.reset('places');
            Gio.Settings.sync(); // this process may be closed right after the click
        });
        const clearRow = new Adw.ActionRow({
            title: 'Forget all remembered windows',
            subtitle: 'Removes every remembered size, position and Tile, also of windows that are open now.',
            activatable_widget: clear,
        });
        clearRow.add_suffix(clear);

        const group = new Adw.PreferencesGroup();
        group.add(remember);
        group.add(clearRow);
        const page = new Adw.PreferencesPage();
        page.add(group);

        const thirds = new Adw.SwitchRow({
            title: 'Keyboard shortcuts for the thirds',
            subtitle: 'Ctrl+Left, Ctrl+Down and Ctrl+Right snap the focused window into the left, middle or right third. ' +
                'Applications that use Ctrl+Left and Ctrl+Right to jump by word do not get these keys while this is on.',
        });
        settings.bind('thirds-shortcuts', thirds, 'active', Gio.SettingsBindFlags.DEFAULT);
        const shortcuts = new Adw.PreferencesGroup();
        shortcuts.add(thirds);
        page.add(shortcuts);
        window.add(page);
    }
}
