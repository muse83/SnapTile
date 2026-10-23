import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {DragSnap} from './dragSnap.js';
import {EdgeTilingHint} from './edgeTilingHint.js';
import {WindowLook} from './windowLook.js';

export default class SnapTileExtension extends Extension {
    enable() {
        this._edgeTilingHint = new EdgeTilingHint();
        this._edgeTilingHint.show();
        this._dragSnap = new DragSnap();
        this._dragSnap.enable();
        this._windowLook = new WindowLook();
        this._windowLook.enable();
    }

    disable() {
        this._windowLook?.destroy();
        this._windowLook = null;
        this._dragSnap?.destroy();
        this._dragSnap = null;
        this._edgeTilingHint?.destroy();
        this._edgeTilingHint = null;
    }
}
