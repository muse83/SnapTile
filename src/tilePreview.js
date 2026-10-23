import Clutter from 'gi://Clutter';
import St from 'gi://St';

const ANIMATION_MS = 250;

/**
 * The translucent frame marking the Tile a dragged window will snap to. Uses GNOME's own
 * `tile-preview` style class, so it follows the theme and accent colour, and sits directly
 * below the dragged window like GNOME's own preview. It shows the Window look, so it is
 * drawn where the snapped window will be seen: pulled in by the margin, corners rounded.
 */
export class TilePreview {
    constructor() {
        this._widget = null;
        this._fading = new Set();
    }

    /**
     * Shows the frame at `visible` (the Tile pulled in by the margin) for the dragged `window`,
     * gliding there if already visible. `radius` is the corner radius in logical pixels.
     */
    show(window, visible, radius) {
        if (!this._widget) {
            const start = window.get_frame_rect();
            this._widget = new St.Widget({
                style_class: 'tile-preview',
                opacity: 0,
                x: start.x, y: start.y, width: start.width, height: start.height,
            });
            global.window_group.add_child(this._widget);
        }
        // CSS lengths are multiplied by the interface scale; the radius is in logical pixels.
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._widget.set_style(`border-radius: ${radius / scale}px;`);

        const actor = window.get_compositor_private();
        if (actor && actor.get_parent() === global.window_group)
            global.window_group.set_child_below_sibling(this._widget, actor);

        this._widget.show();
        this._widget.ease({
            x: visible.x, y: visible.y, width: visible.width, height: visible.height,
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
