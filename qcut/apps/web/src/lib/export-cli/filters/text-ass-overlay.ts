import {
	cssColorAlpha,
	parseCssColor,
	type AssFaceMetrics,
	type AssFontMetricsLookup,
} from "@qcut/editor-core";
import { rgbToASSColor } from "@/lib/captions/subtitle-style";
import {
	assBlurForCssBlur,
	secondsToASSTime,
} from "@/lib/captions/ass-generator";
import { getCurvedTextTransforms } from "@/lib/text/curved-text";
import {
	getTextAnimationState,
	resolveTextAnimation,
} from "@/lib/text/text-animation";
import { resolveAnimatedTextElement } from "@/lib/text/text-element-animation";
import { resolveTextStyle } from "@/lib/text/text-style";
import {
	buildTextFont,
	createTextWidthMeasurer,
	measureTextLineWidth,
	wrapTextToWidth,
	type TextWidthMeasurer,
} from "@/lib/text/text-measurement";
import type { TextElement, TimelineTrack } from "@/types/timeline";
import { assCompatibleFontFamily } from "@/lib/text/ass-font";

export interface TextASSExport {
	content: string;
	renderedElementIds: Set<string>;
}

function assAlpha(opacity: number): string {
	return Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255)
		.toString(16)
		.padStart(2, "0")
		.toUpperCase();
}

function assOverrideColor(color: string, fallback = "#ffffff"): string {
	const value = (parseCssColor(color)?.hex ?? fallback).slice(1);
	return `&H${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}&`.toUpperCase();
}

/** What a colour field draws at; see `cssColorAlpha`. */
function colorOpacity(color: string, opacity: number): number {
	const parsed = parseCssColor(color);
	return parsed ? cssColorAlpha(parsed, opacity) : opacity;
}

/** The family this element's ASS names, and what libass does with it. */
function resolveAssFace({
	element,
	fontMetrics,
	familyCoversCjk,
}: {
	element: TextElement;
	fontMetrics?: AssFontMetricsLookup;
	familyCoversCjk?: (family: string) => boolean;
}): { family: string; metrics?: AssFaceMetrics } {
	const family = assCompatibleFontFamily({
		family: element.fontFamily,
		content: element.content,
		coversCjk: familyCoversCjk,
	});
	return {
		family,
		metrics: fontMetrics?.({
			family,
			bold: element.fontWeight === "bold",
			italic: element.fontStyle === "italic",
		}),
	};
}

function escapeASSText(text: string): string {
	// `{` opens an ASS override block and would swallow the following text, so
	// escape it (libass renders `\{` as a literal brace). A bare `}` outside an
	// override block already renders literally and `\}` is not portable, so it
	// stays as-is.
	return text
		.replaceAll("\\", "\\\\")
		.replaceAll("{", "\\{")
		.replace(/\r?\n/g, "\\N");
}

function wrapMeasuredText({
	element,
	measureTextWidth,
}: {
	element: TextElement;
	measureTextWidth?: TextWidthMeasurer;
}): string[] {
	const style = resolveTextStyle(element);
	const usableWidth = Math.max(1, style.width - style.backgroundPadding * 2);
	const font = buildTextFont({
		fontFamily: element.fontFamily,
		fontSize: element.fontSize,
		fontStyle: element.fontStyle,
		fontWeight: element.fontWeight,
	});
	const textWidthMeasurer =
		measureTextWidth ?? createTextWidthMeasurer({ fontSize: element.fontSize });
	return wrapTextToWidth({
		maxWidth: usableWidth,
		measureLineWidth: ({ text }) =>
			measureTextLineWidth({
				font,
				letterSpacing: style.letterSpacing,
				measureTextWidth: textWidthMeasurer,
				text,
			}),
		text: element.content,
	});
}

