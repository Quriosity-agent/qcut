/**
 * The ASS text of a caption, laid out as the preview's box lays out its
 * lines. CSS gives every line a box of its font size × the line spacing and
 * centres the glyphs in it; libass stacks lines exactly as tall as their ASS
 * font size (the export sets that from the font's Windows height, measured:
 * 52 px apart at size 52 for Arial, Songti SC and Hiragino alike) with no
 * leading. A spacer line (a hard space at the height of the missing gap)
 * between two lines makes up the difference, so every line sits where the
 * preview and the canvas export draw it. A bilingual caption's second-
 * language lines follow in their own font, switched with inline tags.
 *
 * @module electron/claude/handlers/claude-export-handler/caption-ass-lines
 */

import { assFontMetrics } from "./ass-font-metrics.js";
import type { TextOverlay } from "./types.js";

/** Text as ASS draws it literally; line breaks become `\N`. */
export function escapeAssText(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/{/g, "\\{")
		.replace(/}/g, "\\}")
		.replace(/\r?\n/g, "\\N");
}

/** A run of a caption's lines in one font. */
export interface AssCaptionRun {
	/** The run's lines, already ASS-escaped. */
	lines: string[];
	/** Font size in canvas pixels (the em the preview shows). */
	fontSize: number;
	/** The ASS font size that draws `fontSize`; libass's line is this tall. */
	assFontSize: number;
	/** Tags that switch to the run's font; "" for the event's own style. */
	fontTags: string;
}

/** How far a line's glyphs sit inside its CSS line box, top and bottom. */
export function captionHalfLeading({
	run,
	lineSpacing,
}: {
	run: AssCaptionRun;
	lineSpacing: number;
}): number {
	return (run.fontSize * lineSpacing - run.assFontSize) / 2;
}

/** Below half a pixel a spacer line is not worth an extra line. */
const MIN_SPACER = 0.5;

/**
 * The runs' lines joined with `\N`, a spacer line wherever the CSS gap is
 * larger than libass's (it cannot narrow one, so a line spacing below the
 * font's own keeps libass's), and each run's font switched in where it
 * starts. One caption with one font and no line break is its text as is.
 */
export function assCaptionText({
	runs,
	lineSpacing,
}: {
	runs: AssCaptionRun[];
	lineSpacing: number;
}): string {
	const parts: string[] = [];
	let previous: AssCaptionRun | undefined;
	for (const run of runs) {
		for (const line of run.lines) {
			if (previous) {
				parts.push("\\N");
				const gap =
					captionHalfLeading({ run: previous, lineSpacing }) +
					captionHalfLeading({ run, lineSpacing });
				const spacer = gap >= MIN_SPACER;
				if (spacer) parts.push(`{\\fs${gap.toFixed(2)}}\\h\\N`);
				// After a spacer the size is the spacer's; a new run also
				// changes the font.
				if (spacer || run !== previous) {
					parts.push(`{${run.fontTags}\\fs${run.assFontSize.toFixed(2)}}`);
				}
			}
			parts.push(line);
			previous = run;
		}
	}
	return parts.join("");
}

/** A `#rrggbb` colour as an inline ASS colour tag value (`&HBBGGRR&`). */
export function assInlineColor(hex: string): string {
	const rgb = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "ffffff";
	return `&H${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}&`.toUpperCase();
}

/** A font name inside an override block, where `{`, `}` and `\` would end it. */
function overrideFontName(family: string): string {
	return family.replace(/[{}\\]/g, "");
}

/**
 * A caption event's text: the caption's lines, then a bilingual caption's
 * second-language lines in their font. A last line in that other font also
 * comes back with its half-leading, which pins a bottom-aligned caption.
 */
export function captionEventText({
	overlay,
	fontSize,
	fontFamilyFor,
}: {
	overlay: TextOverlay;
	/** The event style's ASS font size. */
	fontSize: number;
	/** The family libass draws an overlay's text in (CJK substitution). */
	fontFamilyFor: (overlay: TextOverlay) => string;
}): { text: string; lastLineLeading?: number } {
	const lines = (text: string) =>
		text.split(/\r?\n/).map((line) => escapeAssText(line));
	const runs: AssCaptionRun[] = [
		{
			lines: lines(overlay.content),
			fontSize: overlay.fontSize,
			assFontSize: fontSize,
			fontTags: "",
		},
	];
	const secondary = overlay.secondary;
	if (!secondary) {
		return { text: assCaptionText({ runs, lineSpacing: overlay.lineHeight }) };
	}
	const family = fontFamilyFor({
		...overlay,
		fontFamily: secondary.fontFamily,
		content: secondary.content,
	});
	const bold = secondary.fontWeight === "bold";
	const italic = secondary.fontStyle === "italic";
	const metrics = assFontMetrics({ family, bold, italic });
	const secondaryRun: AssCaptionRun = {
		lines: lines(secondary.content),
		fontSize: secondary.fontSize,
		assFontSize: secondary.fontSize * metrics.sizeFactor,
		fontTags: `\\fn${overrideFontName(family)}\\b${bold ? 1 : 0}\\i${italic ? 1 : 0}\\c${assInlineColor(secondary.color)}`,
	};
	runs.push(secondaryRun);
	return {
		text: assCaptionText({ runs, lineSpacing: overlay.lineHeight }),
		lastLineLeading: captionHalfLeading({
			run: secondaryRun,
			lineSpacing: overlay.lineHeight,
		}),
	};
}
