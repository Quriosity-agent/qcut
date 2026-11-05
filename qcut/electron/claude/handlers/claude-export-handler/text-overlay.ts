import type {
	ClaudeElement,
	ClaudeTimeline,
} from "../../../types/claude-api.js";
import { claudeLog } from "../../utils/logger.js";
import {
	assFamilyCoversCjk,
	assFontMetrics,
	type AssFontMetrics,
} from "./ass-font-metrics.js";
import {
	assCaptionText,
	captionEventText,
	escapeAssText,
} from "./caption-ass-lines.js";
import { canvasTextAssBaselineOffset } from "../../../types/canvas-text-baseline.js";
import {
	createNativeCaptionMeasurer,
	prepareCaptionBackground,
} from "./caption-background.js";
import {
	assCaptionFade,
	assRoundedBoxDrawing,
	assShadowColor,
	assShadowTags,
	assWeightTag,
	captionFadeSeconds,
	captionShadowsValue,
	assBlurForCssBlur,
	captionWeightValue,
	overlayWeight,
} from "./caption-ass-style.js";
import { cssColorAlpha, parseCssColor } from "./css-color.js";
import { hasJianyingTextStyleCandidate } from "./jianying-text-overlay.js";
import { HANDLER_NAME, type TextOverlay } from "./types.js";

// Electron's tsc root cannot import editor-core; mirror DEFAULT_SUBTITLE_STYLE.
const NATIVE_CAPTION_DEFAULTS = {
	fontFamily: "Arial",
	fontSize: 48,
	fontColor: "#ffffff",
	fontOpacity: 1,
	textAlign: "center",
	outlineColor: "#000000",
	outlineWidth: 2,
	backgroundColor: "#000000",
	backgroundOpacity: 0.8,
	shadowColor: "#000000",
	shadowOffsetX: 1,
	shadowOffsetY: 1,
	verticalAlign: "bottom",
	marginV: 90,
	animationDuration: 0.6,
} as const;

