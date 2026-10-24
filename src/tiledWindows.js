// Which Tile each window SnapTile has tiled sits in, and the size it had before tiling (so
// dragging it out of the Tile can restore it). Pure logic, no GNOME imports. The one place
// that knows this: drag-to-snap writes it, the window memory reads it.

export class TiledWindows {
    constructor() {
        this._windows = new Map();
    }

    /**
     * Call when a window is tiled. The Tile is always the latest one, but only the first call
     * per tiling keeps its size: a window that is already tiled keeps the size from before.
     * Pass null for a window that never had a free size (it opened tiled); it then keeps its
     * own size when dragged out.
     */
    tile(windowId, tile, sizeBefore) {
        const known = this._windows.get(windowId);
        this._windows.set(windowId, {
            tile,
            sizeBefore: known ? known.sizeBefore : copySize(sizeBefore),
        });
    }

    /** {tile, sizeBefore} of a tiled window (sizeBefore may be null), or null if it is not tiled. */
    get(windowId) {
        const entry = this._windows.get(windowId);
        return entry ? {tile: entry.tile, sizeBefore: copySize(entry.sizeBefore)} : null;
    }

    /**
     * Call when the window is dragged out of its Tile, resized, moved by keyboard or closed.
     * Ends the tiling and returns the size to give the window, or null to leave it as is.
     */
    release(windowId) {
        const size = this._windows.get(windowId)?.sizeBefore ?? null;
        this._windows.delete(windowId);
        return size;
    }

    /** Call when the extension is disabled. */
    clear() {
        this._windows.clear();
    }
}

function copySize(size) {
    return size ? {width: size.width, height: size.height} : null;
}
