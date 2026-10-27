// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 muse83

// Decides which Tile a window drag selects. Pure logic, no GNOME imports, so it runs under
// plain Node tests. Every monitor has all its zones on its own, also on edges shared with
// another monitor. The shell glue feeds in raw pointer and monitor data and gets back the
// Tile, its rectangle and the Window look sizes in pixels.

const CM_PER_INCH = 2.54;
const FALLBACK_DPI = 96;
// Plausible range for the density a monitor reports; anything outside is treated as
// bogus size information (my threshold, see docs/research/edge-tiling-feasibility.md).
const MIN_DPI = 20; // a 55" 1080p TV is about 40
const MAX_DPI = 400;
// Sizes Mutter ignores because firmware encodes an aspect ratio instead of a real size.
const ASPECT_AS_SIZE_MM = [[16, 9], [16, 10], [160, 90], [160, 100], [1600, 900], [1600, 1000]];

const ZONE_DEPTH_CM = 1;
const SIDE_STRIP_END_CM = 3;
const CORNER_RADIUS_MM = 2;
const MARGIN_MM = 0.83;

function isUsableSize(widthMm, heightMm) {
    return Number.isFinite(widthMm) && Number.isFinite(heightMm) &&
        widthMm > 0 && heightMm > 0 &&
        !ASPECT_AS_SIZE_MM.some(([w, h]) => w === widthMm && h === heightMm);
}

/**
 * Logical pixels per centimetre of a monitor ({width, height, widthMm, heightMm}).
 * Falls back to 96 DPI when the physical size is missing or implausible.
 */
export function pixelsPerCm(monitor) {
    const {width, height, widthMm, heightMm} = monitor;
    const fallback = FALLBACK_DPI / CM_PER_INCH;
    if (!isUsableSize(widthMm, heightMm))
        return fallback;

    const dpiX = width / (widthMm / (CM_PER_INCH * 10));
    const dpiY = height / (heightMm / (CM_PER_INCH * 10));
    if (![dpiX, dpiY].every(dpi => dpi >= MIN_DPI && dpi <= MAX_DPI))
        return fallback;

    return width / (widthMm / 10);
}

/**
 * The Window look in logical pixels for one monitor ({width, height, widthMm, heightMm}):
 * corner radius and visual margin, converted from millimetres with that monitor's density.
 */
export function lookSizes(monitor) {
    const perCm = pixelsPerCm(monitor);
    return {
        radius: Math.round(CORNER_RADIUS_MM * perCm / 10),
        margin: Math.round(MARGIN_MM * perCm / 10),
    };
}

/**
 * `rect` pulled in by `margin` on every side: the part of a window or Tile that is visible
 * once the Window margin is applied. A rectangle too small for it shrinks to zero around its
 * centre instead of turning inside out.
 */
export function insetRect(rect, margin) {
    const inset = (start, length) => {
        const m = Math.min(margin, length / 2);
        return {start: start + m, length: length - 2 * m};
    };
    const col = inset(rect.x, rect.width);
    const row = inset(rect.y, rect.height);
    return {x: col.start, y: row.start, width: col.length, height: row.length};
}

function splitAt(start, length, parts, index) {
    const edge = i => start + Math.ceil(length * i / parts);
    return {x: edge(index), width: edge(index + 1) - edge(index)};
}

function quarterOrHalf(area, left, top, horizontalHalf, verticalHalf) {
    const cols = horizontalHalf ? 2 : 1;
    const rows = verticalHalf ? 2 : 1;
    const col = splitAt(area.x, area.width, cols, left ? 0 : cols - 1);
    const row = splitAt(area.y, area.height, rows, top ? 0 : rows - 1);
    return {x: col.x, y: row.x, width: col.width, height: row.width};
}

function thirdsRect(area, first, last) {
    const a = splitAt(area.x, area.width, 3, first);
    const b = splitAt(area.x, area.width, 3, last);
    return {x: a.x, y: area.y, width: b.x + b.width - a.x, height: area.height};
}

function thirdUnderPointer(area, x) {
    const index = Math.floor((x - area.x) * 3 / area.width);
    return Math.min(2, Math.max(0, index));
}

const THIRD_NAMES = ['third-1', 'third-2', 'third-3'];

/** The names of the 14 Tiles. */
export const TILES = [
    'top-left', 'top-right', 'bottom-left', 'bottom-right',
    'top-half', 'bottom-half', 'left', 'right',
    ...THIRD_NAMES, 'two-thirds-left', 'two-thirds-right', 'full',
];

/**
 * The rectangle of the named Tile inside a work area, or null for a name that is no Tile. The
 * one place that turns a Tile into pixels: a drag and a reopened window get the same result.
 */
