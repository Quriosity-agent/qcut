import {
	CAPTION_BOX,
	captionContentMaxWidth,
	captionFontWeight,
	wrapCaptionLines,
	type CaptionMeasureRequest,
	type CaptionTextMeasurer,
} from "@qcut/editor-core";
import type { CaptionElement, SubtitleStyle } from "@/types/timeline";
import type { WordItem } from "@/types/word-timeline";
import { captionBlockHeight } from "./caption-stacking";
import { resolveSubtitleStyle } from "./subtitle-style";

export const CAPTION_PREVIEW_WORD_GAP = 4;

export function selectPreviewCaptionWords<
	Word extends Pick<WordItem, "type" | "start" | "end">,
>({
	words,
	startTime,
	endTime,
	mode,
}: {
	words?: readonly Word[];
	startTime: number;
	endTime: number;
	mode: SubtitleStyle["karaokeMode"];
}): Word[] {
	if (!mode || mode === "none" || !words) return [];
	return words.filter(
		(word) =>
			word.type === "word" &&
			word.start >= startTime - 0.05 &&
			word.end <= endTime + 0.05
	);
}

export function measurePreviewCaptionBlockHeight({
	element,
	width,
	measureText,
}: {
	element: CaptionElement;
	width: number;
	measureText?: CaptionTextMeasurer;
}): number {
	const style = resolveSubtitleStyle(element.style);
	const words = selectPreviewCaptionWords({
		words: element.words,
		startTime: element.startTime,
		endTime: element.startTime + element.duration,
		mode: style.karaokeMode,
	});
	if (!measureText || words.length === 0) {
		return captionBlockHeight({ element, width, measureText });
	}
	const maxWidth = captionContentMaxWidth({ width });
	const lineHeight = style.fontSize * style.lineSpacing;
	const request: Omit<CaptionMeasureRequest, "text"> = {
		fontFamily: style.fontFamily,
		fontSize: style.fontSize,
		fontWeight: captionFontWeight(style),
		italic: Boolean(style.italic),
		letterSpacing: style.letterSpacing,
	};
	const wordBoxes = words.map((word) => {
		const text = word.text.trim().replace(/\s+/g, " ");
		const wordWidth = measureText({ ...request, text });
		if (wordWidth <= maxWidth) return { width: wordWidth, height: lineHeight };
		// Flex spans can wrap CJK or phrases, but an unbroken Latin token overflows.
		const unbreakable =
			text.match(
				/[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}-]+-?/gu
			) ?? [];
		const minimumWidth = Math.max(
			maxWidth,
			...unbreakable.map((token) => measureText({ ...request, text: token }))
		);
		const lines = wrapCaptionLines({
			request: { ...request, text },
			maxWidth: minimumWidth,
			measureText,
		});
		return { width: wordWidth, height: lines.length * lineHeight };
	});
	if (style.karaokeMode === "word-by-word") {
		return (
			Math.max(...wordBoxes.map((box) => box.height)) + 2 * CAPTION_BOX.paddingY
		);
	}
	let totalHeight = 0;
	let rowHeight = 0;
	let lineWidth = 0;
	let wordsInLine = 0;
	for (const box of wordBoxes) {
		const candidate =
			lineWidth + (wordsInLine > 0 ? CAPTION_PREVIEW_WORD_GAP : 0) + box.width;
		if (wordsInLine > 0 && candidate > maxWidth) {
			totalHeight += rowHeight + CAPTION_PREVIEW_WORD_GAP;
			rowHeight = box.height;
			lineWidth = box.width;
			wordsInLine = 1;
			continue;
		}
		rowHeight = Math.max(rowHeight, box.height);
		lineWidth = candidate;
		wordsInLine += 1;
	}
	// Typewriter reserves its final layout instead of moving neighbours per word.
	return totalHeight + rowHeight + 2 * CAPTION_BOX.paddingY;
}
