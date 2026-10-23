// Remembers the size a window had before SnapTile tiled it, so dragging it out of the Tile
// can restore it. Pure logic, no GNOME imports. Kept in one place so the later window
// memory feature can build on it.

export class SizeMemory {
    constructor() {
        this._sizes = new Map();
    }

    /**
     * Call when a window is about to be tiled. Only the first call per tiling counts: a
     * window that is already tiled keeps the size from before. Pass null for a window that
     * never had a free size (it opened tiled); it then keeps its own size when dragged out.
     */
    remember(windowId, size) {
        if (this._sizes.has(windowId))
            return;
        this._sizes.set(windowId, size ? {width: size.width, height: size.height} : null);
    }

    /** Size to give the window when it is dragged out of its Tile, or null to leave it as is. */
    restore(windowId) {
        const size = this._sizes.get(windowId) ?? null;
        this._sizes.delete(windowId);
        return size;
    }

    /** Call when the window is closed. */
    forget(windowId) {
        this._sizes.delete(windowId);
    }
}
