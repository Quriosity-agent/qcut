/**
 * Default lengths for add requests that name media but give no duration.
 *
 * Without one the renderer falls back to what its media item knows, and for a
 * file the CLI imported a moment ago that may be nothing yet. So the file on
 * disk is probed here before the request reaches the renderer. The probe uses
 * the video stream's length, so a clip ends with its picture rather than with
 * a slightly longer audio track.
 *
 * @module electron/claude/handlers/claude-media-default-duration
 */

import type { MediaFile } from "../../types/claude-api";
import { findMediaFile, listMediaFiles } from "./claude-media-handler.js";
import { withMediaProbes } from "./claude-media-probe.js";

/** The add-request fields this looks at; everything else passes through. */
interface MediaAddRequest {
	type?: unknown;
	duration?: unknown;
	durationFrames?: unknown;
	endTime?: unknown;
	sourceId?: unknown;
	mediaId?: unknown;
	sourceName?: unknown;
}

const TIMED_MEDIA_TYPES = new Set(["media", "video", "audio"]);

function needsDefaultDuration(element: MediaAddRequest): boolean {
	return (
		TIMED_MEDIA_TYPES.has(String(element.type)) &&
		element.duration === undefined &&
		element.durationFrames === undefined &&
		element.endTime === undefined
	);
}

function mediaFileFor({
	element,
	files,
}: {
	element: MediaAddRequest;
	files: MediaFile[];
}): MediaFile | null {
	for (const reference of [
		element.sourceId,
		element.mediaId,
		element.sourceName,
	]) {
		if (typeof reference !== "string") continue;
		const file = findMediaFile({ files, mediaId: reference });
		if (file) return file;
	}
	return null;
}

/**
 * Gives each timed media request without a length the length of its file.
 * Requests whose file cannot be found or read are returned unchanged.
 */
export async function withDefaultMediaDurations<T extends MediaAddRequest>({
	projectId,
	elements,
}: {
	projectId: string;
	elements: T[];
}): Promise<T[]> {
	if (!elements.some(needsDefaultDuration)) return elements;

	const files = await listMediaFiles(projectId);
	const fileByIndex = new Map<number, MediaFile>();
	for (const [index, element] of elements.entries()) {
		if (!needsDefaultDuration(element)) continue;
		const file = mediaFileFor({ element, files });
		if (file) fileByIndex.set(index, file);
	}
	// One probe pass over the distinct files keeps a 50-clip batch from
	// starting 50 ffprobe processes at once.
	const distinctFiles = [...new Set(fileByIndex.values())];
	const probed = await withMediaProbes(distinctFiles);
	const durationByPath = new Map(
		probed.map((file) => [file.path, file.duration])
	);

	return elements.map((element, index) => {
		const file = fileByIndex.get(index);
		const duration = file ? durationByPath.get(file.path) : undefined;
		return duration === undefined ? element : { ...element, duration };
	});
}