function numberValue({
	element,
	style,
	key,
	fallback,
}: {
	element: Record<string, unknown>;
	style: Record<string, unknown>;
	key: string;
	fallback: number;
}): number {
	const value = element[key] ?? style[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue({
	element,
	style,
	key,
	fallback,
}: {
	element: Record<string, unknown>;
	style: Record<string, unknown>;
	key: string;
	fallback: string;
}): string {
	const value = element[key] ?? style[key];
	return typeof value === "string" ? value : fallback;
}

function recordValue({ value }: { value: unknown }): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function booleanValue({
	record,
	key,
	fallback,
}: {
	record: Record<string, unknown>;
	key: string;
	fallback: boolean;
}): boolean {
	return typeof record[key] === "boolean" ? record[key] : fallback;
}

function textAlignValue({
	value,
}: {
	value: unknown;
}): TextOverlay["textAlign"] {
	return value === "left" || value === "right" ? value : "center";
}

function verticalAlignValue({
	value,
}: {
	value: unknown;
}): TextOverlay["verticalAlign"] {
	return value === "top" || value === "center" ? value : "bottom";
}

function boxVerticalAlignValue({
	value,
}: {
	value: string;
}): "top" | "middle" | "bottom" {
	return value === "top" || value === "bottom" ? value : "middle";
}

function animationTypeValue({
	value,
}: {
	value: unknown;
}): TextOverlay["animationType"] {
	return value === "fade" || value === "slide-up" || value === "slide-left"
		? value
		: "none";
}

function collectCaptionOverlay({
	source,
	element,
	style,
	content,
	duration,
	fps,
}: {
	source: ClaudeElement;
	element: Record<string, unknown>;
	style: Record<string, unknown>;
	content: string;
	duration: number;
	/** The project frame rate, for fade frames. */
	fps?: number;
}): TextOverlay {
	const position = recordValue({ value: style.position });
	const shadowOffset = recordValue({ value: style.shadowOffset });
	const shadowOffsetX = numberValue({
		element: {},
		style: shadowOffset,
		key: "x",
		fallback: NATIVE_CAPTION_DEFAULTS.shadowOffsetX,
	});
	const shadowOffsetY = numberValue({
		element: {},
		style: shadowOffset,
		key: "y",
		fallback: NATIVE_CAPTION_DEFAULTS.shadowOffsetY,
	});

	const overlay: TextOverlay = {
		id: source.id,
		content,
		startTime: source.startTime,
		endTime: source.startTime + duration,
		fontSize: numberValue({
			element,
			style,
			key: "fontSize",
			fallback: NATIVE_CAPTION_DEFAULTS.fontSize,
		}),
		fontFamily: stringValue({
			element,
			style,
			key: "fontFamily",
			fallback: NATIVE_CAPTION_DEFAULTS.fontFamily,
		}),
		color: stringValue({
			element,
			style,
			key: "fontColor",
			fallback: NATIVE_CAPTION_DEFAULTS.fontColor,
		}),
		backgroundColor: stringValue({
			element,
			style,
			key: "backgroundColor",
			fallback: NATIVE_CAPTION_DEFAULTS.backgroundColor,
		}),
		textAlign: textAlignValue({ value: style.textAlign }),
		fontWeight: booleanValue({ record: style, key: "bold", fallback: false })
			? "bold"
			: "normal",
		fontStyle: booleanValue({ record: style, key: "italic", fallback: false })
			? "italic"
			: "normal",
		x: 0,
		y: 0,
		rotation: 0,
		opacity: numberValue({
			element: {},
			style,
			key: "fontOpacity",
			fallback: NATIVE_CAPTION_DEFAULTS.fontOpacity,
		}),
		strokeColor: stringValue({
			element: {},
			style,
			key: "outlineColor",
			fallback: NATIVE_CAPTION_DEFAULTS.outlineColor,
		}),
		strokeWidth: numberValue({
			element: {},
			style,
			key: "outlineWidth",
			fallback: NATIVE_CAPTION_DEFAULTS.outlineWidth,
		}),
		strokeOpacity: 1,
		backgroundOpacity: numberValue({
			element: {},
			style,
			key: "bgOpacity",
			fallback: NATIVE_CAPTION_DEFAULTS.backgroundOpacity,
		}),
		shadowColor: stringValue({
			element: {},
			style,
			key: "shadowColor",
			fallback: NATIVE_CAPTION_DEFAULTS.shadowColor,
		}),
		shadowOpacity: shadowOffsetX !== 0 || shadowOffsetY !== 0 ? 1 : 0,
		shadowOffsetX,
		shadowOffsetY,
		// A caption's hard shadow stays hard; its soft ones come from
		// `style.shadows` below, which is the film-subtitle look (N25).
		shadowBlur: 0,
		glowColor: "#ffffff",
		glowOpacity: 0,
		glowBlur: 0,
		letterSpacing: numberValue({
			element: {},
			style,
			key: "letterSpacing",
			fallback: 0,
		}),
		lineHeight: numberValue({
			element: {},
			style,
			key: "lineSpacing",
			fallback: 1.4,
		}),
		positioning: "caption-anchor",
		verticalAlign: verticalAlignValue({ value: position.align }),
		marginV: numberValue({
			element: {},
			style: position,
			key: "y",
			fallback: NATIVE_CAPTION_DEFAULTS.marginV,
		}),
		animationType: animationTypeValue({
			value: stringValue({
				element,
				style,
				key: "animationType",
				fallback: "none",
			}),
		}),
		animationDuration: numberValue({
			element: {},
			style,
			key: "animationDuration",
			fallback: NATIVE_CAPTION_DEFAULTS.animationDuration,
		}),
		animationDelay: numberValue({
			element: {},
			style,
			key: "animationDelay",
			fallback: 0,
		}),
	};
	// Film-subtitle styling (N25): a weight between regular and bold, soft
	// shadows instead of the hard one, fades counted in frames.
	const weight = captionWeightValue(style.fontWeight);
	if (weight !== undefined) {
		overlay.weight = weight;
		overlay.fontWeight = weight >= 600 ? "bold" : "normal";
	}
	const shadows = captionShadowsValue(style.shadows);
	// An array that lost every entry to the colour guard is still truthy, and
	// assigning it would zero the style's hard Shadow without drawing a soft
	// one — leaving the caption with no shadow at all.
	if (shadows?.length) overlay.shadows = shadows;
	const fadeIn = captionFadeSeconds({ frames: style.fadeInFrames, fps });
	const fadeOut = captionFadeSeconds({ frames: style.fadeOutFrames, fps });
	if (fadeIn > 0) overlay.fadeIn = fadeIn;
	if (fadeOut > 0) overlay.fadeOut = fadeOut;
	// A bilingual caption's second-language line, in style.secondary's look
	// over the caption's own.
	const secondaryContent =
		typeof source.secondaryContent === "string"
			? source.secondaryContent.trim()
			: "";
	if (!secondaryContent) return overlay;
	const secondary = recordValue({ value: style.secondary });
	overlay.secondary = {
		content: secondaryContent,
		fontFamily: stringValue({
			element: {},
			style: secondary,
			key: "fontFamily",
			fallback: overlay.fontFamily,
		}),
		fontSize: numberValue({
			element: {},
			style: secondary,
			key: "fontSize",
			fallback: overlay.fontSize,
		}),
		color: stringValue({
			element: {},
			style: secondary,
			key: "fontColor",
			fallback: overlay.color,
		}),
		fontWeight: booleanValue({
			record: secondary,
			key: "bold",
			fallback: overlay.fontWeight === "bold",
		})
			? "bold"
			: "normal",
		fontStyle: booleanValue({
			record: secondary,
			key: "italic",
			fallback: overlay.fontStyle === "italic",
		})
			? "italic"
			: "normal",
		letterSpacing: numberValue({
			element: {},
			style: secondary,
			key: "letterSpacing",
			fallback: overlay.letterSpacing,
		}),
	};
	// Its own weight, else its bold's, else the caption's.
	const secondaryWeight =
		captionWeightValue(secondary.fontWeight) ??
		(typeof secondary.bold === "boolean" ? undefined : overlay.weight);
	if (secondaryWeight !== undefined) {
		overlay.secondary.weight = secondaryWeight;
		overlay.secondary.fontWeight = secondaryWeight >= 600 ? "bold" : "normal";
	}
	return overlay;
}

function collectCanvasTextOverlay({
	source,
	element,
	style,
	content,
	duration,
}: {
	source: ClaudeElement;
	element: Record<string, unknown>;
	style: Record<string, unknown>;
	content: string;
	duration: number;
}): TextOverlay {
	const textAlign = stringValue({
		element,
		style,
		key: "textAlign",
		fallback: "center",
	});
	const fontWeight = stringValue({
		element,
		style,
		key: "fontWeight",
		fallback: "normal",
	});
	const fontStyle = stringValue({
		element,
		style,
		key: "fontStyle",
		fallback: "normal",
	});
	const backgroundColor = stringValue({
		element,
		style,
		key: "backgroundColor",
		fallback: "transparent",
	});

	const overlay: TextOverlay = {
		id: source.id,
		content,
		startTime: source.startTime,
		endTime: source.startTime + duration,
		fontSize: numberValue({ element, style, key: "fontSize", fallback: 48 }),
		fontFamily: stringValue({
			element,
			style,
			key: "fontFamily",
			fallback: "Arial",
		}),
		color: stringValue({
			element,
			style,
			key: "color",
			fallback: "#ffffff",
		}),
		backgroundColor,
		textAlign: textAlignValue({ value: textAlign }),
		fontWeight: fontWeight === "bold" ? "bold" : "normal",
		fontStyle: fontStyle === "italic" ? "italic" : "normal",
		x: numberValue({ element, style, key: "x", fallback: 0 }),
		y: numberValue({ element, style, key: "y", fallback: 0 }),
		rotation: numberValue({ element, style, key: "rotation", fallback: 0 }),
		opacity: numberValue({ element, style, key: "opacity", fallback: 1 }),
		strokeColor: stringValue({
			element,
			style,
			key: "strokeColor",
			fallback: "#000000",
		}),
		strokeWidth: numberValue({
			element,
			style,
			key: "strokeWidth",
			fallback: 0,
		}),
		strokeOpacity: numberValue({
			element,
			style,
			key: "strokeOpacity",
			fallback: 1,
		}),
		backgroundOpacity: numberValue({
			element,
			style,
			key: "backgroundOpacity",
			fallback: backgroundColor === "transparent" ? 0 : 1,
		}),
		shadowColor: stringValue({
			element,
			style,
			key: "shadowColor",
			fallback: "#000000",
		}),
		shadowOpacity: numberValue({
			element,
			style,
			key: "shadowOpacity",
			fallback: 0,
		}),
		shadowOffsetX: numberValue({
			element,
			style,
			key: "shadowOffsetX",
			fallback: 0,
		}),
		shadowOffsetY: numberValue({
			element,
			style,
			key: "shadowOffsetY",
			fallback: 0,
		}),
		shadowBlur: numberValue({
			element,
			style,
			key: "shadowBlur",
			fallback: 0,
		}),
		glowColor: stringValue({
			element,
			style,
			key: "glowColor",
			fallback: "#ffffff",
		}),
		glowOpacity: numberValue({
			element,
			style,
			key: "glowOpacity",
			fallback: 0,
		}),
		glowBlur: numberValue({
			element,
			style,
			key: "glowBlur",
			fallback: 0,
		}),
		letterSpacing: numberValue({
			element,
			style,
			key: "letterSpacing",
			fallback: 0,
		}),
		lineHeight: numberValue({
			element,
			style,
			key: "lineHeight",
			fallback: 1.2,
		}),
		// The preview's text box (text-style.ts defaults), so lines wrap and
		// align in the same place as on screen.
		boxWidth: numberValue({ element, style, key: "width", fallback: 640 }),
		boxHeight: numberValue({ element, style, key: "height", fallback: 180 }),
		boxPadding: numberValue({
			element,
			style,
			key: "backgroundPadding",
			fallback: 12,
		}),
		boxRadius: numberValue({
			element,
			style,
			key: "backgroundRadius",
			fallback: 4,
		}),
		boxVerticalAlign: boxVerticalAlignValue({
			value: stringValue({
				element,
				style,
				key: "verticalAlign",
				fallback: "middle",
			}),
		}),
		positioning: "canvas-offset",
		verticalAlign: "center",
		marginV: 0,
		animationType: animationTypeValue({
			value: stringValue({
				element,
				style,
				key: "animationType",
				fallback: "none",
			}),
		}),
		animationDuration: numberValue({
			element,
			style,
			key: "animationDuration",
			fallback: 0.5,
		}),
		animationDelay: numberValue({
			element,
			style,
			key: "animationDelay",
			fallback: 0,
		}),
	};
	// The preview blurs its text-shadow, but ASS's own Shadow column can only
	// offset a hard copy of the letters — and it offsets by one distance on
	// both axes, so an offset of (0, 0) drew nothing at all and `shadowBlur`
	// never reached the export (N32). Draw it as the soft-shadow layer the
	// caption path already renders instead.
	// A colour carrying its own alpha (#rrggbbaa, rgba(…)) overrides
	// shadowOpacity rather than combining with it, because the preview's
	// colorWithOpacity appends the opacity only to #rgb and #rrggbb.
	const shadow = assShadowColor(overlay.shadowColor);
	const shadowAlpha = cssColorAlpha(shadow, overlay.shadowOpacity);
	if (shadowAlpha > 0) {
		overlay.shadows = [
			{
				color: shadow.hex,
				opacity: shadowAlpha,
				blur: Math.max(0, overlay.shadowBlur),
				x: overlay.shadowOffsetX,
				y: overlay.shadowOffsetY,
			},
		];
	}
	return overlay;
}

/** Collect text-like timeline elements for the native FFmpeg overlay pass. */
export function collectTextOverlays(timeline: ClaudeTimeline): TextOverlay[] {
	const overlays: TextOverlay[] = [];
	for (const [trackIndex, track] of timeline.tracks.entries()) {
		if (track.hidden) continue;
		for (const source of track.elements) {
			if (
				source.hidden ||
				!["text", "captions", "markdown"].includes(source.type) ||
				hasJianyingTextStyleCandidate({ source })
			) {
				continue;
			}
			const element = source as unknown as Record<string, unknown>;
			const style = (source.style ?? {}) as Record<string, unknown>;
			const content =
				typeof source.content === "string"
					? source.content
					: typeof element.text === "string"
						? element.text
						: source.markdownContent;
			if (!content?.trim()) continue;
			const duration =
				typeof source.duration === "number" && source.duration > 0
					? source.duration
					: source.endTime - source.startTime;
			if (!Number.isFinite(duration) || duration <= 0) continue;

			const overlay =
				source.type === "captions"
					? collectCaptionOverlay({
							source,
							element,
							style,
							// As the preview, the canvas export and stacking read it: a
							// leading or trailing line break draws no empty line.
							content: content.trim(),
							duration,
							fps: timeline.fps,
						})
					: collectCanvasTextOverlay({
							source,
							element,
							style,
							content,
							duration,
						});
			overlays.push({ ...overlay, trackIndex });
		}
	}
	return overlays.sort((left, right) => left.startTime - right.startTime);
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/**
 * `opacity` is the colour's own `…Opacity` field, which a colour with its own
 * alpha replaces; `elementOpacity` applies on top of either, as the preview's
 * element opacity does.
 */
function assColor({
	color,
	opacity = 1,
	elementOpacity = 1,
	fallback = "#ffffff",
}: {
	color: string;
	opacity?: number;
	elementOpacity?: number;
	/** What a colour that cannot be read draws as; a shadow's is black. */
	fallback?: string;
}): string {
	const parsed = parseCssColor(color) ?? { hex: fallback };
	const normalized = parsed.hex.slice(1);
	const alpha = Math.round(
		(1 - clamp01(cssColorAlpha(parsed, opacity) * elementOpacity)) * 255
	)
		.toString(16)
		.padStart(2, "0")
		.toUpperCase();
	return `&H${alpha}${normalized.slice(4, 6)}${normalized.slice(2, 4)}${normalized.slice(0, 2)}`.toUpperCase();
}

/** Override tags that turn an event into the glow layer, or "" without a glow. */
function assGlowTags({ overlay }: { overlay: TextOverlay }): string {
	if (overlay.glowOpacity <= 0 || overlay.glowBlur <= 0) return "";
	const colour = assColor({
		color: overlay.glowColor,
		opacity: overlay.glowOpacity,
		elementOpacity: overlay.opacity,
	});
	// A blurred copy of the glyphs themselves in the glow colour, with no
	// border, shadow or box: the preview's text-shadow blur radius r is a
	// Gaussian of sigma r/2, and libass's \blur b one of sigma 0.849 b.
	const blur = assBlurForCssBlur(overlay.glowBlur);
	return `\\1c&H${colour.slice(4)}&\\1a&H${colour.slice(2, 4)}&\\4a&HFF&\\bord0\\shad0\\blur${blur.toFixed(2)}`;
}

/** Seconds as an ASS time keeps them: to the hundredth. */
function assSeconds(seconds: number): number {
	return Math.round(Math.max(0, seconds) * 100) / 100;
}

function assTime(seconds: number): string {
	const safe = Math.max(0, seconds);
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const remainder = safe % 60;
	return `${hours}:${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}

const ASS_ALIGNMENTS = {
	top: { left: 7, center: 8, right: 9 },
	center: { left: 4, center: 5, right: 6 },
	bottom: { left: 1, center: 2, right: 3 },
} as const;

/** CJK ideographs/kana/hangul plus full-width forms. */
const CJK_PATTERN = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;

/**
 * Pick an ASS font family that can actually render the overlay content.
 *
 * On macOS libass asks CoreText for a CJK fallback and gets pointed at the
 * reserved PingFangUI.ttc, which third-party processes cannot open — every
 * CJK glyph then renders as an empty box. Naming an openable CJK family in
 * the style is the only reliable path, so CJK content overrides the
 * requested (Latin) family. Latin-only content keeps the element's font.
 */
/**
 * Families that carry CJK glyphs and that libass can open (PingFang is
 * reserved by macOS and is deliberately absent). A request for one of these
 * is honoured; anything else falls back to the platform default.
 */
const CJK_CAPABLE_FONT_FAMILIES = new Set(
	[
		"Songti SC",
		"Songti TC",
		"Kaiti SC",
		"Kaiti TC",
		"Heiti SC",
		"Heiti TC",
		"STSong",
		"STKaiti",
		"STHeiti",
		"STFangsong",
		"Yuanti SC",
		"Wawati SC",
		"Weibei SC",
		"Xingkai SC",
		"Hannotate SC",
		"HanziPen SC",
		"Baoli SC",
		"Libian SC",
		"LingWai SC",
		"Lantinghei SC",
		"Hiragino Sans GB",
		"Hiragino Sans",
		"Arial Unicode MS",
		"Noto Sans CJK SC",
		"Noto Sans CJK TC",
		"Noto Sans CJK JP",
		"Noto Serif CJK SC",
		"Source Han Sans",
		"Source Han Serif",
		"Microsoft YaHei",
		"SimHei",
		"SimSun",
		"FangSong",
		"KaiTi",
	].map((name) => name.toLowerCase())
);

/** The platform's CJK fallback when a requested family cannot render CJK. */
export function assCjkFallbackFamily(): string {
	if (process.platform === "darwin") return "Hiragino Sans GB";
	if (process.platform === "win32") return "Microsoft YaHei";
	return "Noto Sans CJK SC";
}

export function assFontFamily(overlay: TextOverlay): string {
	const requested = overlay.fontFamily.replace(/,/g, " ").trim();
	if (!CJK_PATTERN.test(overlay.content)) return requested;
	if (CJK_CAPABLE_FONT_FAMILIES.has(requested.toLowerCase())) return requested;
	// An installed font that covers CJK (Source Han Serif CN, …) is one libass
	// opens itself from the export's font folder (PingFang is not in one).
	if (
		!/^pingfang/i.test(requested) &&
		assFamilyCoversCjk({ family: requested })
	) {
		return requested;
	}
	const fallback = assCjkFallbackFamily();
	claudeLog.warn(
		HANDLER_NAME,
		`Text overlay font "${requested}" has no CJK glyphs; exporting with ${fallback}`
	);
	return fallback;
}

/** The preview gives captions 20 px of edge padding plus the box's own 8 × 16. */
const CAPTION_EDGE_INSET_Y = 28;
const CAPTION_EDGE_INSET_X = 36;
/** Captions wrap inside the middle 80 % of the frame, like the preview's box. */
const CAPTION_SIDE_MARGIN = 0.1;

interface AssPlacement {
	/** ASS numpad alignment: which point of the text block sits on (x, y). */
	alignment: number;
	x: number;
	y: number;
	/** Event margins; libass wraps lines to PlayResX − marginL − marginR. */
	marginL: number;
	marginR: number;
}

/**
 * Where the text block is pinned and how wide it may run, matching the
 * preview: a text element fills its box (wrapping at the inner width,
 * aligned within it); a caption sits at the frame edge the style names, moved
 * away from it by `stackOffset` when earlier captions share that edge (the
 * same rule as caption-stacking.ts, so the preview, the canvas export and
 * this pass stack alike; pinning also keeps libass's own collision shifting
 * out of it).
 */
function assPlacement({
	overlay,
	width,
	height,
	lineHeightEm,
	stackOffset = 0,
	lastLineLeading,
	textMetrics,
}: {
	overlay: TextOverlay;
	width: number;
	height: number;
	/** The line height libass lays out for the overlay's font, in em. */
	lineHeightEm: number;
	/** Captions stacked under this one, as a distance from the edge. */
	stackOffset?: number;
	/**
	 * A caption's last line's half-leading when it is in another font (a
	 * bilingual caption's second-language line), which pins the bottom edge.
	 */
	lastLineLeading?: number;
	textMetrics?: AssFontMetrics;
}): AssPlacement {
	// CSS centres each em inside its line box (half-leading); libass stacks
	// the font's own line height with the em at its bottom. Pinning a top or
	// bottom edge therefore moves by half the difference of the two line
	// heights, so the glyphs land where the preview draws them.
	const leading =
		(overlay.fontSize * overlay.lineHeight - overlay.fontSize * lineHeightEm) /
		2;
	if (overlay.positioning === "canvas-offset") {
		const boxWidth = overlay.boxWidth ?? 640;
		const boxHeight = overlay.boxHeight ?? 180;
		const padding = overlay.boxPadding ?? 12;
		const centreX = width / 2 + overlay.x;
		const centreY = height / 2 + overlay.y;
		const left = centreX - boxWidth / 2 + padding;
		const right = centreX + boxWidth / 2 - padding;
		const top = centreY - boxHeight / 2 + padding;
		const bottom = centreY + boxHeight / 2 - padding;
		const vertical =
			overlay.boxVerticalAlign === "top"
				? "top"
				: overlay.boxVerticalAlign === "bottom"
					? "bottom"
					: "center";
		const baselineOffset = textMetrics
			? canvasTextAssBaselineOffset({
					fontSize: overlay.fontSize,
					lineHeight: overlay.lineHeight,
					verticalAlign: vertical === "center" ? "middle" : vertical,
					metrics: textMetrics,
				})
			: undefined;
		return {
			alignment: ASS_ALIGNMENTS[vertical][overlay.textAlign],
			x:
				overlay.textAlign === "left"
					? left
					: overlay.textAlign === "right"
						? right
						: centreX,
			y:
				vertical === "top"
					? top + (baselineOffset ?? leading)
					: vertical === "bottom"
						? bottom + (baselineOffset ?? -leading)
						: centreY + (baselineOffset ?? 0),
			marginL: Math.max(0, Math.round(left)),
			marginR: Math.max(0, Math.round(width - right)),
		};
	}
	const side = Math.round(width * CAPTION_SIDE_MARGIN);
	const inset = CAPTION_EDGE_INSET_Y + leading + stackOffset;
	const lastLeading = lastLineLeading ?? leading;
	return {
		alignment: ASS_ALIGNMENTS[overlay.verticalAlign][overlay.textAlign],
		x:
			overlay.textAlign === "left"
				? CAPTION_EDGE_INSET_X
				: overlay.textAlign === "right"
					? width - CAPTION_EDGE_INSET_X
					: width / 2,
		// libass centres the glyph block, CSS the whole box: with a last line
		// in another font the two leadings differ by half their difference.
		y:
			overlay.verticalAlign === "top"
				? inset
				: overlay.verticalAlign === "center"
					? height / 2 + (leading - lastLeading) / 2
					: height - (CAPTION_EDGE_INSET_Y + lastLeading + stackOffset),
		marginL: side,
		marginR: side,
	};
}

/**
 * How far from its edge each caption draws: the summed block heights of the
 * earlier-starting captions that share its edge and overlap it in time
 * (caption-stacking.ts has the same rule for the preview and canvas export).
 */
function captionStackOffsets({
	captions,
}: {
	captions: ReturnType<typeof prepareCaptionBackground>[];
}): Map<string, number> {
	const offsets = new Map<string, number>();
	const edgeCaptions = captions
		.filter(({ overlay }) => overlay.verticalAlign !== "center")
		// The preview's order: earliest start keeps the edge; at the same
		// start the caption on the higher track (drawn on top) does.
		.sort(
			({ overlay: left }, { overlay: right }) =>
				left.startTime - right.startTime ||
				(right.trackIndex ?? 0) - (left.trackIndex ?? 0)
		);
	for (const caption of edgeCaptions) {
		const { overlay } = caption;
		let offset = 0;
		for (const other of edgeCaptions) {
			if (other === caption) break;
			if (
				other.overlay.verticalAlign === overlay.verticalAlign &&
				other.overlay.startTime < overlay.endTime &&
				overlay.startTime < other.overlay.endTime
			) {
				offset += other.box.height;
			}
		}
		offsets.set(overlay.id, offset);
	}
	return offsets;
}

/** Build an ASS subtitle document that preserves core QCut text styling. */
export function buildTextAss({
	overlays,
	width,
	height,
}: {
	overlays: TextOverlay[];
	width: number;
	height: number;
}): string {
	const styles: string[] = [];
	const events: string[] = [];
	const measureText = overlays.some(
		(overlay) => overlay.positioning === "caption-anchor"
	)
		? createNativeCaptionMeasurer()
		: undefined;
	const preparedCaptions = new Map<
		string,
		ReturnType<typeof prepareCaptionBackground>
	>();
	for (const overlay of overlays) {
		if (overlay.positioning !== "caption-anchor" || !measureText) continue;
		preparedCaptions.set(
			overlay.id,
			prepareCaptionBackground({
				overlay,
				width,
				height,
				stackOffset: 0,
				fontFamilyFor: assFontFamily,
				measureText,
			})
		);
	}
	const stackOffsets = captionStackOffsets({
		captions: [...preparedCaptions.values()],
	});
	for (const [index, original] of overlays.entries()) {
		const measuredCaption = preparedCaptions.get(original.id);
		const stackOffset = stackOffsets.get(original.id) ?? 0;
		const preparedCaption = measuredCaption && {
			...measuredCaption,
			box: {
				...measuredCaption.box,
				y:
					measuredCaption.box.y +
					(original.verticalAlign === "top" ? stackOffset : -stackOffset),
			},
		};
		const overlay = preparedCaption?.overlay ?? original;
		const styleName = `QCutText${index}`;
		const family = assFontFamily(overlay);
		// libass sizes a font by its Windows ascent + descent, the editor by
		// the em; the factor makes the exported em the one the preview shows.
		const metrics = assFontMetrics({
			family,
			bold: overlay.fontWeight === "bold",
			italic: overlay.fontStyle === "italic",
		});
		const caption =
			overlay.positioning === "caption-anchor"
				? captionEventText({
						overlay,
						fontSize: overlay.fontSize * metrics.sizeFactor,
						fontFamilyFor: assFontFamily,
					})
				: undefined;
		const placement = assPlacement({
			overlay,
			width,
			height,
			// libass makes a caption line as tall as its ASS size (the font's
			// Windows height); the hhea height differs for fonts like Songti SC.
			lineHeightEm: caption ? metrics.sizeFactor : metrics.lineHeightEm,
			stackOffset: stackOffsets.get(overlay.id) ?? 0,
			lastLineLeading: caption?.lastLineLeading,
			textMetrics: metrics,
		});
		const backgroundEnabled =
			overlay.backgroundColor !== "transparent" &&
			overlay.backgroundOpacity > 0;
		const backgroundColor = assColor({
			color: overlay.backgroundColor,
			opacity: overlay.backgroundOpacity,
			elementOpacity: overlay.opacity,
		});
		const captionBox = backgroundEnabled && caption !== undefined;
		const textBox = backgroundEnabled && caption === undefined;
		const fontSize = overlay.fontSize * metrics.sizeFactor;
		styles.push(
			[
				styleName,
				family,
				fontSize.toFixed(2),
				assColor({ color: overlay.color, elementOpacity: overlay.opacity }),
				assColor({ color: overlay.color, elementOpacity: overlay.opacity }),
				assColor({
					color: overlay.strokeColor,
					opacity: overlay.strokeOpacity,
					elementOpacity: overlay.opacity,
				}),
				assColor({
					color: overlay.shadowColor,
					opacity: overlay.shadowOpacity,
					elementOpacity: overlay.opacity,
					fallback: "#000000",
				}),
				overlay.fontWeight === "bold" ? -1 : 0,
				overlay.fontStyle === "italic" ? -1 : 0,
				0,
				0,
				100,
				100,
				overlay.letterSpacing.toFixed(2),
				0,
				1,
				overlay.strokeWidth,
				// Soft shadows are layers of their own; the hard one is ASS's.
				overlay.shadows?.length
					? 0
					: Math.max(
							Math.abs(overlay.shadowOffsetX),
							Math.abs(overlay.shadowOffsetY)
						),
				placement.alignment,
				0,
				0,
				0,
				1,
			].join(",")
		);
		const { x, y } = placement;
		const animationStart = Math.max(0, overlay.animationDelay * 1000);
		const animationEnd = Math.max(
			animationStart,
			(overlay.animationDelay + overlay.animationDuration) * 1000
		);
		/** The block's position or slide, moved by (dx, dy) for a shadow. */
		const motionAt = (dx: number, dy: number) => {
			const [px, py] = [(x + dx).toFixed(2), (y + dy).toFixed(2)];
			const timing = `${animationStart.toFixed(0)},${animationEnd.toFixed(0)}`;
			if (overlay.animationType === "slide-up") {
				return `\\move(${px},${(y + dy + 80).toFixed(2)},${px},${py},${timing})`;
			}
			if (overlay.animationType === "slide-left") {
				return `\\move(${(x + dx + 120).toFixed(2)},${py},${px},${py},${timing})`;
			}
			return `\\pos(${px},${py})`;
		};
		const start = assTime(overlay.startTime);
		const end = assTime(overlay.endTime);
		const durationMs = Math.round(
			(assSeconds(overlay.endTime) - assSeconds(overlay.startTime)) * 1000
		);
		const animationFade =
			caption && overlay.animationType !== "none"
				? `\\fade(255,0,0,${animationStart.toFixed(0)},${animationEnd.toFixed(0)},${durationMs},${durationMs})`
				: overlay.animationType === "fade"
					? `\\fad(${Math.max(1, overlay.animationDuration * 1000).toFixed(0)},0)`
					: "";
		const fade =
			assCaptionFade({
				overlay,
				duration: assSeconds(overlay.endTime) - assSeconds(overlay.startTime),
			}) ?? animationFade;
		const weight = overlayWeight(overlay);
		const weightTag =
			weight === 400 || weight === 700 ? "" : assWeightTag(weight);
		// The preview turns a text element about its box's centre.
		const origin =
			overlay.positioning === "canvas-offset" && overlay.rotation !== 0
				? `\\org(${(width / 2 + overlay.x).toFixed(2)},${(height / 2 + overlay.y).toFixed(2)})`
				: "";
		// \q1 wraps greedily at the event margins, the way the preview's box does.
		const shared = `\\q${caption ? 2 : 1}${origin}\\frz${(-overlay.rotation).toFixed(2)}${fade}${weightTag}`;
		const tags = `${motionAt(0, 0)}${shared}`;
		const margins = `${placement.marginL},${placement.marginR},0`;
		const glow = assGlowTags({ overlay });
		const eventText =
			caption?.text ??
			assCaptionText({
				runs: [
					{
						lines: overlay.content.split(/\r?\n/).map(escapeAssText),
						fontSize: overlay.fontSize,
						assFontSize: fontSize,
						fontTags: "",
					},
				],
				lineSpacing: overlay.lineHeight,
			});
		// Soft shadows first, each on its own layer under the text: the letters
		// in the shadow's colour (the second line's own colour left out).
		const shadows = overlay.shadows ?? [];
		// A bilingual shadow inherits its layer's color rather than the second
		// language's fill; other text reuses the already-spaced glyph event.
		const shadowText =
			shadows.length && caption
				? (captionEventText({
						overlay,
						fontSize,
						fontFamilyFor: assFontFamily,
						colorTags: false,
					}).text ?? eventText)
				: eventText;
		if (textBox) {
			const boxWidth = overlay.boxWidth ?? 640;
			const boxHeight = overlay.boxHeight ?? 180;
			const left = width / 2 + overlay.x - boxWidth / 2;
			const top = height / 2 + overlay.y - boxHeight / 2;
			events.push(
				`Dialogue: 0,${start},${end},${styleName},,0,0,0,,{\\an7\\p1\\bord0\\shad0${motionAt(left - x, top - y)}${shared}\\1c&H${backgroundColor.slice(4)}&\\1a&H${backgroundColor.slice(2, 4)}&}${assRoundedBoxDrawing(
					{
						width: boxWidth,
						height: boxHeight,
						radius: overlay.boxRadius ?? 4,
					}
				)}`
			);
		}
		if (captionBox && preparedCaption) {
			const box = preparedCaption.box;
			events.push(
				`Dialogue: 0,${start},${end},${styleName},,0,0,0,,{\\an7\\p1\\bord0\\shad0${motionAt(box.x - x, box.y - y)}${shared}\\1c&H${backgroundColor.slice(4)}&\\1a&H${backgroundColor.slice(2, 4)}&}${assRoundedBoxDrawing(box)}`
			);
		}
		const firstLayer = textBox || captionBox ? 1 : 0;
		for (const [layer, shadow] of shadows.entries()) {
			events.push(
				`Dialogue: ${firstLayer + layer},${start},${end},${styleName},,${margins},,{${motionAt(shadow.x, shadow.y)}${shared}${assShadowTags({ shadow, overlay })}}${shadowText}`
			);
		}
		const base = firstLayer + shadows.length;
		if (glow) {
			// The glow is the same text on a lower layer, blurred in the glow colour.
			events.push(
				`Dialogue: ${base},${start},${end},${styleName},,${margins},,{${tags}${glow}}${eventText}`
			);
		}
		events.push(
			`Dialogue: ${base + (glow ? 1 : 0)},${start},${end},${styleName},,${margins},,{${tags}}${eventText}`
		);
	}
	return [
		"[Script Info]",
		"ScriptType: v4.00+",
		`PlayResX: ${width}`,
		`PlayResY: ${height}`,
		"ScaledBorderAndShadow: yes",
		"WrapStyle: 2",
		"",
		"[V4+ Styles]",
		"Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
		...styles.map((style) => `Style: ${style}`),
		"",
		"[Events]",
		"Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
		...events,
		"",
	].join("\n");
}
