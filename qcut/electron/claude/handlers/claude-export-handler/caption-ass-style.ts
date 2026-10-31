/**
 * The film-subtitle parts of a caption's style in the native export (N25,
 * 2026-10-30 trailer report): a weight between regular and bold (SemiBold
 * 600), soft shadows (a blurred copy of the letters per shadow, under the
 * text), and fades counted in frames.
 *
 * Electron's tsc root cannot import editor-core, so the reading mirrors
 * `resolveCaptionShadows`, `captionFontWeight` and `captionAssFade` there;
 * the preview and the canvas export use those.
 *
 * @module electron/claude/handlers/claude-export-handler/caption-ass-style
 */

import type { TextOverlay, TextOverlayShadow } from "./types.js";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * libass's `\blur b` is a Gaussian of σ = 2b / √ln 256 ≈ 0.849 b (measured
 * with the bundled FFmpeg 8.1.2: σ 1.66, 3.36, 6.78 for b 2, 4, 8), so a
 * σ needs `\blur` σ · √ln 256 / 2.
 */
export const LIBASS_BLUR_PER_SIGMA = Math.sqrt(Math.log(256)) / 2;

/**
 * The `\blur` that draws a CSS `text-shadow` blur radius, a Gaussian of
 * σ = radius / 2 (the same conversion as editor-core's, which this process
 * cannot import at run time).
 */
export function assBlurForCssBlur(radius: number): number {
	return (radius / 2) * LIBASS_BLUR_PER_SIGMA;
}

function finite(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * A `#rrggbb` to build an ASS colour from. `assColorParts` slices the hex
 * positionally, so a named colour, an `rgba(…)` or a short `#rgb` would
 * become a different colour entirely; those fall back to black.
 */
export function assHexColor(value: string): string {
	if (HEX_COLOR.test(value)) return value;
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
	if (!short) return "#000000";
	return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
}

/** `fontWeight` when it is a weight; undefined leaves `bold`'s 700 or 400. */
export function captionWeightValue(value: unknown): number | undefined {
	return typeof value === "number" && value >= 100 && value <= 900
		? Math.round(value)
		: undefined;
}

/** The stored `shadows`, each complete; undefined keeps the single shadow. */
export function captionShadowsValue(
	value: unknown
): TextOverlayShadow[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const shadows: TextOverlayShadow[] = [];
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null) continue;
		const shadow = entry as Record<string, unknown>;
		if (typeof shadow.color !== "string" || !HEX_COLOR.test(shadow.color)) {
			continue;
		}
		shadows.push({
			color: shadow.color,
			opacity: Math.min(1, Math.max(0, finite(shadow.opacity, 1))),
			blur: Math.max(0, finite(shadow.blur, 0)),
			x: finite(shadow.x, 0),
			y: finite(shadow.y, 0),
		});
	}
	return shadows;
}

/** Fade frames at the project rate, in seconds; 0 for none. */
export function captionFadeSeconds({
	frames,
	fps,
}: {
	frames: unknown;
	fps: number | undefined;
}): number {
	return typeof frames === "number" && frames > 0 && fps && fps > 0
		? frames / fps
		: 0;
}

/** The overlay's weight: its own, else bold's 700 or regular 400. */
export function overlayWeight(overlay: {
	weight?: number;
	fontWeight: "normal" | "bold";
}): number {
	return overlay.weight ?? (overlay.fontWeight === "bold" ? 700 : 400);
}

/**
 * `\b` for a weight: libass's own `\b1`/`\b0` for bold and regular, the
 * weight itself (`\b600`) for anything between, which picks that face.
 */
export function assWeightTag(weight: number): string {
	if (weight === 700) return "\\b1";
	if (weight === 400) return "\\b0";
	return `\\b${weight}`;
}

/**
 * `\fade` for a caption with fade frames, its times in ms from the event's
 * start; undefined when it has none, so its animation keeps its own tag. A
 * fade-in takes over the animation's opacity ramp (a slide still moves).
 */
export function assCaptionFade({
	overlay,
	duration,
}: {
	overlay: TextOverlay;
	/** The event's length in seconds, as its rounded times give it. */
	duration: number;
}): string | undefined {
	const fadeIn = overlay.fadeIn ?? 0;
	const fadeOut = overlay.fadeOut ?? 0;
	if (fadeIn <= 0 && fadeOut <= 0) return undefined;
	const ms = (seconds: number) => Math.max(0, Math.round(seconds * 1000));
	// The same clamps as the preview's resolveCaptionAnimation.
	const delay = Math.min(60, Math.max(0, overlay.animationDelay));
	const length = Math.min(10, Math.max(0.1, overlay.animationDuration));
	const [t1, t2] =
		fadeIn > 0
			? [0, ms(fadeIn)]
			: overlay.animationType === "none"
				? [0, 0]
				: [ms(delay), ms(delay + length)];
	const end = ms(duration);
	const t3 = fadeOut > 0 ? Math.max(t2, end - ms(fadeOut)) : end;
	return `\\fade(255,0,255,${t1},${t2},${t3},${end})`;
}

/** `&HBBGGRR&` and `&HAA&` for a colour at an opacity. */
function assColorParts(
	hex: string,
	opacity: number
): { color: string; alpha: string } {
	const rgb = hex.slice(1);
	const alpha = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255)
		.toString(16)
		.padStart(2, "0");
	return {
		color:
			`&H${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}&`.toUpperCase(),
		alpha: `&H${alpha}&`.toUpperCase(),
	};
}

/**
 * Override tags that draw an event as one soft shadow: the letters (and
 * their outline, as CSS casts text-shadow from both) in the shadow's colour,
 * blurred to σ = blur ÷ 2 — what the preview's text-shadow and the canvas
 * export's blur filter draw — and nothing else. Its position is the
 * caller's: the text's, moved by the shadow's offset.
 */
export function assShadowTags({
	shadow,
	overlay,
	borderless = false,
}: {
	shadow: TextOverlayShadow;
	overlay: TextOverlay;
	/**
	 * A background box makes the style's BorderStyle 3, where `\bord` fills a
	 * box rather than widening the letters — so casting the shadow from the
	 * border would paint a solid rectangle in the shadow's colour. Cast it
	 * from the fill alone instead, as the export dialog's path does.
	 */
	borderless?: boolean;
}): string {
	const { color, alpha } = assColorParts(
		assHexColor(shadow.color),
		shadow.opacity * overlay.opacity
	);
	const blur = `\\blur${assBlurForCssBlur(shadow.blur).toFixed(2)}`;
	if (!borderless && overlay.strokeWidth > 0) {
		// A see-through fill shows the border as the whole widened letter.
		return `\\1a&HFF&\\3c${color}\\3a${alpha}\\4a&HFF&\\bord${overlay.strokeWidth}\\shad0${blur}`;
	}
	return `\\1c${color}\\1a${alpha}\\3a&HFF&\\4a&HFF&\\bord0\\shad0${blur}`;
}
