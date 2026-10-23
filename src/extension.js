import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {EdgeTilingHint} from './edgeTilingHint.js';

export default class SnapTileExtension extends Extension {
    enable() {
        this._edgeTilingHint = new EdgeTilingHint();
        this._edgeTilingHint.show();
    }

    disable() {
        this._edgeTilingHint?.destroy();
        this._edgeTilingHint = null;
    }
}
