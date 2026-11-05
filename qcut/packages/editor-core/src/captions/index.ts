/**
 * Captions module — shared subtitle utilities for CLI and renderer.
 * @module @qcut/editor-core/captions
 */

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
} from "./subtitle-style.js";

export {
	CAPTION_ANIMATION_TYPES,
	resolveCaptionAnimation,
	resolveCaptionFades,
	captionAssFade,
	getCaptionAnimationState,
	type CaptionAnimationState,
} from "./caption-animation.js";

export {
	assBlurForCssBlur,
	generateASS,
	secondsToASSTime,
	type ASSGeneratorOptions,
	type AssFaceMetrics,
	type AssFontMetricsLookup,
} from "./ass-generator.js";

export {
	CAPTION_BOX,
	captionBackgroundBox,
	captionContentMaxWidth,
	wrapCaptionLines,
	type CaptionMeasureRequest,
	type CaptionTextMeasurer,
} from "./caption-layout.js";

export { prepareCaptionLayout } from "./caption-ass-layout.js";

export {
	CSS_NAMED_COLORS,
	cssColorAlpha,
	parseCssColor,
	type ParsedCssColor,
} from "./css-color.js";

export {
	CJK_CAPABLE_FONT_FAMILIES,
	containsCjkText,
	isCjkCapableFamily,
	resolveAssCjkFamily,
} from "./ass-cjk-font.js";

export {
	parseASS,
	assTimeToSeconds,
	assStyleToSubtitleStyle,
	type ASSStyle,
	type ASSEvent,
	type ASSDocument,
} from "./ass-parser.js";
