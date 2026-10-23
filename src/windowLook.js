import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {CornerEffect} from './cornerEffect.js';
import {MonitorSizes} from './monitorSizes.js';
import {lookSizes} from './tileDecision.js';

const EFFECT_NAME = 'snaptile-corners';

// Application windows and dialogs only: menus, tooltips and the GNOME interface are other types.
const LOOK_TYPES = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG];

/**
 * Gives every application window and dialog the Window look, tiled or floating. For now that
 * is the rounded corners; everything it adds is removed again by destroy().
 */
export class WindowLook {
    constructor() {
        this._monitorSizes = new MonitorSizes(() => this._refreshAll());
        this._entries = new Map(); // window id -> {window, actor, windowIds, actorIds}
        this._signals = [];
    }

    /** Call from the extension's enable(). */
    enable() {
        this._monitorSizes.refresh();
        this._signals.push(
            [Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => {
                this._monitorSizes.refresh();
                this._refreshAll();
            })],
            [global.display, global.display.connect('window-created',
                (display, window) => this._add(window))]);
        for (const actor of global.get_window_actors())
            this._add(actor.meta_window);
    }

    /** Call from the extension's disable(). */
    destroy() {
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];

        for (const entry of [...this._entries.values()])
            this._remove(entry);
        this._monitorSizes.destroy();
    }

    _add(window) {
        const actor = window.get_compositor_private();
        if (!actor || this._entries.has(window.get_id()))
            return;

        const refresh = () => this._refresh(entry);
        const entry = {
            window, actor, destroyed: false,
            windowIds: ['size-changed', 'position-changed', 'notify::fullscreen',
                'notify::window-type'].map(name => window.connect(name, refresh)),
            actorIds: [actor.connect('notify::size', refresh),
                actor.connect('destroy', () => {
                    entry.destroyed = true;
                    this._remove(entry);
                })],
        };
        entry.windowIds.push(window.connect('unmanaged', () => this._remove(entry)));
        this._entries.set(window.get_id(), entry);
        this._refresh(entry);
    }

    _remove(entry) {
        if (!this._entries.delete(entry.window.get_id()))
            return;

        for (const id of entry.windowIds)
            entry.window.disconnect(id);
        if (!entry.destroyed) {
            for (const id of entry.actorIds)
                entry.actor.disconnect(id);
            entry.actor.remove_effect_by_name(EFFECT_NAME);
        }
    }

    _refreshAll() {
        for (const entry of this._entries.values())
            this._refresh(entry);
    }

    _refresh(entry) {
        const {window, actor} = entry;
        const wanted = LOOK_TYPES.includes(window.get_window_type()) && !window.is_fullscreen();
        let effect = actor.get_effect(EFFECT_NAME);
        if (!wanted) {
            if (effect)
                actor.remove_effect_by_name(EFFECT_NAME);
            return;
        }

        if (!effect) {
            effect = new CornerEffect();
            actor.add_effect_with_name(EFFECT_NAME, effect);
        }
        const frame = window.get_frame_rect();
        const buffer = window.get_buffer_rect();
        const left = frame.x - buffer.x;
        const top = frame.y - buffer.y;
        effect.setFrame(
            {left, top, right: left + frame.width, bottom: top + frame.height},
            this._radiusFor(window));
    }

    _radiusFor(window) {
        const index = window.get_monitor();
        const monitor = Main.layoutManager.monitors[index];
        if (!monitor)
            return 0;
        return lookSizes({
            width: monitor.width, height: monitor.height, ...this._monitorSizes.get(index),
        }).radius;
    }
}
