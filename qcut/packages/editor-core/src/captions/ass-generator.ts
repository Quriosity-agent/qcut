/**
 * ASS (Advanced SubStation Alpha) subtitle file generator.
 *
 * Converts CaptionElement[] to a complete ASS file string.
 * No browser/React dependencies.
 *
 * @module @qcut/editor-core/captions/ass-generator
 */

import type {
	CaptionElement,
	CaptionShadow,
	SubtitleStyle,
} from "../types/timeline.js";
import {
	captionFontWeight,
	resolveCaptionShadows,
	resolveSecondaryLineStyle,
	resolveSubtitleStyle,
	rgbToASSColor,
	alignToASSAlignment,
} from "./subtitle-style.js";
import {
	captionAssFade,
	resolveCaptionAnimation,
} from "./caption-animation.js";

export interface ASSGeneratorOptions {
	resolution: { width: number; height: number };
	title?: string;
	cjkFontFamily?: string;
	/** The project frame rate, for captions' fade frames. */
	fps?: number;
}

/** The style's MarginL/MarginR. */
const STYLE_SIDE_MARGIN = 10;

/**
 * How far the preview keeps a caption's line box from the frame edge its
 * style names: 20 px of padding plus the box's own 8, whatever `position.y`
 * holds (the native export does the same). This path used `position.y`, 90
 * by default, and its captions sat 62 px higher than the preview's.
 */
const CAPTION_EDGE_INSET_Y = 28;

/**
 * libass's `\blur b` is a Gaussian of σ = 2b / √ln 256 ≈ 0.849 b (measured
 * with the bundled FFmpeg), so a σ needs `\blur` σ · √ln 256 / 2.
 */
const LIBASS_BLUR_PER_SIGMA = Math.sqrt(Math.log(256)) / 2;

/**
 * The `\blur` that draws a CSS `text-shadow` (or canvas `shadowBlur`) blur
 * radius, a Gaussian of σ = radius / 2.
 */
export function assBlurForCssBlur(radius: number): number {
	return (radius / 2) * LIBASS_BLUR_PER_SIGMA;
}

function containsCJK(text: string): boolean {
	return /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(
		text
	);
}

function resolveClipStyle({
	clip,
	cjkFontFamily,
}: {
	clip: CaptionElement;
	cjkFontFamily?: string;
}): SubtitleStyle {
	const style = resolveSubtitleStyle(clip.style);
	return cjkFontFamily && containsCJK(clip.text)
		? { ...style, fontFamily: cjkFontFamily }
		: style;
}

