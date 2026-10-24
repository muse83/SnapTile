// The decisions of the window memory (see ADR 0007). Pure logic, no GNOME imports, so it runs
// under plain Node tests. Adapted from the decision part of the reference window memory
// (reference/window-memory/src/frameMemory.ts), cut down to what free windows need.
//
// The places are one plain object, application key -> {frame: {x, y, width, height}}. The key
// order is the order of use, the application used last comes last.

// The file chooser Nautilus opens for another application is a plain window of Nautilus
// without a parent (docs/research/window-placement-on-wayland.md), so it only differs from a
// file-manager window by having no GTK window path.
const NAUTILUS = 'org.gnome.Nautilus';

/** How many applications are kept; the least recently used are dropped first (ADR 0007). */
export const MAX_APPLICATIONS = 200;

function isFrame(value) {
    return typeof value === 'object' && value !== null &&
        Number.isFinite(value.x) && Number.isFinite(value.y) &&
        Number.isFinite(value.width) && Number.isFinite(value.height) &&
        value.width > 0 && value.height > 0;
}

function copyFrame({x, y, width, height}) {
    return {x, y, width, height};
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
        if (typeof entry === 'object' && entry !== null && isFrame(entry.frame))
            places[key] = {frame: copyFrame(entry.frame)};
    }
    return trim(places);
}

/** The places without the least recently used applications beyond the limit. */
function trim(places) {
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

/**
 * The places after a free window of the application was last moved, resized or closed. The
 * application becomes the most recently used one. The given places are not changed. A frame
 * without a size is ignored.
 */
export function rememberFree(places, key, frame) {
    if (!isFrame(frame))
        return places; // for example a window that closed before it was ever shown
    const result = {...places};
    delete result[key]; // re-insert, so the most recently used application stays last
    result[key] = {frame: copyFrame(frame)};
    return trim(result);
}

/**
 * The places after a free window of the application closed. The window last moved or resized
 * counts, so a window that closes does not overwrite what another window of the same
 * application saved after it: then the given places are returned as they are. Otherwise the
 * closing window was the last action, as in rememberFree.
 * @param {number} closingSavedAt when the closing window last saved its place (0: never)
 * @param {number[]} otherSavedAts the same for the application's other open windows; later
 *   saves have higher numbers
 */
export function rememberOnClose(places, key, frame, closingSavedAt, otherSavedAts) {
    if (otherSavedAts.some(savedAt => savedAt > closingSavedAt))
        return places;
    return rememberFree(places, key, frame);
}

/**
 * Where a new window of the application goes: its remembered frame, moved back inside and
 * shrunk to fit the work area nearest to the frame's centre. Null when nothing is remembered,
 * then the application keeps its own size and place. Without any work area the frame is
 * returned as it is.
 * @param {{x: number, y: number, width: number, height: number}[]} workAreas
 */
export function placeFor(places, key, workAreas) {
    const entry = places[key];
    if (!entry)
        return null;
    const frame = copyFrame(entry.frame);
    if (workAreas.length === 0)
        return frame;

    const centreX = frame.x + frame.width / 2;
    const centreY = frame.y + frame.height / 2;
    let nearest = workAreas[0];
    let nearestDistance = Infinity;
    for (const area of workAreas) {
        const dx = Math.max(area.x - centreX, 0, centreX - (area.x + area.width));
        const dy = Math.max(area.y - centreY, 0, centreY - (area.y + area.height));
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
            nearest = area;
            nearestDistance = distance;
        }
    }

    const width = Math.min(frame.width, nearest.width);
    const height = Math.min(frame.height, nearest.height);
    return {
        x: Math.min(Math.max(frame.x, nearest.x), nearest.x + nearest.width - width),
        y: Math.min(Math.max(frame.y, nearest.y), nearest.y + nearest.height - height),
        width,
        height,
    };
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