function getTextAnchor({
	element,
	canvasWidth,
	canvasHeight,
	face,
}: {
	element: TextElement;
	canvasWidth: number;
	canvasHeight: number;
	face?: AssFaceMetrics;
}): { x: number; y: number; alignment: number } {
	const style = resolveTextStyle(element);
	// CSS centres each em inside its line box, libass stacks the font's own line
	// height with the em at its bottom, so a pinned top or bottom edge moves by
	// half the difference of the two (the native export's assPlacement). An
	// unmeasured face keeps its nominal size, and so its old position.
	const leading = face
		? (element.fontSize * style.lineHeight -
				element.fontSize * face.lineHeightEm) /
			2
		: 0;
	const centerX = canvasWidth / 2 + element.x;
	const centerY = canvasHeight / 2 + element.y;
	const horizontalIndex =
		element.textAlign === "left" ? 0 : element.textAlign === "right" ? 2 : 1;
	const verticalIndex =
		style.verticalAlign === "top"
			? 2
			: style.verticalAlign === "bottom"
				? 0
				: 1;
	const alignment = verticalIndex * 3 + horizontalIndex + 1;
	const x =
		horizontalIndex === 0
			? centerX - style.width / 2 + style.backgroundPadding
			: horizontalIndex === 2
				? centerX + style.width / 2 - style.backgroundPadding
				: centerX;
	const y =
		verticalIndex === 2
			? centerY - style.height / 2 + style.backgroundPadding + leading
			: verticalIndex === 0
				? centerY + style.height / 2 - style.backgroundPadding - leading
				: centerY;
	return { x, y, alignment };
}

function getStraightLineLayout({
	element,
	canvasWidth,
	canvasHeight,
	measureTextWidth,
	face,
}: {
	element: TextElement;
	canvasWidth: number;
	canvasHeight: number;
	measureTextWidth?: TextWidthMeasurer;
	face?: AssFaceMetrics;
}): Array<{ text: string; x: number; y: number; alignment: number }> {
	const style = resolveTextStyle(element);
	const anchor = getTextAnchor({ element, canvasWidth, canvasHeight, face });
	const lines = wrapMeasuredText({ element, measureTextWidth });
	const lineAdvance = element.fontSize * style.lineHeight;
	return lines.map((text, lineIndex) => {
		let y = anchor.y;
		if (style.verticalAlign === "top") {
			y += lineIndex * lineAdvance;
		} else if (style.verticalAlign === "bottom") {
			y -= (lines.length - 1 - lineIndex) * lineAdvance;
		} else {
			y += (lineIndex - (lines.length - 1) / 2) * lineAdvance;
		}
		return { text, x: anchor.x, y, alignment: anchor.alignment };
	});
}

function motionTags({
	element,
	x,
	y,
	targetOpacity,
	outlineOpacity,
}: {
	element: TextElement;
	x: number;
	y: number;
	targetOpacity: number;
	/**
	 * The outline's own opacity when it differs from the fill's: `\alpha` sets
	 * every colour's, so it would override the style's outline alpha.
	 */
	outlineOpacity?: number;
}): string {
	const animation = resolveTextAnimation(element);
	const startMs = Math.round(animation.delay * 1000);
	const endMs = Math.round((animation.delay + animation.duration) * 1000);
	let position = `\\pos(${x.toFixed(2)},${y.toFixed(2)})`;
	if (animation.type === "slide-up") {
		position = `\\move(${x.toFixed(2)},${(y + 80).toFixed(2)},${x.toFixed(2)},${y.toFixed(2)},${startMs},${endMs})`;
	} else if (animation.type === "slide-left") {
		position = `\\move(${(x + 120).toFixed(2)},${y.toFixed(2)},${x.toFixed(2)},${y.toFixed(2)},${startMs},${endMs})`;
	}

	const targetAlpha =
		outlineOpacity === undefined
			? `\\alpha&H${assAlpha(targetOpacity)}&`
			: `\\1a&H${assAlpha(targetOpacity)}&\\3a&H${assAlpha(outlineOpacity)}&`;
	if (animation.type === "none") {
		return `${position}${targetAlpha}`;
	}
	return `${position}\\alpha&HFF&\\t(${startMs},${endMs},${targetAlpha})`;
}

