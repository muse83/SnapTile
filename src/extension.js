// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 muse83

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {DragSnap} from './dragSnap.js';
import {EdgeTilingHint} from './edgeTilingHint.js';
import {KeyboardTiling} from './keyboardTiling.js';
import {MonitorSizes} from './monitorSizes.js';
import {TiledWindows} from './tiledWindows.js';
import {WindowLook} from './windowLook.js';
import {WindowMemory} from './windowMemory.js';

export default class SnapTileExtension extends Extension {
    enable() {
        this._edgeTilingHint = new EdgeTilingHint();
        this._edgeTilingHint.show();
        this._monitorSizes = new MonitorSizes();
        this._monitorSizes.enable();
        this._tiledWindows = new TiledWindows();
        this._dragSnap = new DragSnap(this._monitorSizes, this._tiledWindows);
        this._dragSnap.enable();
        this._windowLook = new WindowLook(this._monitorSizes);
        this._windowLook.enable();
        const settings = this.getSettings();
        this._windowMemory = new WindowMemory(settings, this._tiledWindows, this._dragSnap,
            this._monitorSizes);
        this._windowMemory.enable();
        this._keyboardTiling = new KeyboardTiling(settings, this._dragSnap);
        this._keyboardTiling.enable();
    }

    disable() {
        this._keyboardTiling?.destroy();
        this._keyboardTiling = null;
        this._windowMemory?.destroy();
        this._windowMemory = null;
        this._windowLook?.destroy();
        this._windowLook = null;
        this._dragSnap?.destroy();
        this._dragSnap = null;
        this._tiledWindows?.clear();
        this._tiledWindows = null;
        this._monitorSizes?.destroy();
        this._monitorSizes = null;
        this._edgeTilingHint?.destroy();
        this._edgeTilingHint = null;
    }
}
