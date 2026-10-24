// The decisions of the window memory (see ADR 0007). Pure logic, no GNOME imports, so it runs
// under plain Node tests. Adapted from the decision part of the reference window memory
// (reference/window-memory/src/frameMemory.ts), cut down to free, tiled and maximised windows.
//
// The places are one plain object, application key -> a Remembered place. The key order is the
// order of use, the application used last comes last. A Remembered place is
//   {frame}                              a free window: its size and position
//   {frame, tile, sizeBefore?}           a tiled window: the Tile (one of the 14, by name), the
//                                        rectangle of that Tile (this is also what tells the
//                                        monitor) and the size from before tiling, if one is known
//   {frame, maximized: true, sizeBefore?}  a window maximised with the window button; the frame
//                                        is the last position, as a fallback for the monitor
// sizeBefore is {width, height}. An unknown free size is never invented: it is left out.

import {TILES, pixelsPerCm, tileRect} from './tileDecision.js';

// The file chooser Nautilus opens for another application is a plain window of Nautilus
// without a parent (docs/research/window-placement-on-wayland.md), so it only differs from a
// file-manager window by having no GTK window path.
const NAUTILUS = 'org.gnome.Nautilus';

/** How many applications are kept; the least recently used are dropped first (ADR 0007). */
export const MAX_APPLICATIONS = 200;

/** How far a second window of an application is moved right and down from an open one (ADR 0011). */
const SECOND_WINDOW_OFFSET_CM = 1;

/** How many times the offset is added at most when the spot is taken, counted from the open window. */
const MAX_OFFSET_STEPS = 10;

function isFrame(value) {
    return typeof value === 'object' && value !== null &&
        Number.isFinite(value.x) && Number.isFinite(value.y) &&
        Number.isFinite(value.width) && Number.isFinite(value.height) &&
        value.width > 0 && value.height > 0;
}

function isSize(value) {
    return typeof value === 'object' && value !== null &&
        Number.isFinite(value.width) && Number.isFinite(value.height) &&
        value.width > 0 && value.height > 0;
}

function copyFrame({x, y, width, height}) {
    return {x, y, width, height};
}

function copySize({width, height}) {
    return {width, height};
}

/** The stored entry for a window state, a copy that shares nothing with the state. */
function entryOf({frame, tile, maximized, sizeBefore}) {
    const entry = {frame: copyFrame(frame)};
    if (tile)
        entry.tile = tile;
    if (maximized)
        entry.maximized = true;
    if (sizeBefore)
        entry.sizeBefore = copySize(sizeBefore);
    return entry;
}

/** Whether a stored entry is well formed; a bad optional part makes the whole entry bad. */
function isEntry(entry) {
    if (typeof entry !== 'object' || entry === null || !isFrame(entry.frame))
        return false;
    if ('tile' in entry && !TILES.includes(entry.tile))
        return false;
    if ('maximized' in entry && entry.maximized !== true)
        return false;
    if ('tile' in entry && 'maximized' in entry)
        return false;
    return !('sizeBefore' in entry) || isSize(entry.sizeBefore);
}

/** Reads the stored text. Unreadable data gives nothing, corrupt entries are dropped. */
export function parsePlaces(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return {};
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return {};

    const places = {};
    for (const [key, entry] of Object.entries(parsed)) {
        if (isEntry(entry))
            places[key] = entryOf(entry);
    }
    return keepMostRecent(places);
}

/** The places without the least recently used applications beyond the limit. */
function keepMostRecent(places) {
    const keys = Object.keys(places);
    if (keys.length <= MAX_APPLICATIONS)
        return places;
    const result = {};
    for (const key of keys.slice(keys.length - MAX_APPLICATIONS))
        result[key] = places[key];
    return result;
}

/** The text to store for these places. */
export function serialisePlaces(places) {
    return JSON.stringify(places);
}

/** The free size an entry knows: that of a free window, the earlier one of the others, or null. */
function freeSizeOf(entry) {
    if (!entry)
        return null;
    if (entry.tile || entry.maximized)
        return entry.sizeBefore ? copySize(entry.sizeBefore) : null;
    return copySize(entry.frame);
}

/**
 * The places after a window of the application was last moved, resized or closed. The
 * application becomes the most recently used one. The given places are not changed. A state
 * without a frame size, or with a name that is no Tile, is ignored.
 * @param {{frame: object, tile?: string, maximized?: boolean, sizeBefore?: ?object}} state
 *   what the window is: a free window has only a frame; a tiled one the Tile, the Tile's
 *   rectangle as frame and the size from before tiling (null or left out if none is known); a
 *   maximised one the flag and its frame. A maximised window without a size of its own keeps
 *   the free size the application had before, so closing it maximised does not lose that size.
 */
export function rememberWindow(places, key, state) {
    if (!isFrame(state.frame))
        return places; // for example a window that closed before it was ever shown
    if (state.tile !== undefined && !TILES.includes(state.tile))
        return places;

    const sizeBefore = state.maximized ?
        state.sizeBefore ?? freeSizeOf(places[key]) : state.sizeBefore;
    const result = {...places};
    delete result[key]; // re-insert, so the most recently used application stays last
    result[key] = entryOf({...state, sizeBefore});
    return keepMostRecent(result);
}

/** The places after a free window of the application was last moved, resized or closed. */
export function rememberFree(places, key, frame) {
    return rememberWindow(places, key, {frame});
}

/**
 * The places after a window of the application closed. The window last moved or resized
 * counts, so a window that closes does not overwrite what another window of the same
 * application saved after it: then the given places are returned as they are. Otherwise the
 * closing window was the last action, as in rememberWindow.
 * @param {number} closingSavedAt when the closing window last saved its place (0: never)
 * @param {number[]} otherSavedAts the same for the application's other open windows; later
 *   saves have higher numbers
 */
