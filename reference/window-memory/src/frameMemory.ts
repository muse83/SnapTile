// REFERENCE ONLY - NOT PART OF SnapTile. It imports modules SnapTile does not have.
// See ../README.md.

// Decisions of the window memory, free of any GNOME API so they can be tested with plain Node.

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type TileRect = Rect & { groups: number[] };

export interface RememberedFrame {
    // size and position the window has when it is not tiled; missing when the extension
    // never saw it, then the application's own default size is used
    frame?: Rect;
    tile?: TileRect;
    maximized?: boolean;
}

export type RememberedFrames = { [appId: string]: RememberedFrame };

function isRect(value: unknown): value is Rect {
    if (typeof value !== 'object' || value === null) return false;
    const r = value as Record<string, unknown>;
    return (
        Number.isFinite(r.x) &&
        Number.isFinite(r.y) &&
        Number.isFinite(r.width) &&
        Number.isFinite(r.height) &&
        (r.width as number) > 0 &&
        (r.height as number) > 0
    );
}

function parseEntry(value: unknown): RememberedFrame | null {
    if (typeof value !== 'object' || value === null) return null;
    const e = value as Record<string, unknown>;
    const entry: RememberedFrame = {};
    if (e.frame !== undefined) {
        if (!isRect(e.frame)) return null;
        entry.frame = copyRect(e.frame);
    }
    if (e.tile !== undefined) {
        const tile = e.tile as Record<string, unknown>;
        if (
            !isRect(tile) ||
            !Array.isArray(tile.groups) ||
            !tile.groups.every(g => Number.isFinite(g))
        )
            return null;
        entry.tile = { ...copyRect(tile), groups: [...tile.groups] };
    }
    if (e.maximized === true) entry.maximized = true;
    // an entry without any of the three says nothing
    if (!entry.frame && !entry.tile && !entry.maximized) return null;
    return entry;
}

function copyRect(r: Rect): Rect {
    return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** Parse the stored text. Unreadable data gives nothing, corrupt entries are dropped. */
export function parseRememberedFrames(raw: string): RememberedFrames {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return {};

    const result: RememberedFrames = {};
    Object.entries(parsed).forEach(([appId, value]) => {
        const entry = parseEntry(value);
        if (entry) result[appId] = entry;
    });
    return result;
}

// how many applications are remembered at most, the least recently used are dropped
export const MAX_REMEMBERED_APPS = 200;

export interface ClosingWindow {
    frame: Rect;
    maximized: boolean;
    tile?: TileRect;
    // size the window had before it was tiled, if the extension knows it
    sizeBeforeTile?: Rect;
}

/**
 * The remembered entries after a window of the app closed. The app becomes the most
 * recently used one; the input is not modified.
 */
export function rememberClosing(
    entries: RememberedFrames,
    appId: string,
    closing: ClosingWindow
): RememberedFrames {
    // a tiled or maximised window is not at its free size: use the size from before, and
    // if that is unknown remember none, so the application keeps its own default
    const frame =
        closing.tile || closing.maximized
            ? closing.sizeBeforeTile
            : closing.frame;

    const entry: RememberedFrame = {};
    if (frame) entry.frame = copyRect(frame);
    if (closing.maximized) entry.maximized = true;
    // a maximised window has a tile only when maximised by edge or keyboard (whole screen)
    if (closing.tile)
        entry.tile = {
            ...copyRect(closing.tile),
            groups: [...closing.tile.groups],
        };

    const result: RememberedFrames = { ...entries };
    // re-insert to keep the most recently used application last
    delete result[appId];
    result[appId] = entry;
    Object.keys(result)
        .slice(0, -MAX_REMEMBERED_APPS)
        .forEach(key => delete result[key]);
    return result;
}

// offset applied to a window that would cover another window of the same application
const CASCADE_OFFSET = 30;
const MAX_CASCADE_STEPS = 10;

export interface Placement {
    frame: Rect;
    // index into the work areas the frame was fitted onto
    monitorIndex: number;
}

/** Move and shrink the rect so it is fully inside the work area nearest to its centre. */
function fitOntoNearestWorkArea(frame: Rect, workAreas: Rect[]): Placement {
    if (workAreas.length === 0) return { frame, monitorIndex: 0 };

    const centerX = frame.x + frame.width / 2;
    const centerY = frame.y + frame.height / 2;

    let monitorIndex = 0;
    let bestDistance = Infinity;
    workAreas.forEach((area, index) => {
        const dx = Math.max(
            area.x - centerX,
            0,
            centerX - (area.x + area.width)
        );
        const dy = Math.max(
            area.y - centerY,
            0,
            centerY - (area.y + area.height)
        );
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            bestDistance = distance;
            monitorIndex = index;
        }
    });

    const area = workAreas[monitorIndex];
    const width = Math.min(frame.width, area.width);
    const height = Math.min(frame.height, area.height);
    return {
        monitorIndex,
        frame: {
            x: Math.min(Math.max(frame.x, area.x), area.x + area.width - width),
            y: Math.min(
                Math.max(frame.y, area.y),
                area.y + area.height - height
            ),
            width,
            height,
        },
    };
}

/**
 * Where a remembered window should open: fitted onto the nearest work area and, unless it is
 * tiled, cascaded while it sits exactly on top of another window of the same application.
 * @param occupied frames of the other windows of the same application
 */
export function placeRestored(
    entry: RememberedFrame & { frame: Rect },
    workAreas: Rect[],
    occupied: Rect[]
): Placement {
    let placed = fitOntoNearestWorkArea(entry.frame, workAreas);
    if (entry.tile) return placed;

    for (let step = 0; step < MAX_CASCADE_STEPS; step++) {
        const { x, y } = placed.frame;
        if (!occupied.some(r => r.x === x && r.y === y)) break;

        placed = fitOntoNearestWorkArea(
            {
                ...placed.frame,
                x: x + CASCADE_OFFSET,
                y: y + CASCADE_OFFSET,
            },
            workAreas
        );
    }
    return placed;
}