/** Generate a complete ASS file from caption elements */
export function generateASS(
	clips: CaptionElement[],
	options: ASSGeneratorOptions
): string {
	const { resolution, title = "QCut Export" } = options;

	// Collect unique styles
	const styleMap = new Map<string, SubtitleStyle>();
	for (const clip of clips) {
		const resolved = resolveClipStyle({
			clip,
			cjkFontFamily: options.cjkFontFamily,
		});
		const key = JSON.stringify(resolved);
		if (!styleMap.has(key)) {
			styleMap.set(key, resolved);
		}
	}

	// Assign style names
	const styleNames = new Map<string, string>();
	let styleIndex = 0;
	for (const [key, _style] of styleMap) {
		styleNames.set(key, styleIndex === 0 ? "Default" : `Style${styleIndex}`);
		styleIndex++;
	}

	// Build script info
	let content = `[Script Info]
Title: ${title}
ScriptType: v4.00+
PlayResX: ${resolution.width}
PlayResY: ${resolution.height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
`;

	// Write style lines
	for (const [key, style] of styleMap) {
		const name = styleNames.get(key) || "Default";
		content += `Style: ${subtitleStyleToASSLine(name, style)}\n`;
	}

	// Write events
	content += `
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

	for (const clip of clips) {
		const resolved = resolveClipStyle({
			clip,
			cjkFontFamily: options.cjkFontFamily,
		});
		const key = JSON.stringify(resolved);
		const styleName = styleNames.get(key) || "Default";
		for (const line of captionEventsForASS({
			clip,
			style: resolved,
			resolution,
			fps: options.fps,
			styleName,
		})) {
			content += `${line}\n`;
		}
	}

	return content;
}

/**
 * A caption's Dialogue lines: its soft shadows first, each a layer of its
 * own under the text (N25), then the text. With shadows, every layer is
 * pinned with \pos at the point the style's alignment and margins give, so
 * each shadow sits exactly at its offset from the letters.
 */
function captionEventsForASS({
	clip,
	style,
	resolution,
	fps,
	styleName,
}: {
	clip: CaptionElement;
	style: SubtitleStyle;
	resolution: ASSGeneratorOptions["resolution"];
	fps?: number;
	styleName: string;
}): string[] {
	const startTime = secondsToASSTime(clip.startTime);
	const endTime = secondsToASSTime(clip.startTime + clip.duration);
	const centiseconds = (seconds: number) => Math.floor(seconds * 100);
	const fade = captionAssFade({
		style,
		fps,
		duration:
			(centiseconds(clip.startTime + clip.duration) -
				centiseconds(clip.startTime)) /
			100,
	});
	const weight = captionFontWeight(style);
	const weightTag = weight === 400 || weight === 700 ? "" : `\\b${weight}`;
	const shadows = resolveCaptionShadows(style) ?? [];
	const event = (layer: number, tags: string, body: string) =>
		`Dialogue: ${layer},${startTime},${endTime},${styleName},,0,0,0,,${tags ? `{${tags}}` : ""}${body}`;
	const pin = shadows.length > 0;
	const lines = shadows.map((shadow, layer) =>
		event(
			layer,
			`${captionAnimationTags({ clip, style, resolution, fade, pin, offset: shadow })}${weightTag}${shadowTagsForASS({ shadow, style })}`,
			captionTextForASS({ clip, style, colorTags: false })
		)
	);
	lines.push(
		event(
			shadows.length,
			`${captionAnimationTags({ clip, style, resolution, fade, pin })}${weightTag}`,
			captionTextForASS({ clip, style, colorTags: true })
		)
	);
	return lines;
}

/**
 * Tags that draw an event as one soft shadow: the letters (and outline) in
 * the shadow's colour, blurred to σ = blur ÷ 2 as the preview's
 * text-shadow is.
 */
function shadowTagsForASS({
	shadow,
	style,
}: {
	shadow: CaptionShadow;
	style: SubtitleStyle;
}): string {
	const [alpha, color] = splitAssColor(
		rgbToASSColor(shadow.color, shadow.opacity * style.fontOpacity)
	);
	const blur = `\\blur${assBlurForCssBlur(shadow.blur).toFixed(2)}`;
	// A karaoke caption's upcoming words take the secondary colour (\2c).
	if (style.outlineWidth > 0) {
		// A see-through fill shows the border as the whole widened letter.
		return `\\1a&HFF&\\2a&HFF&\\3c${color}\\3a${alpha}\\4a&HFF&\\bord${style.outlineWidth}\\shad0${blur}`;
	}
	return `\\1c${color}\\1a${alpha}\\2c${color}\\2a${alpha}\\3a&HFF&\\4a&HFF&\\bord0\\shad0${blur}`;
}

/** `&HAABBGGRR` as the `&HAA&` and `&HBBGGRR&` that override tags take. */
function splitAssColor(color: string): [string, string] {
	const hex = color.replace(/^&H/i, "").padStart(8, "0");
	return [`&H${hex.slice(0, 2)}&`, `&H${hex.slice(2)}&`];
}

function captionTextForASS({
	clip,
	style,
	colorTags,
}: {
	clip: CaptionElement;
	style: SubtitleStyle;
	/** False for a shadow layer, which draws every line in its colour. */
	colorTags: boolean;
}): string {
	const text = clip.text.trim().replace(/\n/g, "\\N");
	const karaokeMode = clip.style?.karaokeMode ?? "none";
	const words = (clip.words ?? [])
		.filter((word) => word.type === "word")
		.sort((left, right) => left.start - right.start);
	const renderedText =
		karaokeMode === "none" || words.length === 0
			? text
			: words
					.map((word, index) => {
						const clipEnd = clip.startTime + clip.duration;
						const nextStart = words[index + 1]?.start ?? clipEnd;
						const end = Math.max(word.end, nextStart);
						const durationCs = Math.max(
							1,
							Math.round((end - word.start) * 100)
						);
						const tag = karaokeMode === "karaoke" ? "kf" : "k";
						return `{\\${tag}${durationCs}}${word.text.trim()}`;
					})
					.join(" ");
	return `${renderedText}${secondaryLineForASS({ clip, style, colorTags })}`;
}

/** A bilingual caption's second-language line, after a break in its own font. */
function secondaryLineForASS({
	clip,
	style,
	colorTags,
}: {
	clip: CaptionElement;
	style: SubtitleStyle;
	colorTags: boolean;
}): string {
	const text = clip.secondaryText?.trim();
	if (!text) return "";
	const secondary = resolveSecondaryLineStyle(style);
	// \c takes the colour without its alpha: &HBBGGRR&.
	const color = colorTags
		? `\\c&H${rgbToASSColor(secondary.fontColor, 1).slice(4)}&`
		: "";
	// `{`, `}` and `\` in a font name would end the override block early.
	const family = secondary.fontFamily.replace(/[{}\\]/g, "");
	const weight =
		secondary.fontWeight === 700
			? 1
			: secondary.fontWeight === 400
				? 0
				: secondary.fontWeight;
	// Its own spacing only where it differs from the caption's (the style's).
	const spacing =
		secondary.letterSpacing === style.letterSpacing
			? ""
			: `\\fsp${secondary.letterSpacing}`;
	return `\\N{\\fn${family}\\fs${secondary.fontSize}\\b${weight}\\i${secondary.italic ? 1 : 0}${spacing}${color}}${text.replace(/\n/g, "\\N")}`;
}

/**
 * The event's fade and motion. `fade` (from the caption's fade frames)
 * replaces the animation's own; `pin` places a still caption with \pos where
 * the style's alignment and margins put it, moved by `offset`.
 */
function captionAnimationTags({
	clip,
	style,
	resolution,
	fade: frameFade,
	pin = false,
	offset = { x: 0, y: 0 },
}: {
	clip: CaptionElement;
	style: SubtitleStyle;
	resolution: ASSGeneratorOptions["resolution"];
	fade?: string;
	pin?: boolean;
	offset?: { x: number; y: number };
}): string {
	const animation = resolveCaptionAnimation({ style });
	if (animation.type === "none") {
		return `${frameFade ?? ""}${pin ? pinnedPosition({ style, resolution, offset }) : ""}`;
	}

	const clipDurationMs = Math.max(1, Math.round(clip.duration * 1000));
	const startMs = Math.min(
		clipDurationMs,
		Math.max(0, Math.round(animation.delay * 1000))
	);
	const endMs = Math.min(
		clipDurationMs,
		startMs + Math.max(1, Math.round(animation.duration * 1000))
	);
	const fade =
		frameFade ??
		`\\fade(255,0,0,${startMs},${endMs},${clipDurationMs},${clipDurationMs})`;
	if (animation.type === "fade") {
		return `${fade}${pin ? pinnedPosition({ style, resolution, offset }) : ""}`;
	}

	const margin = Math.max(10, Math.round(style.fontSize));
	const targetX =
		style.textAlign === "left"
			? margin
			: style.textAlign === "right"
				? resolution.width - margin
				: Math.round(resolution.width / 2);
	const targetY =
		style.position.align === "top"
			? margin
			: style.position.align === "center"
				? Math.round(resolution.height / 2)
				: resolution.height - margin;
	const startX = animation.type === "slide-left" ? targetX + 120 : targetX;
	const startY = animation.type === "slide-up" ? targetY + 80 : targetY;

	return `${fade}\\move(${startX + offset.x},${startY + offset.y},${targetX + offset.x},${targetY + offset.y},${startMs},${endMs})`;
}

/** `\pos` at the point the style's alignment and margins place the text. */
function pinnedPosition({
	style,
	resolution,
	offset,
}: {
	style: SubtitleStyle;
	resolution: ASSGeneratorOptions["resolution"];
	offset: { x: number; y: number };
}): string {
	const marginV = CAPTION_EDGE_INSET_Y;
	const x =
		style.textAlign === "left"
			? STYLE_SIDE_MARGIN
			: style.textAlign === "right"
				? resolution.width - STYLE_SIDE_MARGIN
				: resolution.width / 2;
	const y =
		style.position.align === "top"
			? marginV
			: style.position.align === "center"
				? resolution.height / 2
				: resolution.height - marginV;
	return `\\pos(${x + offset.x},${y + offset.y})`;
}

function subtitleStyleToASSLine(name: string, style: SubtitleStyle): string {
	const karaokeEnabled = (style.karaokeMode ?? "none") !== "none";
	const primary = rgbToASSColor(
		karaokeEnabled ? (style.highlightColor ?? "#ffff00") : style.fontColor,
		style.fontOpacity
	);
	const secondary = rgbToASSColor(
		karaokeEnabled ? (style.upcomingColor ?? style.fontColor) : "#ffffff",
		style.fontOpacity
	);
	const outline = rgbToASSColor(style.outlineColor, 1);
	const back = rgbToASSColor(style.shadowColor, 1);
	const bold = captionFontWeight(style) >= 600 ? -1 : 0;
	const italic = style.italic ? -1 : 0;
	const underline = style.underline ? 1 : 0;
	const alignment = alignToASSAlignment(style.position.align, style.textAlign);
	const marginV = CAPTION_EDGE_INSET_Y;
	// Soft shadows are layers of their own; the hard one is ASS's.
	const shadow =
		!resolveCaptionShadows(style) &&
		(style.shadowOffset.x !== 0 || style.shadowOffset.y !== 0)
			? 1
			: 0;

	return [
		name,
		style.fontFamily,
		style.fontSize,
		primary,
		secondary,
		outline,
		back,
		bold,
		italic,
		underline,
		0, // StrikeOut
		100, // ScaleX
		100, // ScaleY
		style.letterSpacing,
		0, // Angle
		1, // BorderStyle
		style.outlineWidth,
		shadow,
		alignment,
		STYLE_SIDE_MARGIN, // MarginL
		STYLE_SIDE_MARGIN, // MarginR
		marginV,
		1, // Encoding
	].join(",");
}

/** Convert seconds to ASS time format (H:MM:SS.cc) */
export function secondsToASSTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const cs = Math.floor((seconds % 1) * 100);
	return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}
