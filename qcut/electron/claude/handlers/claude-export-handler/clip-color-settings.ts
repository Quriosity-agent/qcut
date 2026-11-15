/**
 * A clip's renderer-resolved grade as the native export reads it.
 *
 * @module electron/claude/handlers/claude-export-handler/clip-color-settings
 */

import type { VideoColorSettings } from "../../../ffmpeg/color-settings.js";
import { readGradeCubeLuts } from "../../../types/color-cube-lut.js";
import type { ClaudeElement } from "../../../types/claude-api.js";

/** A clip's grade cannot be exported; the message names the clip. */
export class ClipColorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ClipColorError";
	}
}

type ClipWithGrade = Pick<
	ClaudeElement,
	"id" | "name" | "sourceName" | "colorSettings"
>;

/** `"name" (id)`, so an export error says which clip to fix. */
function clipLabel({ element }: { element: ClipWithGrade }): string {
	const name = element.name || element.sourceName;
	return name ? `"${name}" (${element.id})` : element.id;
}

/**
 * The grade the renderer serialized for a clip (`colorSettings`, present
 * only when the grade has visible edits), with every 3D LUT it carries
 * checked. A LUT that cannot be written to a .cube file fails here, naming
 * the clip, instead of deep in the filter build as "Cannot read properties
 * of undefined".
 */
export function readClipColorSettings({
	element,
}: {
	element: ClipWithGrade;
}): VideoColorSettings | undefined {
	const raw = element.colorSettings;
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return undefined;
	}
	try {
		return readGradeCubeLuts({
			color: raw,
			prefix: "color",
		}) as unknown as VideoColorSettings;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new ClipColorError(
			`Clip ${clipLabel({ element })} has a 3D LUT that cannot be exported: ${reason}`
		);
	}
}
