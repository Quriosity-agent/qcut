/**
 * Clips whose media the native export cannot find.
 *
 * A clip keeps playing in the preview from the editor's own copy of its
 * media while the item is gone from the project folder (renamed there,
 * deleted there, or its clip left pointing at an id that no longer exists).
 * The export used to leave such a clip out and report success, so the file
 * was missing a shot or a sound and nothing said so. It now names the clips
 * and stops.
 *
 * @module electron/claude/handlers/claude-export-handler/missing-clip-media
 */

import type { ClaudeElement } from "../../../types/claude-api.js";

export interface MissingClipMedia {
	elementId: string;
	/** The clip's own name, or the name of the media it asked for. */
	name?: string;
	trackName: string;
	startTime: number;
	/** What the clip asked for: its media id, or failing that its file name. */
	wanted: string;
}

/** The export cannot find the media of one or more clips. */
export class ClipMediaMissingError extends Error {
	readonly missing: MissingClipMedia[];

	constructor({ missing }: { missing: MissingClipMedia[] }) {
		super(describeMissingClipMedia({ missing }));
		this.name = "ClipMediaMissingError";
		this.missing = missing;
	}
}

/**
 * The record of a clip whose media was not found, or null when the clip
 * names no media at all (nothing was asked for, so nothing is missing) or
 * is hidden (it is not drawn or heard either way).
 */
export function missingClipMedia({
	element,
	trackName,
}: {
	element: ClaudeElement;
	trackName: string;
}): MissingClipMedia | null {
	if (element.hidden === true) return null;
	const wanted = element.sourceId || element.mediaId || element.sourceName;
	if (!wanted) return null;
	const name = element.name || element.sourceName;
	return {
		elementId: element.id,
		...(name ? { name } : {}),
		trackName,
		startTime: element.startTime,
		wanted,
	};
}

const LISTED_CLIPS = 10;

function seconds(value: number): string {
	return `${Number(value.toFixed(3))} s`;
}

export function describeMissingClipMedia({
	missing,
	limit = LISTED_CLIPS,
}: {
	missing: MissingClipMedia[];
	limit?: number;
}): string {
	const count = missing.length;
	const listed = missing
		.slice(0, limit)
		.map(
			(clip) =>
				`${clip.name ? `"${clip.name}" (${clip.elementId})` : clip.elementId} at ${seconds(clip.startTime)} on track "${clip.trackName}" asks for ${clip.wanted}`
		)
		.join("; ");
	const more = count > limit ? `; and ${count - limit} more` : "";
	const subject =
		count === 1
			? "1 clip plays media that is not in the project"
			: `${count} clips play media that is not in the project`;
	return `${subject}, and the export would leave ${count === 1 ? "it" : "them"} out: ${listed}${more}. Nothing was exported. Import the media again or give the ${count === 1 ? "clip" : "clips"} another file (editor:timeline:replace-media), delete ${count === 1 ? "it" : "them"}, or leave ${count === 1 ? "its track" : "their tracks"} out with --exclude-tracks.`;
}
