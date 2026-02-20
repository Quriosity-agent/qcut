/**
 * Text Overlay Filter Building
 *
 * Builds FFmpeg drawtext filter chains for text overlays.
 * Extracted from export-engine-cli.ts lines 265-482.
 */

import type {
	MarkdownElement,
	TextElement,
	TimelineTrack,
} from "@/types/timeline";
import type { Platform } from "../types";
import {
	escapeTextForFFmpeg,
	escapePathForFFmpeg,
	colorToFFmpeg,
} from "./text-escape";
import { resolveFontPath } from "./font-resolver";
import { stripMarkdownSyntax } from "@/lib/markdown";

/**
 * Convert a TextElement to FFmpeg drawtext filter string.
 * Includes positioning, styling, timing, and optional effects.
 *
 * @param element - Text element from timeline
 * @param platform - Platform for font resolution (optional, uses Electron API if not provided)
 * @returns FFmpeg drawtext filter string, or empty string if element is invalid
 */
export function convertTextElementToDrawtext(
	element: TextElement,
	platform?: Platform
): string {
	// Skip empty or hidden elements
	if (!element.content?.trim() || element.hidden) {
		return "";
	}

	const escapedText = escapeTextForFFmpeg(element.content);
	const fontConfig = resolveFontPath(
		element.fontFamily || "Arial",
		element.fontWeight,
		element.fontStyle,
		platform
	);
	const fontColor = colorToFFmpeg(element.color || "#ffffff");

	// Calculate timing (accounting for trim)
	const trimStart = element.trimStart ?? 0;
	const trimEnd = element.trimEnd ?? 0;
	const duration = element.duration ?? 0;
	const startTime = element.startTime + trimStart;
	const endTime = element.startTime + duration - trimEnd;

	// Build base filter parameters
	const filterParams: string[] = [
		`text='${escapedText}'`,
		`fontsize=${element.fontSize || 24}`,
		`fontcolor=${fontColor}`,
	];

	// Add font parameter (platform-specific)
	if (fontConfig.useFontconfig) {
		filterParams.push(`font='${fontConfig.fontName}'`);
	} else {
		filterParams.push(`fontfile=${escapePathForFFmpeg(fontConfig.fontPath)}`);
	}

	// Position calculation: element x/y are relative to canvas center
	const formatOffset = (value: number): string => {
		if (value === 0) return "";
		return value > 0 ? `+${value}` : `${value}`;
	};

	const xOffset = Math.round(element.x ?? 0);
	const yOffset = Math.round(element.y ?? 0);
	const anchorXExpr = `w/2${formatOffset(xOffset)}`;
	const yExpr = `(h-text_h)/2${formatOffset(yOffset)}`;

	// Apply text alignment
	let xExpr = `${anchorXExpr}-(text_w/2)`; // Default: center
	if (element.textAlign === "left") {
		xExpr = `${anchorXExpr}`;
	} else if (element.textAlign === "right") {
		xExpr = `${anchorXExpr}-text_w`;
	}

	filterParams.push(`x=${xExpr}`, `y=${yExpr}`);

	// Add border for readability
	filterParams.push("borderw=2", "bordercolor=black");

	// Handle opacity (FFmpeg alpha accepts 0.0-1.0 directly)
	if (element.opacity !== undefined && element.opacity < 1) {
		filterParams.push(`alpha=${element.opacity}`);
	}

	// Handle rotation
	if (element.rotation && element.rotation !== 0) {
		const radians = (element.rotation * Math.PI) / 180;
		filterParams.push(`angle=${radians}`);
	}

	// Handle background color
	if (element.backgroundColor && element.backgroundColor !== "transparent") {
		const bgColor = colorToFFmpeg(element.backgroundColor);
		filterParams.push("box=1", `boxcolor=${bgColor}@0.5`, "boxborderw=5");
	}

	// Add timing constraint
	filterParams.push(`enable='between(t,${startTime},${endTime})'`);

	return `drawtext=${filterParams.join(":")}`;
}

export function convertMarkdownElementToDrawtext(
	element: MarkdownElement,
	platform?: Platform
): string {
	const plainText = stripMarkdownSyntax({
		markdown: element.markdownContent || "",
	});
	if (!plainText.trim() || element.hidden) {
		return "";
	}

	const textElement: TextElement = {
		id: element.id,
		type: "text",
		name: element.name,
		duration: element.duration,
		startTime: element.startTime,
		trimStart: element.trimStart,
		trimEnd: element.trimEnd,
		content: plainText,
		fontSize: element.fontSize,
		fontFamily: element.fontFamily,
		color: element.textColor,
		backgroundColor: element.backgroundColor,
		textAlign: "left",
		fontWeight: "normal",
		fontStyle: "normal",
		textDecoration: "none",
		x: element.x,
		y: element.y,
		rotation: element.rotation,
		opacity: element.opacity,
	};

	return convertTextElementToDrawtext(textElement, platform);
}

/**
 * Text element with ordering information for filter chain building.
 */
interface TextElementWithOrder {
	element: TextElement | MarkdownElement;
	trackIndex: number;
	elementIndex: number;
}

/**
 * Build complete FFmpeg filter chain for all text overlays.
 *
 * Filter layering logic:
 * - Lower track index = rendered first (background)
 * - Higher track index = rendered last (foreground)
 * - Elements within track maintain timeline order
 *
 * @param tracks - Timeline tracks to extract text elements from
 * @param platform - Platform for font resolution (optional)
 * @returns Comma-separated FFmpeg drawtext filter chain
 */
export function buildTextOverlayFilters(
	tracks: TimelineTrack[],
	platform?: Platform
): string {
	const textElementsWithOrder: TextElementWithOrder[] = [];

	// Collect text elements with ordering info
	for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
		const track = tracks[trackIndex];
		for (
			let elementIndex = 0;
			elementIndex < track.elements.length;
			elementIndex++
		) {
			const element = track.elements[elementIndex];
			if (
				(element.type !== "text" && element.type !== "markdown") ||
				element.hidden
			) {
				continue;
			}

			textElementsWithOrder.push({
				element,
				trackIndex,
				elementIndex,
			});
		}
	}

	// Sort by track order, then element order (for proper layering)
	textElementsWithOrder.sort((a, b) => {
		if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex;
		return a.elementIndex - b.elementIndex;
	});

	return textElementsWithOrder
		.map((item) => {
			if (item.element.type === "markdown") {
				return convertMarkdownElementToDrawtext(item.element, platform);
			}
			return convertTextElementToDrawtext(item.element, platform);
		})
		.filter((f) => f !== "")
		.join(",");
}
