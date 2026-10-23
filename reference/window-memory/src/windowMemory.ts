// REFERENCE ONLY - NOT PART OF SnapTile. It imports modules SnapTile does not have.
// See ../README.md.

import { Meta } from '../../gi/ext';
import Settings from '../../settings/settings';
import SignalHandling from '../../utils/signalHandling';
import { logger } from '../../utils/logger';
import { sizeBeforeTile, tileOf } from '../tileState/tileState';
import { appIdOf } from '../windowPlacement/windowFacts';
import { RememberedFrames, rememberClosing } from './frameMemory';

const debug = logger('WindowMemory');

/**
 * Remembers where the last window of an application was when it closed (or when the extension
 * is disabled): same size, same position, same tile (like macOS does). Putting a new window
 * there is the job of WindowPlacement, which reads the entries through `entries()`.
 * The decisions live in frameMemory; this class only connects them to the windows.
 */
export default class WindowMemory {
    private readonly _signals: SignalHandling;
    private readonly _unmanagingIds: Map<Meta.Window, number>;

    constructor() {
        this._signals = new SignalHandling();
        this._unmanagingIds = new Map();
    }

    /** The remembered frame of every application. */
    public entries(): RememberedFrames {
        return Settings.windowMemory.entries;
    }

    public enable(): void {
        global.get_window_actors().forEach(actor => {
            const window = actor.metaWindow;
            if (window && appIdOf(window) !== null) this._trackClosing(window);
        });

        this._signals.connect(
            global.display,
            'window-created',
            (_display: Meta.Display, window: Meta.Window) =>
                this._trackClosing(window)
        );
    }

    public destroy(): void {
        this._signals.disconnect();

        this._rememberOpenWindows();

        this._unmanagingIds.forEach((id, window) => window.disconnect(id));
        this._unmanagingIds.clear();
    }

    /**
     * On shutdown or disable the windows are not closed one by one, so remember what is open.
     * The most recently used window of an app is saved last and therefore wins.
     */
    private _rememberOpenWindows(): void {
        const recentFirst = global.display.get_tab_list(
            Meta.TabList.NORMAL,
            null
        );
        [...recentFirst]
            .reverse()
            .filter(window => this._unmanagingIds.has(window))
            .forEach(window => {
                try {
                    this._remember(window);
                } catch (e) {
                    // shutting down: never let saving block the cleanup
                    debug('could not remember window on shutdown', e);
                }
            });
    }

    private _trackClosing(window: Meta.Window): void {
        if (this._unmanagingIds.has(window)) return;

        const id = window.connect('unmanaging', () => {
            this._remember(window);
            window.disconnect(id);
            this._unmanagingIds.delete(window);
        });
        this._unmanagingIds.set(window, id);
    }

    private _remember(window: Meta.Window): void {
        if (!Settings.behaviour.rememberWindows) return;

        const appId = appIdOf(window);
        if (appId === null || window.is_fullscreen()) {
            debug('not remembering window', window.get_title(), appId);
            return;
        }

        const updated = rememberClosing(this.entries(), appId, {
            frame: window.get_frame_rect(),
            maximized:
                window.maximizedHorizontally && window.maximizedVertically,
            tile: tileOf(window),
            sizeBeforeTile: sizeBeforeTile(window),
        });

        Settings.windowMemory.setEntries(updated);
        debug('remembered', appId, JSON.stringify(updated[appId]));
    }
}