export function rememberOnClose(places, key, state, closingSavedAt, otherSavedAts) {
    if (otherSavedAts.some(savedAt => savedAt > closingSavedAt))
        return places;
    return rememberWindow(places, key, state);
}

/** The index of the work area nearest to the centre of the frame (0 without any work area). */
function nearestIndex(workAreas, frame) {
    const centreX = frame.x + frame.width / 2;
    const centreY = frame.y + frame.height / 2;
    let nearest = 0;
    let nearestDistance = Infinity;
    workAreas.forEach((area, index) => {
        const dx = Math.max(area.x - centreX, 0, centreX - (area.x + area.width));
        const dy = Math.max(area.y - centreY, 0, centreY - (area.y + area.height));
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
            nearest = index;
            nearestDistance = distance;
        }
    });
    return nearest;
}

/**
 * Where a new window of the application goes, or null when nothing is remembered (then the
 * application keeps its own size and place). The remembered frame tells the monitor: the work
 * area nearest to its centre is used, so a vanished monitor falls back to the nearest one.
 * @param {{x: number, y: number, width: number, height: number}[]} workAreas
 * @returns {null |
 *   {kind: 'free', rect: object} |
 *   {kind: 'tile', tile: string, rect: object, workArea: object, sizeBefore: ?object} |
 *   {kind: 'maximized', monitor: number}}
 *   free: the remembered frame, moved back inside and shrunk to fit the work area (without any
 *   work area it is returned as it is); tile: the Tile's rectangle in the work area, the work
 *   area itself (for the anchoring rule) and the size to give back when the window is dragged
 *   out, null if none is known; maximized: the index of the monitor in `workAreas`
 */
export function placementFor(places, key, workAreas) {
    const entry = places[key];
    if (!entry)
        return null;
    const frame = copyFrame(entry.frame);
    if (workAreas.length === 0)
        return {kind: 'free', rect: frame};

    const index = nearestIndex(workAreas, frame);
    const area = workAreas[index];
    if (entry.maximized)
        return {kind: 'maximized', monitor: index};
    if (entry.tile) {
        return {
            kind: 'tile',
            tile: entry.tile,
            rect: tileRect(entry.tile, area),
            workArea: {...area},
            sizeBefore: entry.sizeBefore ? copySize(entry.sizeBefore) : null,
        };
    }

    return {kind: 'free', rect: fitInto(frame, area)};
}

/** The frame shrunk to the work area if it is larger, and moved back inside if it reaches out. */
function fitInto(frame, area) {
    const width = Math.min(frame.width, area.width);
    const height = Math.min(frame.height, area.height);
    return {
        x: Math.min(Math.max(frame.x, area.x), area.x + area.width - width),
        y: Math.min(Math.max(frame.y, area.y), area.y + area.height - height),
        width,
        height,
    };
}

/**
 * Where a new window goes when the application already has an open window (ADR 0007, ADR 0011): free,
 * never in a Tile and never maximised, with the free size the application remembers (else
 * its own default size), at the position of the most recently used open window moved 1 cm
 * right and down. A spot another window of the application sits on exactly is stepped over
 * with the same offset, at most MAX_OFFSET_STEPS offsets from the open window; the last
 * spot is used even if it is taken. The result is fitted into the work area of the monitor
 * the open window is on (without any monitor it is not fitted).
 * @param {{defaultSize: {width: number, height: number}, siblings: object[], monitors: object[]}} context
 *   defaultSize: the new window's own size, used when no free size is remembered;
 *   siblings: the frames of the application's other open windows, the most recently used
 *   first (at least one); monitors: for each monitor `workArea` and, as for the Edge zones,
 *   `width`, `height`, `widthMm`, `heightMm` (the last two may be missing)
 * @returns {{kind: 'free', rect: object}}
 */
export function placementForSecondWindow(places, key, {defaultSize, siblings, monitors}) {
    const open = siblings[0];
    const size = freeSizeOf(places[key]) ?? copySize(defaultSize);
    const monitor = monitors[nearestIndex(monitors.map(m => m.workArea), open)] ?? {};
    const step = Math.round(SECOND_WINDOW_OFFSET_CM * pixelsPerCm(monitor));
    const fit = frame => monitor.workArea ? fitInto(frame, monitor.workArea) : frame;

    let rect;
    for (let steps = 1; steps <= MAX_OFFSET_STEPS; steps++) {
        rect = fit({x: open.x + steps * step, y: open.y + steps * step, ...size});
        if (!siblings.some(sibling => sibling.x === rect.x && sibling.y === rect.y))
            break;
    }
    return {kind: 'free', rect};
}

/**
 * The key of the application a window belongs to, or null for a window the memory leaves
 * alone completely, in both directions: dialogs, windows belonging to another window,
 * full-screen windows, windows that cannot be moved or resized, windows without a
 * recognisable application, and Nautilus's parentless file chooser.
 * @param {{normal: boolean, hasParent: boolean, attachedDialog: boolean, canMove: boolean,
 *   canResize: boolean, fullscreen: boolean, appId: ?string, wmClass: ?string,
 *   gtkWindowPath: ?string}} facts what the shell knows about the window
 */
export function appKeyOf(facts) {
    if (!facts.normal || facts.hasParent || facts.attachedDialog ||
        !facts.canMove || !facts.canResize || facts.fullscreen)
        return null;

    const key = facts.appId || facts.wmClass || null;
    if (key === NAUTILUS && !facts.gtkWindowPath)
        return null;
    return key;
}
