// Decides which Tile a window drag selects. Pure logic, no GNOME imports, so it runs under
// plain Node tests. The shell glue feeds in raw pointer and monitor data and gets back the
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

// Edge at the pointer is shared with another monitor if that monitor touches it and
// covers the pointer's position along the edge.
function bordersAt(monitor, monitors, pointer) {
    const right = monitor.x + monitor.width;
    const bottom = monitor.y + monitor.height;
    const covers = (m, axis) => axis === 'y'
        ? pointer.y >= m.y && pointer.y < m.y + m.height
        : pointer.x >= m.x && pointer.x < m.x + m.width;

    const others = monitors.filter(m => m !== monitor);
    return {
        left: others.some(m => m.x + m.width === monitor.x && covers(m, 'y')),
        right: others.some(m => m.x === right && covers(m, 'y')),
        top: others.some(m => m.y + m.height === monitor.y && covers(m, 'x')),
        bottom: others.some(m => m.y === bottom && covers(m, 'x')),
    };
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

function thirdsTile(area, state) {
    if (state.anchor === state.current) {
        return {tile: THIRD_NAMES[state.current], rect: thirdsRect(area, state.current, state.current)};
    }
    const first = Math.min(state.anchor, state.current);
    return {
        tile: first === 0 ? 'two-thirds-left' : 'two-thirds-right',
        rect: thirdsRect(area, first, first + 1),
    };
}

/**
 * @param {object} input
 * @param {{x: number, y: number}} input.pointer pointer position in logical pixels
 * @param {Array<{x, y, width, height, widthMm, heightMm, workArea: {x, y, width, height}}>} input.monitors
 * @param {object|null} [input.state] the `state` of the previous result while the drag
 *   continues; omit or null at the start of a drag
 * @returns {{tile: string, rect: object, look: {radius: number, margin: number}, state: object|null}|null}
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
    const free = bordersAt(monitor, monitors, pointer);

    const toLeft = pointer.x - monitor.x;
    const toRight = monitor.x + monitor.width - 1 - pointer.x;
    const toTop = pointer.y - monitor.y;
    const toBottom = monitor.y + monitor.height - 1 - pointer.y;

    const inLeft = !free.left && toLeft < depth;
    const inRight = !free.right && toRight < depth;
    const inTop = !free.top && toTop < depth;
    const inBottom = !free.bottom && toBottom < depth;

    let placed = null;
    let nextState = null;

    if ((inLeft || inRight) && (inTop || inBottom)) {
        placed = {
            tile: `${inBottom ? 'bottom' : 'top'}-${inLeft ? 'left' : 'right'}`,
            rect: quarterOrHalf(area, inLeft, inTop, true, true),
        };
    } else if (inLeft || inRight) {
        const side = inLeft ? 'left' : 'right';
        if (toTop >= depth && toTop < sideEnd) {
            placed = {tile: 'top-half', rect: quarterOrHalf(area, true, true, false, true)};
        } else if (toBottom >= depth && toBottom < sideEnd) {
            placed = {tile: 'bottom-half', rect: quarterOrHalf(area, true, false, false, true)};
        } else {
            placed = {tile: side, rect: quarterOrHalf(area, inLeft, true, true, false)};
        }
    } else if (inTop) {
        placed = {tile: 'full', rect: {...area}};
    } else if (inBottom) {
        nextState = nextThirdsState(state, index, thirdUnderPointer(area, pointer.x));
        placed = thirdsTile(area, nextState);
    }

    if (!placed)
        return null;

    return {
        ...placed,
        look: {
            radius: Math.round(CORNER_RADIUS_MM * perCm / 10),
            margin: Math.round(MARGIN_MM * perCm / 10),
        },
        state: nextState,
    };
}