export function tileRect(tile, area) {
    switch (tile) {
    case 'top-left': return quarterOrHalf(area, true, true, true, true);
    case 'top-right': return quarterOrHalf(area, false, true, true, true);
    case 'bottom-left': return quarterOrHalf(area, true, false, true, true);
    case 'bottom-right': return quarterOrHalf(area, false, false, true, true);
    case 'top-half': return quarterOrHalf(area, true, true, false, true);
    case 'bottom-half': return quarterOrHalf(area, true, false, false, true);
    case 'left': return quarterOrHalf(area, true, true, true, false);
    case 'right': return quarterOrHalf(area, false, true, true, false);
    case 'full': return {...area};
    case 'third-1': return thirdsRect(area, 0, 0);
    case 'third-2': return thirdsRect(area, 1, 1);
    case 'third-3': return thirdsRect(area, 2, 2);
    case 'two-thirds-left': return thirdsRect(area, 0, 1);
    case 'two-thirds-right': return thirdsRect(area, 1, 2);
    default: return null;
    }
}

// Merged thirds: state is {monitor, anchor, current}. The anchor is the third the merge
// started from; returning to it gives the single third again, moving on to the far
// neighbour re-anchors on the third just left. Skipping a third falls back to single.
function nextThirdsState(previous, monitorIndex, current) {
    const fresh = {monitor: monitorIndex, anchor: current, current};
    if (!previous || previous.monitor !== monitorIndex)
        return fresh;
    if (current === previous.current)
        return previous;
    if (current === previous.anchor || Math.abs(current - previous.current) !== 1)
        return fresh;
    return {monitor: monitorIndex, anchor: previous.current, current};
}

function thirdsTile(state) {
    if (state.anchor === state.current)
        return THIRD_NAMES[state.current];
    return Math.min(state.anchor, state.current) === 0 ? 'two-thirds-left' : 'two-thirds-right';
}

/**
 * Where the top left corner of a window goes after it was snapped into `rect` and ended up
 * `size` big, because it could not get as small as the Tile: at the Tile's top left corner,
 * moved back only as far as needed to keep the window inside the work area. A window larger
 * than the work area sits at the work area's top left.
 */
export function anchoredOrigin(rect, size, workArea) {
    const fit = (start, length, areaStart, areaLength) =>
        Math.max(areaStart, Math.min(start, areaStart + areaLength - length));
    return {
        x: fit(rect.x, size.width, workArea.x, workArea.width),
        y: fit(rect.y, size.height, workArea.y, workArea.height),
    };
}

/**
 * @param {object} input
 * @param {{x: number, y: number}} input.pointer pointer position in logical pixels
 * @param {Array<{x, y, width, height, widthMm, heightMm, workArea: {x, y, width, height}}>} input.monitors
 * @param {object|null} [input.state] the `state` of the previous result while the drag
 *   continues; omit or null at the start of a drag
 * @returns {{tile: string, rect: object, visible: object, workArea: object, look: {radius: number, margin: number}, state: object|null}|null}
 *   `rect` is where the window is placed, `visible` the same pulled in by the Window margin
 *   (what the Tile preview draws)
 *   null when the pointer is in no Edge zone (the preview is hidden)
 */
export function decideTile({pointer, monitors, state = null}) {
    const index = monitors.findIndex(m =>
        pointer.x >= m.x && pointer.x < m.x + m.width &&
        pointer.y >= m.y && pointer.y < m.y + m.height);
    if (index < 0)
        return null;

    const monitor = monitors[index];
    const area = monitor.workArea;
    const perCm = pixelsPerCm(monitor);
    const depth = ZONE_DEPTH_CM * perCm;
    const sideEnd = SIDE_STRIP_END_CM * perCm;

    const toLeft = pointer.x - monitor.x;
    const toRight = monitor.x + monitor.width - 1 - pointer.x;
    const toTop = pointer.y - monitor.y;
    const toBottom = monitor.y + monitor.height - 1 - pointer.y;

    const inLeft = toLeft < depth;
    const inRight = toRight < depth;
    const inTop = toTop < depth;
    const inBottom = toBottom < depth;

    let placed = null;
    let nextState = null;

    if ((inLeft || inRight) && (inTop || inBottom)) {
        placed = `${inBottom ? 'bottom' : 'top'}-${inLeft ? 'left' : 'right'}`;
    } else if (inLeft || inRight) {
        if (toTop >= depth && toTop < sideEnd)
            placed = 'top-half';
        else if (toBottom >= depth && toBottom < sideEnd)
            placed = 'bottom-half';
        else
            placed = inLeft ? 'left' : 'right';
    } else if (inTop) {
        placed = 'full';
    } else if (inBottom) {
        nextState = nextThirdsState(state, index, thirdUnderPointer(area, pointer.x));
        placed = thirdsTile(nextState);
    }

    if (!placed)
        return null;

    const look = lookSizes(monitor);
    const rect = tileRect(placed, area);
    return {
        tile: placed,
        rect,
        visible: insetRect(rect, look.margin),
        workArea: {...area},
        look,
        state: nextState,
    };
}
