import {
	generateASS,
	parseCssColor,
	resolveSecondaryLineStyle,
	resolveSubtitleStyle,
	type AssFontMetricsLookup,
	type CaptionTextMeasurer,
} from "@qcut/editor-core";
import {
	sortTracksByOrder,
	type TimelineElement,
	type TimelineTrack,
} from "@/types/timeline";
import { buildTextASSOverlay } from "../export-cli/filters/text-ass-overlay";
import { captionStackOffset } from "@/lib/captions/caption-stacking";
import { resolveTextStyle } from "@/lib/text/text-style";
import { stripMarkdownSyntax } from "@/lib/markdown";
import { createBrowserCaptionMeasurer } from "./caption-text-measurement";
import { resolveExportProjectCanvas } from "./export-project-canvas";

function markdownAsTextElement({
	element,
}: {
	element: Extract<TimelineElement, { type: "markdown" }>;
}): Extract<TimelineElement, { type: "text" }> {
	return {
		id: element.id,
		type: "text",
		name: element.name,
		duration: element.duration,
		startTime: element.startTime,
		trimStart: element.trimStart,
		trimEnd: element.trimEnd,
		hidden: element.hidden,
		content: stripMarkdownSyntax({ markdown: element.markdownContent }),
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
		width: element.width,
		height: element.height,
		rotation: element.rotation,
		opacity: element.opacity,
	};
}

/**
 * Colours no export can read (a typo, `oklch()`), which the ASS layers draw
 * white, or black for a shadow. The native export names them in its `warnings`.
 */
export function unreadableTextColors({
	tracks,
}: {
	tracks: TimelineTrack[];
}): string[] {
	const unread = new Set<string>();
	const check = (id: string, colors: Record<string, string | undefined>) => {
		for (const [field, value] of Object.entries(colors)) {
			if (value === undefined || parseCssColor(value)) continue;
			unread.add(`${field} "${value}" on ${id}`);
		}
	};
	for (const track of tracks) {
		for (const element of track.elements) {
			if (element.type === "text") {
				const {
					id,
					color,
					backgroundColor,
					strokeColor,
					shadowColor,
					glowColor,
				} = element;
				check(id, {
					color,
					backgroundColor,
					strokeColor,
					shadowColor,
					glowColor,
				});
			} else if (element.type === "markdown") {
				const { id, textColor, backgroundColor } = element;
				check(id, { textColor, backgroundColor });
			} else if (element.type === "captions") {
				const style = resolveSubtitleStyle(element.style);
				check(element.id, {
					fontColor: style.fontColor,
					outlineColor: style.outlineColor,
					shadowColor: style.shadowColor,
					backgroundColor: style.backgroundColor,
					"secondary.fontColor": resolveSecondaryLineStyle(style).fontColor,
				});
			}
		}
	}
	return [...unread];
}

/**
 * The canvas an export's ASS layers are written for. Elements are placed and
 * sized in the project canvas's pixels and libass scales PlayRes to the frame,
 * so at another resolution this is the project's canvas, as in the native
 * export. An export of another shape keeps the frame's shape, so that libass
 * scales both axes alike.
 */
export function assCanvasForExport({
	project,
	frame,
}: {
	project?: { width: number; height: number };
	frame: { width: number; height: number };
}): { width: number; height: number } {
	const { canvas } = resolveExportProjectCanvas({ project, frame });
	return {
		width: Math.round(canvas.width),
		height: Math.round(canvas.height),
	};
}

export interface TimelineAssLayer {
	content: string;
	blendMode: NonNullable<
		Extract<TimelineElement, { type: "text" }>["blendMode"]
	>;
	trackOrder: number;
	elementOrder: number;
}

export type CaptionExportPlatform = "darwin" | "win32" | "linux";

export function resolveCjkExportFont({
	platform,
}: {
	platform?: CaptionExportPlatform;
}): string | undefined {
	if (platform === "darwin") return "Hiragino Sans GB";
	if (platform === "win32") return "Microsoft YaHei";
	if (platform === "linux") return "Noto Sans CJK SC";
	return undefined;
}

/**
 * Every font family the ASS layers for these tracks may name, so their
 * metrics can be fetched in one IPC call before the layers are built.
 */
