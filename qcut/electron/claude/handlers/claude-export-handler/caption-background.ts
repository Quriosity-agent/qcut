import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { assFontFilesForFamilies } from "./ass-font-metrics.js";
import { overlayWeight } from "./caption-ass-style.js";
import {
	captionBackgroundBox,
	captionContentMaxWidth,
	wrapCaptionLines,
	type CaptionMeasureRequest,
	type CaptionTextMeasurer,
} from "./caption-layout.js";
import type { TextOverlay } from "./types.js";

const registeredFontFiles = new Set<string>();

export function createNativeCaptionMeasurer(): CaptionTextMeasurer {
	const context = createCanvas(1, 1).getContext("2d");
	const families = new Set<string>();
	return (request) => {
		if (!families.has(request.fontFamily)) {
			for (const file of assFontFilesForFamilies({
				families: [request.fontFamily],
			})) {
				if (registeredFontFiles.has(file)) continue;
				GlobalFonts.registerFromPath(file);
				registeredFontFiles.add(file);
			}
			families.add(request.fontFamily);
		}
		const family = request.fontFamily.replaceAll('"', "");
		context.font = `${request.italic ? "italic" : "normal"} ${request.fontWeight} ${request.fontSize}px "${family}"`;
		context.letterSpacing = `${request.letterSpacing}px`;
		return context.measureText(request.text).width;
	};
}

export function prepareCaptionBackground({
	overlay,
	width,
	height,
	stackOffset,
	fontFamilyFor,
	measureText,
}: {
	overlay: TextOverlay;
	width: number;
	height: number;
	stackOffset: number;
	fontFamilyFor: (overlay: TextOverlay) => string;
	measureText: CaptionTextMeasurer;
}): { overlay: TextOverlay; box: ReturnType<typeof captionBackgroundBox> } {
	const primary: CaptionMeasureRequest = {
		text: overlay.content,
		fontFamily: fontFamilyFor(overlay),
		fontSize: overlay.fontSize,
		fontWeight: overlayWeight(overlay),
		italic: overlay.fontStyle === "italic",
		letterSpacing: overlay.letterSpacing,
	};
	const maxWidth = captionContentMaxWidth({ width });
	const primaryLines = wrapCaptionLines({
		request: primary,
		maxWidth,
		measureText,
	});
	const rows = primaryLines.map((text) => ({ ...primary, text }));
	const prepared = { ...overlay, content: primaryLines.join("\n") };
	if (overlay.secondary) {
		const secondary = overlay.secondary;
		const request: CaptionMeasureRequest = {
			text: secondary.content,
			fontFamily: fontFamilyFor({ ...overlay, ...secondary }),
			fontSize: secondary.fontSize,
			fontWeight: overlayWeight(secondary),
			italic: secondary.fontStyle === "italic",
			letterSpacing: secondary.letterSpacing,
		};
		const lines = wrapCaptionLines({ request, maxWidth, measureText });
		rows.push(...lines.map((text) => ({ ...request, text })));
		prepared.secondary = { ...secondary, content: lines.join("\n") };
	}
	return {
		overlay: prepared,
		box: captionBackgroundBox({
			lineWidths: rows.map(measureText),
			lineHeights: rows.map((row) => row.fontSize * overlay.lineHeight),
			width,
			height,
			align: overlay.verticalAlign,
			textAlign: overlay.textAlign,
			stackOffset,
		}),
	};
}
