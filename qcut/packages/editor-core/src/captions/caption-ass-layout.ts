import type { CaptionElement, SubtitleStyle } from "../types/timeline.js";
import {
	captionFontWeight,
	resolveSecondaryLineStyle,
} from "./subtitle-style.js";
import {
	captionBackgroundBox,
	captionContentMaxWidth,
	wrapCaptionLines,
	type CaptionMeasureRequest,
	type CaptionTextMeasurer,
} from "./caption-layout.js";

export function prepareCaptionLayout({
	clip,
	style,
	resolution,
	stackOffset,
	measureText,
	primaryLines: suppliedPrimaryLines,
}: {
	clip: CaptionElement;
	style: SubtitleStyle;
	resolution: { width: number; height: number };
	stackOffset: number;
	measureText: CaptionTextMeasurer;
	primaryLines?: string[];
}): { clip: CaptionElement; box: ReturnType<typeof captionBackgroundBox> } {
	const primary: CaptionMeasureRequest = {
		text: clip.text,
		fontFamily: style.fontFamily,
		fontSize: style.fontSize,
		fontWeight: captionFontWeight(style),
		italic: Boolean(style.italic),
		letterSpacing: style.letterSpacing,
	};
	const maxWidth = captionContentMaxWidth({ width: resolution.width });
	const primaryLines =
		suppliedPrimaryLines ??
		wrapCaptionLines({ request: primary, maxWidth, measureText });
	const rows = primaryLines.map((text) => ({ ...primary, text }));
	const prepared = { ...clip, text: primaryLines.join("\n") };
	if (clip.secondaryText?.trim()) {
		const secondary = resolveSecondaryLineStyle(style);
		const request: CaptionMeasureRequest = {
			...secondary,
			italic: Boolean(secondary.italic),
			text: clip.secondaryText,
		};
		const lines = wrapCaptionLines({ request, maxWidth, measureText });
		rows.push(...lines.map((text) => ({ ...request, text })));
		prepared.secondaryText = lines.join("\n");
	}
	return {
		clip: prepared,
		box: captionBackgroundBox({
			lineWidths: rows.map(measureText),
			lineHeights: rows.map((row) => row.fontSize * style.lineSpacing),
			...resolution,
			align: style.position.align,
			textAlign: style.textAlign,
			stackOffset,
		}),
	};
}

export function escapeCaptionAssText({ text }: { text: string }): string {
	return text.replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}");
}

/** libass has no CSS leading, so a hard-space line supplies the gap. */
export function captionAssLineBreak({
	previousSize,
	previousAssSize,
	fontSize,
	assSize,
	lineSpacing,
	fontTags = "",
}: {
	previousSize: number;
	previousAssSize: number;
	fontSize: number;
	assSize: number;
	lineSpacing: number;
	fontTags?: string;
}): string {
	const gap =
		((previousSize + fontSize) * lineSpacing - previousAssSize - assSize) / 2;
	const spacer = gap >= 0.5 ? `{\\fs${gap.toFixed(2)}}\\h\\N` : "";
	return `\\N${spacer}{${fontTags}\\fs${assSize.toFixed(2)}}`;
}
