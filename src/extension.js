import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {DragSnap} from './dragSnap.js';
import {EdgeTilingHint} from './edgeTilingHint.js';
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
        this._windowMemory = new WindowMemory(this.getSettings(), this._tiledWindows, this._dragSnap);
        this._windowMemory.enable();
    }

    disable() {
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
