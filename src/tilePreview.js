import Clutter from 'gi://Clutter';
import St from 'gi://St';

const ANIMATION_MS = 250;

/**
 * The translucent frame marking the Tile a dragged window will snap to. Uses GNOME's own
 * `tile-preview` style class, so it follows the theme and accent colour, and sits directly
 * below the dragged window like GNOME's own preview.
 */
export class TilePreview {
    constructor() {
        this._widget = null;
        this._fading = new Set();
    }

    /** Shows the frame at `rect` for the dragged `window`, gliding there if already visible. */
    show(window, rect) {
        if (!this._widget) {
            const frame = window.get_frame_rect();
            this._widget = new St.Widget({
                style_class: 'tile-preview',
                opacity: 0,
                x: frame.x, y: frame.y, width: frame.width, height: frame.height,
            });
            global.window_group.add_child(this._widget);
        }

        const actor = window.get_compositor_private();
        if (actor && actor.get_parent() === global.window_group)
            global.window_group.set_child_below_sibling(this._widget, actor);

        this._widget.show();
        this._widget.ease({
            ...rect,
            opacity: 255,
            duration: ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    /** Fades the frame out. Safe to call when nothing is shown. */
    hide() {
        const widget = this._widget;
        if (!widget)
            return;
        this._widget = null;
        this._fading.add(widget);
        widget.ease({
            opacity: 0,
            duration: ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._fading.delete(widget);
                widget.destroy();
            },
        });
    }

    /** Removes the frame, also one that is still fading out, at once. */
    destroy() {
        for (const widget of [this._widget, ...this._fading]) {
            widget?.remove_all_transitions();
            widget?.destroy();
        }
        this._widget = null;
        this._fading.clear();
    }
}
