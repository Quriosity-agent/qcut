/**
 * Subtitle style utilities — re-exports shared logic from @qcut/editor-core,
 * plus browser-specific `subtitleStyleToCSS`.
 */

import type { SubtitleStyle } from "@/types/timeline";

// Re-export shared utilities from editor-core
export {
	DEFAULT_SUBTITLE_STYLE,
	resolveSubtitleStyle,
	resolveSecondaryLineStyle,
	captionFontWeight,
	cssFontWeight,
	resolveCaptionShadows,
	hexToRgba,
	rgbToASSColor,
	assColorToRgb,
	alignToASSAlignment,
	assAlignmentToAlign,
	assAlignmentToTextAlign,
	CAPTION_ANIMATION_TYPES,
	resolveCaptionAnimation,
	resolveCaptionFades,
	getCaptionAnimationState,
} from "@qcut/editor-core";

import {
	captionFontWeight,
	cssFontWeight,
	hexToRgba,
	resolveCaptionShadows,
} from "@qcut/editor-core";

/**
 * A caption's soft shadows as CSS `text-shadow` (N25), or undefined when it
 * keeps the single shadow; "none" for an empty list.
 */
export function captionShadowsToCSS({
	style,
	canvasScale = 1,
}: {
	style: SubtitleStyle;
	canvasScale?: number;
}): string | undefined {
	const shadows = resolveCaptionShadows(style);
	if (!shadows) return undefined;
	if (shadows.length === 0) return "none";
	return shadows
		.map(
			(shadow) =>
				`${shadow.x * canvasScale}px ${shadow.y * canvasScale}px ${shadow.blur * canvasScale}px ${hexToRgba(shadow.color, shadow.opacity)}`
		)
		.join(", ");
}

/** Convert SubtitleStyle to CSS properties for DOM-based rendering */
export function subtitleStyleToCSS({
	style,
	canvasScale = 1,
}: {
	style: SubtitleStyle;
	canvasScale?: number;
}): React.CSSProperties {
	const fontWeight = cssFontWeight(captionFontWeight(style));
	const fontStyle = style.italic ? "italic" : "normal";
	const textDecoration = style.underline ? "underline" : "none";

	const alignMap: Record<SubtitleStyle["position"]["align"], string> = {
		top: "flex-start",
		center: "center",
		bottom: "flex-end",
	};

	return {
		fontFamily: `${style.fontFamily}, sans-serif`,
		fontSize: `${style.fontSize * canvasScale}px`,
		letterSpacing: `${style.letterSpacing * canvasScale}px`,
		color: style.fontColor,
		opacity: style.fontOpacity,
		fontWeight,
		fontStyle,
		textDecoration,
		// Soft shadows are painted on an underlay under every line instead
		// (captions-display.tsx), as the exports draw them.
		textShadow: resolveCaptionShadows(style)
			? "none"
			: `${style.shadowOffset.x * canvasScale}px ${style.shadowOffset.y * canvasScale}px ${2 * canvasScale}px ${style.shadowColor}`,
		// Outline behind the glyph (double width, painted first), as exported.
		WebkitTextStroke:
			style.outlineWidth > 0
				? `${style.outlineWidth * 2 * canvasScale}px ${style.outlineColor}`
				: undefined,
		paintOrder: style.outlineWidth > 0 ? "stroke fill" : undefined,
		backgroundColor:
			style.bgOpacity > 0
				? hexToRgba(style.backgroundColor, style.bgOpacity)
				: "transparent",
		lineHeight: `${style.lineSpacing}`,
		textAlign: style.textAlign,
		padding: `${8 * canvasScale}px ${16 * canvasScale}px`,
		borderRadius: `${4 * canvasScale}px`,
		maxWidth: "80%",
		alignSelf: alignMap[style.position.align],
	};
}
