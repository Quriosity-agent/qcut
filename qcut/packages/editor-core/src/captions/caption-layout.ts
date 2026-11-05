/** CSS caption geometry; mirrored in Electron, whose build cannot import this package. */
export const CAPTION_BOX = {
	edge: 20,
	paddingX: 16,
	paddingY: 8,
	radius: 4,
} as const;

export interface CaptionMeasureRequest {
	text: string;
	fontFamily: string;
	fontSize: number;
	fontWeight: number;
	italic: boolean;
	letterSpacing: number;
}
export type CaptionTextMeasurer = (request: CaptionMeasureRequest) => number;

export function captionContentMaxWidth({ width }: { width: number }): number {
	return Math.max(
		1,
		(width - 2 * CAPTION_BOX.edge) * 0.8 - 2 * CAPTION_BOX.paddingX
	);
}

export function captionBackgroundBox({
	lineWidths,
	lineHeights,
	width,
	height,
	align,
	textAlign,
	stackOffset = 0,
}: {
	lineWidths: number[];
	lineHeights: number[];
	width: number;
	height: number;
	align: "top" | "center" | "bottom";
	textAlign: "left" | "center" | "right";
	stackOffset?: number;
}): { x: number; y: number; width: number; height: number; radius: number } {
	const boxWidth = Math.max(0, ...lineWidths) + 2 * CAPTION_BOX.paddingX;
	const boxHeight =
		lineHeights.reduce((sum, value) => sum + value, 0) +
		2 * CAPTION_BOX.paddingY;
	return {
		x:
			textAlign === "left"
				? CAPTION_BOX.edge
				: textAlign === "right"
					? width - CAPTION_BOX.edge - boxWidth
					: (width - boxWidth) / 2,
		y:
			align === "top"
				? CAPTION_BOX.edge + stackOffset
				: align === "bottom"
					? height - CAPTION_BOX.edge - stackOffset - boxHeight
					: (height - boxHeight) / 2,
		width: boxWidth,
		height: boxHeight,
		radius: CAPTION_BOX.radius,
	};
}

/** Explicit lines stay intact; oversized words and CJK wrap at grapheme boundaries. */
export function wrapCaptionLines({
	request,
	maxWidth,
	measureText,
}: {
	request: CaptionMeasureRequest;
	maxWidth: number;
	measureText: CaptionTextMeasurer;
}): string[] {
	const measure = (text: string) => measureText({ ...request, text });
	const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
	const lines: string[] = [];
	for (const paragraph of request.text.trim().replace(/\r/g, "").split("\n")) {
		let line = "";
		for (const token of paragraph.match(/\S+\s*|\s+/g) ?? [paragraph]) {
			const candidate = line + token;
			if (measure(candidate.trimEnd()) <= maxWidth) {
				line = candidate;
				continue;
			}
			if (line) lines.push(line.trimEnd());
			line = "";
			if (measure(token.trimEnd()) <= maxWidth) {
				line = token.trimStart();
				continue;
			}
			for (const { segment } of graphemes.segment(token.trim())) {
				if (line && measure(line + segment) > maxWidth) {
					lines.push(line);
					line = "";
				}
				line += segment;
			}
		}
		lines.push(line.trimEnd());
	}
	return lines;
}

export function captionRoundedBoxDrawing({
	width,
	height,
	radius,
}: {
	width: number;
	height: number;
	radius: number;
}): string {
	const r = Math.max(0, Math.min(radius, width / 2, height / 2));
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