function roundedRectangleDrawing({
	width,
	height,
	radius,
}: {
	width: number;
	height: number;
	radius: number;
}): string {
	const r = Math.min(radius, width / 2, height / 2);
	const k = r * 0.552_284_75;
	return [
		`m ${r} 0`,
		`l ${width - r} 0`,
		`b ${width - r + k} 0 ${width} ${r - k} ${width} ${r}`,
		`l ${width} ${height - r}`,
		`b ${width} ${height - r + k} ${width - r + k} ${height} ${width - r} ${height}`,
		`l ${r} ${height}`,
		`b ${r - k} ${height} 0 ${height - r + k} 0 ${height - r}`,
		`l 0 ${r}`,
		`b 0 ${r - k} ${r - k} 0 ${r} 0`,
	].join(" ");
}

function styleLine({
	name,
	element,
	family,
	face,
}: {
	name: string;
	element: TextElement;
	family: string;
	face?: AssFaceMetrics;
}): string {
	const style = resolveTextStyle(element);
	return [
		name,
		family,
		// libass sizes a face by its Windows ascent + descent, the editor by the
		// em: the factor makes the exported em the one the preview shows.
		face
			? Math.round(element.fontSize * face.sizeFactor * 100) / 100
			: element.fontSize,
		rgbToASSColor(element.color, 1),
		"&H00FFFFFF",
		rgbToASSColor(style.strokeColor, style.strokeOpacity),
		rgbToASSColor(style.shadowColor, style.shadowOpacity, "#000000"),
		element.fontWeight === "bold" ? -1 : 0,
		element.fontStyle === "italic" ? -1 : 0,
		element.textDecoration === "underline" ? -1 : 0,
		element.textDecoration === "line-through" ? -1 : 0,
		100,
		100,
		style.letterSpacing,
		0,
		1,
		style.strokeWidth,
		0,
		5,
		0,
		0,
		0,
		1,
	].join(",");
}

function eventLine({
	layer,
	start,
	end,
	style,
	text,
}: {
	layer: number;
	start: number;
	end: number;
	style: string;
	text: string;
}): string {
	return `Dialogue: ${layer},${secondsToASSTime(start)},${secondsToASSTime(end)},${style},,0,0,0,,${text}`;
}

