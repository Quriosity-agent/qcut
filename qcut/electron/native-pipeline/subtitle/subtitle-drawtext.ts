import { existsSync } from "node:fs";
import type { CaptionElement, SubtitleStyle } from "./subtitle-types.js";
import {
	cssColorAlpha,
	parseCssColor,
} from "../../claude/handlers/claude-export-handler/css-color.js";

function drawtextColor({
	color,
	opacity = 1,
	fallback = "#ffffff",
}: {
	color: string;
	opacity?: number;
	fallback?: string;
}): string {
	const parsed = parseCssColor(color) ?? { hex: fallback };
	return `0x${parsed.hex.slice(1)}@${cssColorAlpha(parsed, opacity)}`;
}

function hasCJK({ text }: { text: string }): boolean {
	return /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/.test(text);
}

/** macOS CJK font paths in preference order. */
const CJK_FONT_CANDIDATES = [
	"/System/Library/Fonts/STHeiti Medium.ttc",
	"/System/Library/Fonts/Hiragino Sans GB.ttc",
	"/System/Library/Fonts/STHeiti Light.ttc",
	"/System/Library/Fonts/Supplemental/Songti.ttc",
];

function resolveFontfile({
	fontFamily,
	text,
}: {
	fontFamily: string;
	text: string;
}): string {
	// CJK text needs an explicit fontfile — drawtext can't find CJK fonts by name
	if (hasCJK({ text }) && process.platform === "darwin") {
		for (const candidate of CJK_FONT_CANDIDATES) {
			if (existsSync(candidate)) {
				const escaped = candidate.replace(/:/g, "\\:");
				return `fontfile='${escaped}'`;
			}
		}
	}
	return `font=${fontFamily}`;
}

export function buildDrawtextFilters({
	clips,
	style,
}: {
	clips: CaptionElement[];
	style: SubtitleStyle;
}): string {
	const filters: string[] = [];

	for (const clip of clips) {
		const escapedText = clip.text
			.trim()
			.replace(/\\/g, "\\\\")
			.replace(/:/g, "\\:")
			.replace(/\[/g, "\\[")
			.replace(/\]/g, "\\]")
			.replace(/,/g, "\\,")
			.replace(/;/g, "\\;")
			.replace(/'/g, "\\'")
			.replace(/%/g, "\\%")
			.replace(/\n/g, "\\n")
			.replace(/\r/g, "")
			.replace(/=/g, "\\=");

		const startTime = clip.startTime;
		const endTime = clip.startTime + clip.duration;

		const fontColor = drawtextColor({
			color: style.fontColor,
			opacity: style.fontOpacity,
		});

		const xExpr = "(w-text_w)/2";
		let yExpr: string;
		switch (style.position.align) {
			case "top":
				yExpr = `${style.fontSize}`;
				break;
			case "center":
				yExpr = "(h-text_h)/2";
				break;
			default:
				yExpr = `h-text_h-${style.fontSize}`;
				break;
		}

		const fontfileParam = resolveFontfile({
			fontFamily: style.fontFamily,
			text: clip.text,
		});

		const params: string[] = [
			`text='${escapedText}'`,
			`fontsize=${style.fontSize}`,
			`fontcolor=${fontColor}`,
			fontfileParam,
			`x=${xExpr}`,
			`y=${yExpr}`,
		];

		if (style.outlineWidth > 0) {
			params.push(
				`borderw=${style.outlineWidth}`,
				`bordercolor=${drawtextColor({ color: style.outlineColor })}`
			);
		}

		if (style.shadowOffset.x !== 0 || style.shadowOffset.y !== 0) {
			params.push(
				`shadowx=${style.shadowOffset.x}`,
				`shadowy=${style.shadowOffset.y}`,
				`shadowcolor=${drawtextColor({ color: style.shadowColor, fallback: "#000000" })}`
			);
		}

		if (style.bgOpacity > 0) {
			params.push(
				"box=1",
				`boxcolor=${drawtextColor({ color: style.backgroundColor, opacity: style.bgOpacity })}`,
				"boxborderw=8"
			);
		}

		params.push(`enable='between(t\\,${startTime}\\,${endTime})'`);

		filters.push(`drawtext=${params.join(":")}`);
	}

	return filters.join(",");
}
