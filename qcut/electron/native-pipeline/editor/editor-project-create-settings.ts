/**
 * Canvas size and frame rate for `editor:project:create`.
 *
 * `--width`/`--height`/`--fps` set them directly; `--match-media <file>`
 * reads them from a clip, and explicit flags win over it. They are applied
 * right after creation through the same route as `update-settings`, so
 * project.qcut and the open editor agree, and the first clip added later
 * keeps this size instead of fitting the canvas to itself.
 *
 * @module electron/native-pipeline/editor/editor-project-create-settings
 */

import { probeVideoInfo, type VideoInfo } from "../subtitle/probe-video.js";

export interface ProjectCreateSettings {
	width?: number;
	height?: number;
	fps?: number;
}

function isPositiveInteger(value: number | undefined): value is number {
	return value !== undefined && Number.isInteger(value) && value > 0;
}

/** The settings the flags ask for; throws on a request that cannot be met. */
export async function resolveProjectCreateSettings({
	width,
	height,
	fps,
	matchMedia,
	probe = probeVideoInfo,
}: {
	width?: number;
	height?: number;
	fps?: number;
	matchMedia?: string;
	probe?: (path: string) => Promise<VideoInfo>;
}): Promise<ProjectCreateSettings> {
	if ((width === undefined) !== (height === undefined)) {
		throw new Error("Give --width and --height together");
	}
	if (width !== undefined && !isPositiveInteger(width)) {
		throw new Error("--width must be a whole number of pixels above 0");
	}
	if (height !== undefined && !isPositiveInteger(height)) {
		throw new Error("--height must be a whole number of pixels above 0");
	}
	if (fps !== undefined && !(Number.isFinite(fps) && fps > 0)) {
		throw new Error("--fps must be a number above 0");
	}

	const settings: ProjectCreateSettings = {};
	if (matchMedia) {
		let info: VideoInfo;
		try {
			info = await probe(matchMedia);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`--match-media could not read ${matchMedia}: ${reason}`);
		}
		settings.width = info.width;
		settings.height = info.height;
		if (info.fps) settings.fps = info.fps;
	}
	if (width !== undefined && height !== undefined) {
		settings.width = width;
		settings.height = height;
	}
	if (fps !== undefined) settings.fps = fps;
	return settings;
}
