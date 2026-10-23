import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

// Fragment shader. The window picture is cut only inside the visible frame, so whatever the
// application draws outside it (its own shadow, the invisible resize border) stays as it is.
// The picture is premultiplied, so scaling all four channels fades the pixel out.
const UNIFORMS = `
uniform sampler2D tex;
uniform float texture_left;
uniform float texture_top;
uniform float texture_width;
uniform float texture_height;
uniform float frame_left;
uniform float frame_top;
uniform float frame_right;
uniform float frame_bottom;
uniform float radius;
`;

const BODY = `
    vec4 color = texture2D(tex, cogl_tex_coord_in[0].xy);
    vec2 p = vec2(texture_left, texture_top) +
             cogl_tex_coord_in[0].xy * vec2(texture_width, texture_height);
    vec2 inner_low = vec2(frame_left, frame_top) + radius;
    vec2 inner_high = vec2(frame_right, frame_bottom) - radius;
    vec2 into_corner = max(inner_low - p, p - inner_high);
    bool in_frame = p.x >= frame_left && p.x <= frame_right &&
                    p.y >= frame_top && p.y <= frame_bottom;
    if (in_frame && into_corner.x > 0.0 && into_corner.y > 0.0)
        color *= clamp(radius - length(into_corner) + 0.5, 0.0, 1.0);
    cogl_color_out = color;
`;

/**
 * Where the effect's offscreen picture lies in the actor's own pixels. Clutter draws the actor
 * into a texture that is larger than the actor: it quantises the size and pads it by at least
 * 0.75 px on every side (`_clutter_actor_box_enlarge_for_effects` in Mutter), and the shader's
 * texture coordinates run over that whole texture. Mutter offers no way to ask for it, so the
 * rule is repeated here; the smoke test's corner pixels would show if it ever drifted.
 */
function offscreenTextureRect(actor) {
    const volume = actor.get_paint_volume();
    const origin = volume?.get_origin();
    const x = origin?.x ?? 0;
    const y = origin?.y ?? 0;
    const [width, height] = volume ? [volume.get_width(), volume.get_height()] : actor.get_size();
    const farX = Math.ceil(x + width + 0.75);
    const farY = Math.ceil(y + height + 0.75);
    const textureWidth = Math.round(width) + 3;
    const textureHeight = Math.round(height) + 3;
    return {
        x: farX - textureWidth, y: farY - textureHeight,
        width: textureWidth, height: textureHeight,
    };
}

// GNOME 50 hands the shader over as source text, GNOME 51 as a Cogl snippet; only the one
// the running version knows can be declared as an override.
const SNIPPET_API = typeof Clutter.ShaderEffect.new_with_snippet === 'function';

class SnippetEffect extends Clutter.ShaderEffect {
    vfunc_get_static_snippet() {
        const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, UNIFORMS, null);
        snippet.set_replace(BODY);
        return snippet;
    }
}

class SourceEffect extends Clutter.ShaderEffect {
    vfunc_get_static_shader_source() {
        return `${UNIFORMS}\nvoid main() {${BODY}}`;
    }
}

const ShaderEffectBase = GObject.registerClass(SNIPPET_API ? SnippetEffect : SourceEffect);

/**
 * Rounds the four corners of a window actor. `setFrame()` says where the visible frame lies
 * inside the actor (the actor also covers the application's shadow) and how round to cut.
 */
export const CornerEffect = GObject.registerClass(
class SnapTileCornerEffect extends ShaderEffectBase {
    _init() {
        super._init();
        this._frame = null;
        this._radius = 0;
        this._uploaded = '';
    }

    /** `frame` is {left, top, right, bottom} in actor pixels, `radius` in the same unit. */
    setFrame(frame, radius) {
        const half = Math.min(frame.right - frame.left, frame.bottom - frame.top) / 2;
        const clamped = Math.max(0, Math.min(radius, half));
        const same = this._frame &&
            this._frame.left === frame.left && this._frame.top === frame.top &&
            this._frame.right === frame.right && this._frame.bottom === frame.bottom &&
            this._radius === clamped;
        if (same)
            return;

        this._frame = {...frame};
        this._radius = clamped;
        this._upload(true);
    }

    vfunc_paint_target(node, paintContext) {
        this._upload(false);
        super.vfunc_paint_target(node, paintContext);
    }

    // Sends the numbers to the shader. At paint time only when the texture changed (it follows
    // the actor's size), which keeps the common repaint free of any allocation.
    _upload(force) {
        const actor = this.get_actor();
        if (!actor || !this._frame)
            return;

        const texture = offscreenTextureRect(actor);
        const key = `${texture.x},${texture.y},${texture.width},${texture.height}`;
        if (!force && key === this._uploaded)
            return;
        this._uploaded = key;
        this._uniform('tex', GObject.TYPE_INT, 0);
        this._uniform('texture_left', GObject.TYPE_FLOAT, texture.x);
        this._uniform('texture_top', GObject.TYPE_FLOAT, texture.y);
        this._uniform('texture_width', GObject.TYPE_FLOAT, texture.width);
        this._uniform('texture_height', GObject.TYPE_FLOAT, texture.height);
        this._uniform('frame_left', GObject.TYPE_FLOAT, this._frame.left);
        this._uniform('frame_top', GObject.TYPE_FLOAT, this._frame.top);
        this._uniform('frame_right', GObject.TYPE_FLOAT, this._frame.right);
        this._uniform('frame_bottom', GObject.TYPE_FLOAT, this._frame.bottom);
        this._uniform('radius', GObject.TYPE_FLOAT, this._radius);
    }

    _uniform(name, type, number) {
        const value = new GObject.Value();
        value.init(type);
        if (type === GObject.TYPE_INT)
            value.set_int(number);
        else
            value.set_float(number);
        this.set_uniform_value(name, value);
    }
});