export function assFontFamiliesInTracks({
	tracks,
	platform,
}: {
	tracks: TimelineTrack[];
	platform?: CaptionExportPlatform;
}): string[] {
	const families = new Set<string>();
	const cjkFontFamily = resolveCjkExportFont({ platform });
	if (cjkFontFamily) families.add(cjkFontFamily);
	for (const track of tracks) {
		for (const element of track.elements) {
			if (element.type === "text" || element.type === "markdown") {
				const family = (element as { fontFamily?: string }).fontFamily;
				if (family) families.add(family);
				continue;
			}
			if (element.type === "captions") {
				const style = resolveSubtitleStyle(element.style);
				families.add(style.fontFamily);
				families.add(resolveSecondaryLineStyle(style).fontFamily);
			}
		}
	}
	return [...families];
}

export function buildTimelineAssLayers({
	tracks,
	canvasWidth,
	canvasHeight,
	fps,
	platform,
	excludedTextElementIds = new Set(),
	fontMetrics,
	familyCoversCjk,
	measureCaptionText = createBrowserCaptionMeasurer(),
}: {
	tracks: TimelineTrack[];
	canvasWidth: number;
	canvasHeight: number;
	fps: number;
	platform?: CaptionExportPlatform;
	excludedTextElementIds?: ReadonlySet<string>;
	/**
	 * What libass will do with each face, from `loadAssFontMetrics`. Without
	 * it captions keep the nominal ASS Fontsize, which libass renders about
	 * 15 % small (N31).
	 */
	fontMetrics?: AssFontMetricsLookup;
	/** Whether an installed family carries CJK glyphs, read from the font. */
	familyCoversCjk?: (family: string) => boolean;
	measureCaptionText?: CaptionTextMeasurer;
}): {
	layers: TimelineAssLayer[];
	renderedTextElementIds: Set<string>;
} {
	const layers: TimelineAssLayer[] = [];
	const renderedTextElementIds = new Set<string>();
	const orderedTracks = sortTracksByOrder(tracks);
	const cjkFontFamily = resolveCjkExportFont({ platform });

	for (let trackOrder = 0; trackOrder < orderedTracks.length; trackOrder++) {
		const track = orderedTracks[trackOrder];
		if (track.hidden) continue;

		for (
			let elementOrder = 0;
			elementOrder < track.elements.length;
			elementOrder++
		) {
			const element = track.elements[elementOrder];
			if (element.hidden) continue;

			if (element.type === "text" && !excludedTextElementIds.has(element.id)) {
				const layer = buildTextASSOverlay({
					tracks: [{ ...track, elements: [element] }],
					allTracks: orderedTracks,
					canvasWidth,
					canvasHeight,
					fps,
					fontMetrics,
					familyCoversCjk,
				});
				if (!layer.content) continue;
				layers.push({
					content: layer.content,
					blendMode: resolveTextStyle(element).blendMode,
					trackOrder,
					elementOrder,
				});
				renderedTextElementIds.add(element.id);
				continue;
			}

			if (element.type === "captions") {
				layers.push({
					content: generateASS([element], {
						resolution: { width: canvasWidth, height: canvasHeight },
						title: `QCut Caption ${element.id}`,
						cjkFontFamily,
						fps,
						fontMetrics,
						familyCoversCjk,
						measureText: measureCaptionText,
						// Each caption is a layer of its own, so libass cannot see
						// the others to stack them; the preview's order does it.
						stackOffset: ({ measureHeight }) =>
							captionStackOffset({ tracks, element, measureHeight }),
					}),
					blendMode: "normal",
					trackOrder,
					elementOrder,
				});
				continue;
			}

			if (element.type === "markdown") {
				const textElement = markdownAsTextElement({ element });
				const layer = buildTextASSOverlay({
					tracks: [{ ...track, type: "text", elements: [textElement] }],
					allTracks: orderedTracks,
					canvasWidth,
					canvasHeight,
					fps,
					fontMetrics,
					familyCoversCjk,
				});
				if (!layer.content) continue;
				layers.push({
					content: layer.content,
					blendMode: "normal",
					trackOrder,
					elementOrder,
				});
				renderedTextElementIds.add(element.id);
			}
		}
	}

	return { layers, renderedTextElementIds };
}
