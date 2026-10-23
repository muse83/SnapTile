// REFERENCE ONLY - NOT PART OF SnapTile. It imports modules SnapTile does not have.
// See ../README.md.

import { Meta } from '../../gi/ext';

/** A normal top-level window: not a dialog, not transient for another window. */
export function isNormalTopLevel(window: Meta.Window): boolean {
    return (
        window.windowType === Meta.WindowType.NORMAL &&
        window.get_transient_for() === null &&
        !window.is_attached_dialog()
    );
}

/** The application of a window (only known once it is shown), null for windows that do not count. */
export function appIdOf(window: Meta.Window): string | null {
    if (!isNormalTopLevel(window)) return null;
    return window.get_gtk_application_id() || window.get_wm_class() || null;
}
