/**
 * Export preset data and lookup.
 * @module electron/claude/handlers/claude-export-handler/presets
 */

import type { ExportPreset } from "../../../types/claude-api";

// Platform-specific export presets
export const PRESETS: ExportPreset[] = [
	{
		id: "youtube-4k",
		name: "YouTube 4K",
		platform: "youtube",
		width: 3840,
		height: 2160,
		fps: 60,
		bitrate: "45Mbps",
		format: "mp4",
	},
	{
		id: "youtube-1080p",
		name: "YouTube 1080p",
		platform: "youtube",
		width: 1920,
		height: 1080,
		fps: 30,
		bitrate: "8Mbps",
		format: "mp4",
	},
	{
		id: "youtube-720p",
		name: "YouTube 720p",
		platform: "youtube",
		width: 1280,
		height: 720,
		fps: 30,
		bitrate: "5Mbps",
		format: "mp4",
	},
	{
		id: "tiktok",
		name: "TikTok",
		platform: "tiktok",
		width: 1080,
		height: 1920,
		fps: 30,
		bitrate: "6Mbps",
		format: "mp4",
	},
	{
		id: "instagram-reel",
		name: "Instagram Reel",
		platform: "instagram",
		width: 1080,
		height: 1920,
		fps: 30,
		bitrate: "5Mbps",
		format: "mp4",
	},
	{
		id: "instagram-post",
		name: "Instagram Post (Square)",
		platform: "instagram",
		width: 1080,
		height: 1080,
		fps: 30,
		bitrate: "5Mbps",
		format: "mp4",
	},
	{
		id: "instagram-landscape",
		name: "Instagram Post (Landscape)",
		platform: "instagram",
		width: 1080,
		height: 566,
		fps: 30,
		bitrate: "5Mbps",
		format: "mp4",
	},
	{
		id: "twitter",
		name: "Twitter/X",
		platform: "twitter",
		width: 1920,
		height: 1080,
		fps: 30,
		bitrate: "6Mbps",
		format: "mp4",
	},
	{
		id: "linkedin",
		name: "LinkedIn",
		platform: "linkedin",
		width: 1920,
		height: 1080,
		fps: 30,
		bitrate: "8Mbps",
		format: "mp4",
	},
	{
		id: "discord",
		name: "Discord (8MB limit)",
		platform: "discord",
		width: 1280,
		height: 720,
		fps: 30,
		bitrate: "2Mbps",
		format: "mp4",
	},
	{
		id: "gif-medium",
		name: "GIF Medium (720p)",
		platform: "web",
		width: 1280,
		height: 720,
		fps: 20,
		bitrate: "0",
		format: "gif",
	},
	{
		id: "gif-large",
		name: "GIF Large (1080p)",
		platform: "web",
		width: 1920,
		height: 1080,
		fps: 15,
		bitrate: "0",
		format: "gif",
	},
];

export function findPresetById({
	presetId,
}: {
	presetId: string;
}): ExportPreset | null {
	try {
		return PRESETS.find((preset) => preset.id === presetId) ?? null;
	} catch {
		return null;
	}
}

/** The preset id an export without a named preset reports. */
export const PROJECT_PRESET_ID = "project";

/** The preset used when neither a preset nor the project's size is known. */
export const FALLBACK_PRESET_ID = "youtube-1080p";

/** The picture a project is edited in. */
export interface ProjectPicture {
	width: number;
	height: number;
	fps: number;
}

/**
 * YouTube presets from small to large. A project-sized export takes the
 * bitrate of the first one whose longer side reaches the project's, so a
 * 1470×630 trailer gets the 1080p rate, not the 720p one.
 */
const PROJECT_BITRATE_LADDER = ["youtube-720p", "youtube-1080p", "youtube-4k"];

/** 4:2:0 H.264 needs even sides; an odd side drops its last pixel. */
function evenSide(value: number): number {
	return Math.max(2, Math.floor(value / 2) * 2);
}

/**
 * The bitrate of the YouTube preset a picture of this size falls under
 * (5 Mbps up to 720p, 8 Mbps up to 1080p, 45 Mbps above).
 */
export function bitrateForPictureSize({
	width,
	height,
}: {
	width: number;
	height: number;
}): string | null {
	const longerSide = Math.max(width, height);
	const ladder = PROJECT_BITRATE_LADDER.map((presetId) =>
		findPresetById({ presetId })
	).filter((preset): preset is ExportPreset => preset !== null);
	const sizedPreset =
		ladder.find(
			(preset) => Math.max(preset.width, preset.height) >= longerSide
		) ?? ladder.at(-1);
	return sizedPreset?.bitrate ?? null;
}

/**
 * What an export without a named preset uses: the project's own size and
 * frame rate as MP4, at the bitrate of the YouTube preset of that size.
 * Null when the project does not give a usable size or rate.
 */
export function projectExportPreset({
	project,
}: {
	project: ProjectPicture;
}): ExportPreset | null {
	const { width, height, fps } = project;
	const isUsable = [width, height, fps].every(
		(value) => Number.isFinite(value) && value > 0
	);
	if (!isUsable) return null;
	const bitrate = bitrateForPictureSize({ width, height });
	if (!bitrate) return null;
	return {
		id: PROJECT_PRESET_ID,
		name: "Project settings",
		platform: "project",
		width: evenSide(width),
		height: evenSide(height),
		fps,
		bitrate,
		format: "mp4",
	};
}
