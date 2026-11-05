import type { CaptionElement, SubtitleStyle } from "../types/timeline.js";
import { captionFontWeight } from "./subtitle-style.js";
import {
	captionContentMaxWidth,
	type CaptionTextMeasurer,
} from "./caption-layout.js";
import { escapeCaptionAssText } from "./caption-ass-layout.js";

type CaptionWords = NonNullable<CaptionElement["words"]>;

export function captionKaraokeLines({
	clip,
	style,
	width,
	measureText,
}: {
	clip: CaptionElement;
	style: SubtitleStyle;
	width: number;
	measureText?: CaptionTextMeasurer;
}): CaptionWords[] | undefined {
	if ((style.karaokeMode ?? "none") === "none") return;
	const words = (clip.words ?? [])
		.filter((word) => word.type === "word")
		.sort((left, right) => left.start - right.start);
	if (words.length === 0) return;
	if (!measureText) return [words];
	const maxWidth = captionContentMaxWidth({ width });
	const lines: CaptionWords[] = [];
	let line: CaptionWords = [];
	for (const word of words) {
		const candidate = [...line, word];
		const measured = measureText({
			text: candidate.map((item) => item.text.trim()).join(" "),
			fontFamily: style.fontFamily,
			fontSize: style.fontSize,
			fontWeight: captionFontWeight(style),
			italic: Boolean(style.italic),
			letterSpacing: style.letterSpacing,
		});
		if (line.length > 0 && measured > maxWidth) {
			lines.push(line);
			line = [word];
			continue;
		}
		line = candidate;
	}
	lines.push(line);
	return lines;
}

export function captionKaraokeText({
	lines,
	clipEnd,
	mode,
	lineBreak,
}: {
	lines: CaptionWords[];
	clipEnd: number;
	mode: SubtitleStyle["karaokeMode"];
	lineBreak: string;
}): string {
	const words = lines.flat();
	const renderedLines: string[] = [];
	let wordIndex = 0;
	for (const line of lines) {
		const renderedWords: string[] = [];
		for (const word of line) {
			const nextStart = words[++wordIndex]?.start ?? clipEnd;
			const end = Math.max(word.end, nextStart);
			const durationCs = Math.max(1, Math.round((end - word.start) * 100));
			const tag = mode === "karaoke" ? "kf" : "k";
			renderedWords.push(
				`{\\${tag}${durationCs}}${escapeCaptionAssText({ text: word.text.trim() })}`
			);
		}
		renderedLines.push(renderedWords.join(" "));
	}
	return renderedLines.join(lineBreak);
}
