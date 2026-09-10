import type { MediaItem } from "@/stores/media/media-store-types";
import { useStabilizationStore } from "@/stores/stabilization-store";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import {
	drawStabilizedFrame,
	IDENTITY_STABILIZED_FRAME,
	lookupStabilizedFrame,
} from "@/lib/stabilization/stabilization-plan";

/**
 * Canvas-export side of the in-house stabilizer. The analysis is resolved
 * before the first frame is encoded; at render time every video frame of a
 * stabilized clip is pre-warped into a same-size canvas that then flows
 * through the normal bounds/crop/colour pipeline. A missing plan is an error,
 * never a silent fallback to the shaky source.
 */

function stabilizedMediaElements({
	tracks,
}: {
	tracks: readonly TimelineTrack[];
}): MediaElement[] {
	const elements: MediaElement[] = [];
	for (const track of tracks) {
		for (const element of track.elements) {
			if (
				element.type === "media" &&
				(element.enhancements?.stabilization ?? 0) > 0
			) {
				elements.push(element);
			}
		}
	}
	return elements;
}

/** True when any media element asks for stabilization (video or not). */
export function timelineHasStabilization({
	tracks,
}: {
	tracks: readonly TimelineTrack[];
}): boolean {
	return stabilizedMediaElements({ tracks }).length > 0;
}

/** Runs or reuses the motion analysis of every stabilized video before export. */
export async function prepareExportStabilization({
	tracks,
	mediaItems,
	onProgress,
}: {
	tracks: readonly TimelineTrack[];
	mediaItems: readonly MediaItem[];
	onProgress?: (progress: number) => void;
}): Promise<void> {
	const byId = new Map(mediaItems.map((item) => [item.id, item] as const));
	const videos = new Map<string, MediaItem>();
	for (const element of stabilizedMediaElements({ tracks })) {
		const mediaItem = byId.get(element.mediaId);
		if (mediaItem?.type === "video") videos.set(mediaItem.id, mediaItem);
	}
	let done = 0;
	for (const mediaItem of videos.values()) {
		await useStabilizationStore.getState().ensureAnalysis({ mediaItem });
		done += 1;
		onProgress?.(done / videos.size);
	}
}

const frameCanvases = new Map<
	string,
	{ canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }
>();

/**
 * Returns the stabilized version of one decoded frame, drawn into a canvas
 * owned by this element. Throws when the plan is not ready.
 */
export function stabilizeExportFrame({
	element,
	mediaItem,
	source,
	sourceWidth,
	sourceHeight,
	sourceTimestamp,
}: {
	element: MediaElement;
	mediaItem: Pick<MediaItem, "id" | "name">;
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	sourceTimestamp: number;
}): HTMLCanvasElement {
	const plan = useStabilizationStore.getState().getPlan({
		mediaId: mediaItem.id,
		stabilization: element.enhancements?.stabilization ?? 0,
	});
	if (!plan) {
		throw new Error(
			`Stabilization analysis for "${mediaItem.name}" is not ready; export cannot substitute the shaky source.`
		);
	}
	let entry = frameCanvases.get(element.id);
	if (
		!entry ||
		entry.canvas.width !== sourceWidth ||
		entry.canvas.height !== sourceHeight
	) {
		const canvas = document.createElement("canvas");
		canvas.width = sourceWidth;
		canvas.height = sourceHeight;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Stabilization canvas is unavailable.");
		entry = { canvas, context };
		frameCanvases.set(element.id, entry);
	}
	drawStabilizedFrame({
		context: entry.context,
		source,
		frame:
			lookupStabilizedFrame({ plan, sourceTimeSeconds: sourceTimestamp }) ??
			IDENTITY_STABILIZED_FRAME,
		cropScale: plan.cropScale,
		width: sourceWidth,
		height: sourceHeight,
	});
	return entry.canvas;
}

/** Releases the per-element frame canvases at the end of an export. */
export function destroyExportStabilizationCanvases(): void {
	frameCanvases.clear();
}