function buildElementEvents({
	element,
	index,
	canvasWidth,
	canvasHeight,
	eventStart,
	eventEnd,
	measureTextWidth,
	fontMetrics,
	familyCoversCjk,
}: {
	element: TextElement;
	index: number;
	canvasWidth: number;
	canvasHeight: number;
	eventStart?: number;
	eventEnd?: number;
	measureTextWidth?: TextWidthMeasurer;
	fontMetrics?: AssFontMetricsLookup;
	familyCoversCjk?: (family: string) => boolean;
}): { styles: string[]; events: string[] } {
	const style = resolveTextStyle(element);
	const styleName = `QCutText${index}`;
	const start = eventStart ?? element.startTime + element.trimStart;
	const end =
		eventEnd ?? element.startTime + element.duration - element.trimEnd;
	const centerX = canvasWidth / 2 + element.x;
	const centerY = canvasHeight / 2 + element.y;
	const baseTags = `\\org(${centerX.toFixed(2)},${centerY.toFixed(2)})\\frz${-element.rotation}\\fsp${style.letterSpacing}`;
	const { family, metrics: face } = resolveAssFace({
		element,
		fontMetrics,
		familyCoversCjk,
	});
	const styles = [styleLine({ name: styleName, element, family, face })];
	const events: string[] = [];

	if (
		style.backgroundOpacity > 0 &&
		element.backgroundColor !== "transparent"
	) {
		const left = canvasWidth / 2 + element.x - style.width / 2;
		const top = canvasHeight / 2 + element.y - style.height / 2;
		const tags = [
			"\\an7\\p1\\bord0\\shad0",
			`\\org(${centerX.toFixed(2)},${centerY.toFixed(2)})\\frz${-element.rotation}`,
			`\\1c${assOverrideColor(element.backgroundColor)}`,
			motionTags({
				element,
				x: left,
				y: top,
				targetOpacity:
					element.opacity *
					colorOpacity(element.backgroundColor, style.backgroundOpacity),
			}),
		].join("");
		events.push(
			eventLine({
				layer: 0,
				start,
				end,
				style: styleName,
				text: `{${tags}}${roundedRectangleDrawing({
					width: style.width,
					height: style.height,
					radius: style.backgroundRadius,
				})}`,
			})
		);
	}

	// Per-glyph layout for curved text, shared by the main render pass and the
	// shadow/glow passes so effects follow the curve instead of a straight line.
	const getCurvedGlyphLayout = (): Array<{
		text: string;
		x: number;
		y: number;
		anchorTags: string;
	}> => {
		const characters = getCurvedTextTransforms({
			text: element.content,
			width: Math.max(
				1,
				style.width - style.backgroundPadding * 2 - element.fontSize
			),
			curve: style.curve,
		});
		const layout: Array<{
			text: string;
			x: number;
			y: number;
			anchorTags: string;
		}> = [];
		for (const character of characters) {
			if (character.character === " ") continue;
			layout.push({
				text: character.character,
				x: canvasWidth / 2 + element.x + character.x,
				y: canvasHeight / 2 + element.y + character.y,
				anchorTags: `\\an5\\frz${-(element.rotation + character.rotation)}`,
			});
		}
		return layout;
	};

	const getEffectLayout = () =>
		style.curve !== 0
			? getCurvedGlyphLayout()
			: getStraightLineLayout({
					element,
					canvasWidth,
					canvasHeight,
					measureTextWidth,
					face,
				}).map((line) => ({
					text: line.text,
					x: line.x,
					y: line.y,
					anchorTags: `\\an${line.alignment}${baseTags}`,
				}));

	const addEffectEvent = ({
		color,
		opacity,
		blur,
		offsetX,
		offsetY,
		border,
		fallback,
	}: {
		color: string;
		opacity: number;
		blur: number;
		offsetX: number;
		offsetY: number;
		border: number;
		fallback?: string;
	}) => {
		const drawnOpacity = colorOpacity(color, opacity);
		if (drawnOpacity <= 0) return;
		const assColor = assOverrideColor(color, fallback);
		for (const entry of getEffectLayout()) {
			const tags = [
				entry.anchorTags,
				"\\bord0\\shad0",
				`\\1c${assColor}`,
				// The preview draws `blur` as a CSS text-shadow radius (σ = blur/2).
				`\\blur${assBlurForCssBlur(blur).toFixed(2)}`,
				motionTags({
					element,
					x: entry.x + offsetX,
					y: entry.y + offsetY,
					targetOpacity: element.opacity * drawnOpacity,
				}),
				border > 0
					? `\\bord${border}\\1a&HFF&\\3a&H${assAlpha(element.opacity * drawnOpacity)}&\\3c${assColor}`
					: "",
			].join("");
			events.push(
				eventLine({
					layer: 1,
					start,
					end,
					style: styleName,
					text: `{${tags}}${escapeASSText(entry.text)}`,
				})
			);
		}
	};

	addEffectEvent({
		color: style.shadowColor,
		opacity: style.shadowOpacity,
		blur: style.shadowBlur,
		offsetX: style.shadowOffsetX,
		offsetY: style.shadowOffsetY,
		border: 0,
		fallback: "#000000",
	});
	addEffectEvent({
		color: style.glowColor,
		opacity: style.glowOpacity,
		blur: style.glowBlur,
		offsetX: 0,
		offsetY: 0,
		border: Math.max(1, style.strokeWidth + 2),
	});

	const textOpacity = element.opacity * colorOpacity(element.color, 1);
	const outlineOpacity =
		element.opacity * colorOpacity(style.strokeColor, style.strokeOpacity);
	if (style.curve !== 0) {
		for (const glyph of getCurvedGlyphLayout()) {
			const tags = [
				glyph.anchorTags,
				motionTags({
					element,
					x: glyph.x,
					y: glyph.y,
					targetOpacity: textOpacity,
					outlineOpacity,
				}),
			].join("");
			events.push(
				eventLine({
					layer: 2,
					start,
					end,
					style: styleName,
					text: `{${tags}}${escapeASSText(glyph.text)}`,
				})
			);
		}
	} else {
		for (const line of getStraightLineLayout({
			element,
			canvasWidth,
			canvasHeight,
			measureTextWidth,
			face,
		})) {
			const tags = `\\an${line.alignment}${baseTags}${motionTags({
				element,
				x: line.x,
				y: line.y,
				targetOpacity: textOpacity,
				outlineOpacity,
			})}`;
			events.push(
				eventLine({
					layer: 2,
					start,
					end,
					style: styleName,
					text: `{${tags}}${escapeASSText(line.text)}`,
				})
			);
		}
	}

	return { styles, events };
}

