import Clutter from 'gi://Clutter';
import St from 'gi://St';

// Short on purpose: the preview has to feel instant. GNOME's own preview takes 250 ms.
const ANIMATION_MS = 80;

/**
 * The translucent frame marking the Tile a dragged window will snap to. Uses GNOME's own
 * `tile-preview` style class, so it follows the theme and accent colour, and sits directly
 * below the dragged window like GNOME's own preview. It shows the Window look, so it is
 * drawn where the snapped window will be seen: pulled in by the margin, corners rounded.
 */
export class TilePreview {
    constructor() {
        this._widget = null;
        this._shown = null; // key of the frame the widget is on its way to
        this._fading = new Set();
    }

    /**
     * Shows the frame at `visible` (the Tile pulled in by the margin) for the dragged `window`:
     * it fades in right at the Tile, and glides there from the previous one if already visible.
     * `radius` is the corner radius in logical pixels. The drag calls this on every pointer
     * poll, so asking for what is already shown does nothing; restarting the animation each
     * time would keep it from ever arriving.
     */
    show(window, visible, radius) {
        const key = `${visible.x},${visible.y},${visible.width},${visible.height},${radius}`;
        if (this._widget && key === this._shown)
            return;
        this._shown = key;

        const created = !this._widget;
        if (created) {
            this._widget = new St.Widget({
                style_class: 'tile-preview',
                opacity: 0,
                x: visible.x, y: visible.y, width: visible.width, height: visible.height,
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
            ...(created ? {} : {
                x: visible.x, y: visible.y, width: visible.width, height: visible.height,
            }),
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
        this._shown = null;
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
        this._shown = null;
        this._fading.clear();
    }
}
