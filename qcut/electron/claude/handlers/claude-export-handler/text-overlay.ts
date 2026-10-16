import type {
	ClaudeElement,
	ClaudeTimeline,
} from "../../../types/claude-api.js";
import { claudeLog } from "../../utils/logger.js";
import { assFontMetrics } from "./ass-font-metrics.js";
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
}: {
	source: ClaudeElement;
	element: Record<string, unknown>;
	style: Record<string, unknown>;
	content: string;
	duration: number;
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

	return {
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

	return {
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
}

/** Collect text-like timeline elements for the native FFmpeg overlay pass. */
export function collectTextOverlays(timeline: ClaudeTimeline): TextOverlay[] {
	const overlays: TextOverlay[] = [];
	for (const track of timeline.tracks) {
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

			overlays.push(
				source.type === "captions"
					? collectCaptionOverlay({
							source,
							element,
							style,
							content,
							duration,
						})
					: collectCanvasTextOverlay({
							source,
							element,
							style,
							content,
							duration,
						})
			);
		}
	}
	return overlays.sort((left, right) => left.startTime - right.startTime);
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function assColor(hex: string, opacity: number): string {
	const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "ffffff";
	const alpha = Math.round((1 - clamp01(opacity)) * 255)
		.toString(16)
		.padStart(2, "0")
		.toUpperCase();
	return `&H${alpha}${normalized.slice(4, 6)}${normalized.slice(2, 4)}${normalized.slice(0, 2)}`.toUpperCase();
}

/** Override tags that turn an event into the glow layer, or "" without a glow. */
function assGlowTags({ overlay }: { overlay: TextOverlay }): string {
	if (overlay.glowOpacity <= 0 || overlay.glowBlur <= 0) return "";
	const colour = assColor(
		overlay.glowColor,
		overlay.glowOpacity * overlay.opacity
	);
	// A blurred copy of the glyphs themselves in the glow colour, with no
	// border, shadow or box: the preview's text-shadow blur radius r is a
	// Gaussian of sigma r/2, which is what libass's \blur takes.
	return `\\1c&H${colour.slice(4)}&\\1a&H${colour.slice(2, 4)}&\\4a&HFF&\\bord0\\shad0\\blur${(overlay.glowBlur / 2).toFixed(2)}`;
}

function assTime(seconds: number): string {
	const safe = Math.max(0, seconds);
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const remainder = safe % 60;
	return `${hours}:${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function escapeAssText(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/{/g, "\\{")
		.replace(/}/g, "\\}")
		.replace(/\r?\n/g, "\\N");
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
 * aligned within it); a caption sits at the frame edge the style names,
 * where every lane draws, so two captions at once overlap as on screen
 * instead of libass stacking them.
 */
function assPlacement({
	overlay,
	width,
	height,
	lineHeightEm,
}: {
	overlay: TextOverlay;
	width: number;
	height: number;
	/** The line height libass lays out for the overlay's font, in em. */
	lineHeightEm: number;
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
					? top + leading
					: vertical === "bottom"
						? bottom - leading
						: centreY,
			marginL: Math.max(0, Math.round(left)),
			marginR: Math.max(0, Math.round(width - right)),
		};
	}
	const side = Math.round(width * CAPTION_SIDE_MARGIN);
	return {
		alignment: ASS_ALIGNMENTS[overlay.verticalAlign][overlay.textAlign],
		x:
			overlay.textAlign === "left"
				? CAPTION_EDGE_INSET_X
				: overlay.textAlign === "right"
					? width - CAPTION_EDGE_INSET_X
					: width / 2,
		y:
			overlay.verticalAlign === "top"
				? CAPTION_EDGE_INSET_Y + leading
				: overlay.verticalAlign === "center"
					? height / 2
					: height - CAPTION_EDGE_INSET_Y - leading,
		marginL: side,
		marginR: side,
	};
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
	for (const [index, overlay] of overlays.entries()) {
		const styleName = `QCutText${index}`;
		const family = assFontFamily(overlay);
		// libass sizes a font by its Windows ascent + descent, the editor by
		// the em; the factor makes the exported em the one the preview shows.
		const metrics = assFontMetrics({
			family,
			bold: overlay.fontWeight === "bold",
			italic: overlay.fontStyle === "italic",
		});
		const placement = assPlacement({
			overlay,
			width,
			height,
			lineHeightEm: metrics.lineHeightEm,
		});
		const backgroundEnabled =
			overlay.backgroundColor !== "transparent" &&
			overlay.backgroundOpacity > 0;
		const fontSize = overlay.fontSize * metrics.sizeFactor;
		styles.push(
			[
				styleName,
				family,
				fontSize.toFixed(2),
				assColor(overlay.color, overlay.opacity),
				assColor(overlay.color, overlay.opacity),
				assColor(overlay.strokeColor, overlay.strokeOpacity * overlay.opacity),
				assColor(
					backgroundEnabled ? overlay.backgroundColor : overlay.shadowColor,
					backgroundEnabled
						? overlay.backgroundOpacity * overlay.opacity
						: overlay.shadowOpacity * overlay.opacity
				),
				overlay.fontWeight === "bold" ? -1 : 0,
				overlay.fontStyle === "italic" ? -1 : 0,
				0,
				0,
				100,
				100,
				overlay.letterSpacing.toFixed(2),
				0,
				backgroundEnabled ? 3 : 1,
				overlay.strokeWidth,
				Math.max(
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
		let motion = `\\pos(${x.toFixed(2)},${y.toFixed(2)})`;
		if (overlay.animationType === "slide-up") {
			motion = `\\move(${x.toFixed(2)},${(y + 80).toFixed(2)},${x.toFixed(2)},${y.toFixed(2)},${animationStart.toFixed(0)},${animationEnd.toFixed(0)})`;
		} else if (overlay.animationType === "slide-left") {
			motion = `\\move(${(x + 120).toFixed(2)},${y.toFixed(2)},${x.toFixed(2)},${y.toFixed(2)},${animationStart.toFixed(0)},${animationEnd.toFixed(0)})`;
		}
		const fade =
			overlay.animationType === "fade"
				? `\\fad(${Math.max(1, overlay.animationDuration * 1000).toFixed(0)},0)`
				: "";
		// \q1 wraps greedily at the event margins, the way the preview's box does.
		const tags = `${motion}\\q1\\frz${(-overlay.rotation).toFixed(2)}${fade}`;
		const margins = `${placement.marginL},${placement.marginR},0`;
		const glow = assGlowTags({ overlay });
		if (glow) {
			// The glow is the same text on a lower layer, blurred in the glow colour.
			events.push(
				`Dialogue: 0,${assTime(overlay.startTime)},${assTime(overlay.endTime)},${styleName},,${margins},,{${tags}${glow}}${escapeAssText(overlay.content)}`
			);
		}
		events.push(
			`Dialogue: ${glow ? 1 : 0},${assTime(overlay.startTime)},${assTime(overlay.endTime)},${styleName},,${margins},,{${tags}}${escapeAssText(overlay.content)}`
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
