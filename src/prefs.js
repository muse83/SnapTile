// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 muse83

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * The preferences window (ADR 0007): the one switch and the one button that window memory has
 * (it asks to confirm first and can close all windows as well), and the switch for the keyboard
 * shortcuts of the thirds (ADR 0014).
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

        const clearPlaces = () => {
            settings.reset('places');
            Gio.Settings.sync(); // this process may be closed right after the click
        };
        // Closing windows can lose unsaved work, so it is asked a second time on its own.
        const confirmClosingAll = () => {
            const confirmClose = new Adw.AlertDialog({
                heading: 'Close all windows?',
                body: 'Every open application window is asked to close, like its close button ' +
                    'does. Unsaved work can be lost: applications may ask what to do with it, ' +
                    'or refuse to close. The remembered windows are cleared as well. ' +
                    'Windows are only closed while SnapTile is switched on.',
            });
            confirmClose.add_response('cancel', 'Cancel');
            confirmClose.add_response('close', 'Close all windows');
            confirmClose.set_response_appearance('close', Adw.ResponseAppearance.DESTRUCTIVE);
            confirmClose.set_default_response('cancel');
            confirmClose.set_close_response('cancel');
            confirmClose.connect('response', (dialog, response) => {
                if (response !== 'close')
                    return;
                // The running extension closes the windows; whether it runs or not, the
                // places are cleared here, so nothing depends on it being there.
                settings.set_boolean('close-all-windows', true);
                clearPlaces();
            });
            confirmClose.present(window);
        };

        const clear = new Gtk.Button({
            label: 'Clear',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        clear.connect('clicked', () => {
            const confirm = new Adw.AlertDialog({
                heading: 'Forget all remembered windows?',
                body: 'Every remembered size, position and Tile of all applications is removed. ' +
                    'This cannot be undone. Windows that are open now save nothing until you ' +
                    'move or resize them again.',
            });
            confirm.add_response('cancel', 'Cancel');
            confirm.add_response('clear', 'Clear');
            confirm.add_response('clear-and-close', 'Clear and close all windows');
            confirm.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
            confirm.set_response_appearance('clear-and-close', Adw.ResponseAppearance.DESTRUCTIVE);
            confirm.set_default_response('cancel'); // Enter alone never deletes
            confirm.set_close_response('cancel');
            confirm.connect('response', (dialog, response) => {
                if (response === 'clear')
                    clearPlaces();
                else if (response === 'clear-and-close')
                    confirmClosingAll();
            });
            confirm.present(window);
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