export function buildTextASSOverlay({
	tracks,
	allTracks = tracks,
	canvasWidth,
	canvasHeight,
	fps = 30,
	measureTextWidth,
	fontMetrics,
	familyCoversCjk,
}: {
	tracks: TimelineTrack[];
	allTracks?: TimelineTrack[];
	canvasWidth: number;
	canvasHeight: number;
	fps?: number;
	measureTextWidth?: TextWidthMeasurer;
	/**
	 * What libass will do with each face, from `loadAssFontMetrics`. Without
	 * it the ASS Fontsize stays nominal, which libass renders 10–15 % small in
	 * fonts such as Arial and Helvetica.
	 */
	fontMetrics?: AssFontMetricsLookup;
	/** Whether an installed family carries CJK glyphs, read from the font. */
	familyCoversCjk?: (family: string) => boolean;
}): TextASSExport {
	const styles: string[] = [];
	const events: string[] = [];
	const renderedElementIds = new Set<string>();
	let index = 0;

	for (const track of tracks) {
		for (const element of track.elements) {
			if (
				element.type !== "text" ||
				element.hidden ||
				!element.content.trim()
			) {
				continue;
			}

			const hasKeyframes =
				Boolean(element.trackingTargetId) ||
				Object.values(element.keyframes ?? {}).some(
					(keyframes) => (keyframes?.length ?? 0) > 0
				);
			if (hasKeyframes) {
				const visibleStart = element.startTime + element.trimStart;
				const visibleEnd =
					element.startTime + element.duration - element.trimEnd;
				const firstFrame = Math.floor(visibleStart * fps);
				const lastFrame = Math.ceil(visibleEnd * fps);
				for (let frame = firstFrame; frame < lastFrame; frame++) {
					const frameStart = Math.max(visibleStart, frame / fps);
					const frameEnd = Math.min(visibleEnd, (frame + 1) / fps);
					if (frameEnd <= frameStart) continue;
					const resolved = resolveAnimatedTextElement({
						element,
						tracks: allTracks,
						currentTime: frameStart,
						fps,
					});
					const animation = getTextAnimationState(element, frameStart);
					const sampled: TextElement = {
						...resolved,
						x: resolved.x + animation.offsetX,
						y: resolved.y + animation.offsetY,
						opacity: resolved.opacity * animation.opacity,
						animationType: "none",
					};
					const result = buildElementEvents({
						element: sampled,
						index: index++,
						canvasWidth,
						canvasHeight,
						eventStart: frameStart,
						eventEnd: frameEnd,
						measureTextWidth,
						fontMetrics,
						familyCoversCjk,
					});
					styles.push(...result.styles);
					events.push(...result.events);
				}
			} else {
				const result = buildElementEvents({
					element: resolveAnimatedTextElement({
						element,
						tracks: allTracks,
						currentTime: element.startTime,
						fps,
					}),
					index: index++,
					canvasWidth,
					canvasHeight,
					measureTextWidth,
					fontMetrics,
					familyCoversCjk,
				});
				styles.push(...result.styles);
				events.push(...result.events);
			}
			renderedElementIds.add(element.id);
		}
	}

	if (events.length === 0) return { content: "", renderedElementIds };
	const content = [
		"[Script Info]",
		"ScriptType: v4.00+",
		`PlayResX: ${canvasWidth}`,
		`PlayResY: ${canvasHeight}`,
		"ScaledBorderAndShadow: yes",
		"WrapStyle: 0",
		"",
		"[V4+ Styles]",
		"Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
		...styles.map((style) => `Style: ${style}`),
		"",
		"[Events]",
		"Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
		...events,
	].join("\n");
	return { content, renderedElementIds };
}
