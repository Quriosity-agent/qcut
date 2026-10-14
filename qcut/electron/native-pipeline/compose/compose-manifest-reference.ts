/**
 * The compose manifest format as `qcut compose schema` prints it: every field
 * with its type, default, and meaning, plus a working example.
 *
 * compose-manifest-reference.test.ts keeps this in step with the zod schema in
 * compose-manifest.ts: every schema field must be listed here, nothing else
 * may be, and the example must parse.
 */

import {
	COMPOSE_VOLUME_DB_MAX,
	COMPOSE_VOLUME_DB_MIN,
	MAX_COMPOSE_VOLUME_KEYFRAMES,
} from "./compose-volume-keyframes.js";

export interface ComposeManifestField {
	/** Dotted path; `[]` marks an array item. */
	path: string;
	type: string;
	required?: boolean;
	default?: unknown;
	description: string;
}

const VOLUME_DB_RANGE = `number ${COMPOSE_VOLUME_DB_MIN} to ${COMPOSE_VOLUME_DB_MAX}`;

function trimFields({
	owner,
	media,
}: {
	owner: "clips[]" | "audio[]";
	media: string;
}): ComposeManifestField[] {
	return [
		{
			path: `${owner}.trim`,
			type: "object",
			default: { in: 0 },
			description: `Part of the ${media} to use, in source seconds.`,
		},
		{
			path: `${owner}.trim.in`,
			type: "number >= 0",
			default: 0,
			description: "First source second used.",
		},
		{
			path: `${owner}.trim.out`,
			type: "number > trim.in",
			description:
				owner === "clips[]"
					? "Source second to stop at; defaults to the end of a video. Images need it: it sets how long the still shows."
					: "Source second to stop at; defaults to the end of the file.",
		},
	];
}

function volumeKeyframeFields({
	owner,
}: {
	owner: "clips[]" | "audio[]";
}): ComposeManifestField[] {
	return [
		{
			path: `${owner}.volumeKeyframes`,
			type: `array, at most ${MAX_COMPOSE_VOLUME_KEYFRAMES}`,
			default: [],
			description:
				"Level over time, e.g. ducking music under speech. Linear in dB between keyframes; the first and last levels hold before and after them. Order does not matter.",
		},
		{
			path: `${owner}.volumeKeyframes[].time`,
			type: "number >= 0",
			required: true,
			description:
				owner === "clips[]"
					? "Seconds from the clip's first frame (trim.in)."
					: "Seconds from the sound's start (trim.in).",
		},
		{
			path: `${owner}.volumeKeyframes[].volumeDb`,
			type: VOLUME_DB_RANGE,
			required: true,
			description:
				"Level in dB: 0 leaves it unchanged, -6 halves the amplitude.",
		},
	];
}

function fadeFields({
	owner,
	what,
}: {
	owner: "overlays[]" | "audio[]";
	what: string;
}): ComposeManifestField[] {
	return (["fadeIn", "fadeOut"] as const).map((key) => ({
		path: `${owner}.${key}`,
		type: "number 0 to 5",
		default: 0,
		description: `Seconds to fade the ${what} ${key === "fadeIn" ? "in at its start" : "out before its end"}.`,
	}));
}

export const COMPOSE_MANIFEST_FIELDS: readonly ComposeManifestField[] = [
	{
		path: "schemaVersion",
		type: "1",
		required: true,
		description: "Manifest format version.",
	},
	{
		path: "canvas",
		type: "object",
		default: { width: 1280, height: 720, fps: 30 },
		description: "Output frame for headless renders.",
	},
	{
		path: "canvas.width",
		type: "integer 1 to 4096",
		default: 1280,
		description: "Pixels.",
	},
	{
		path: "canvas.height",
		type: "integer 1 to 4096",
		default: 720,
		description: "Pixels.",
	},
	{
		path: "canvas.fps",
		type: "integer 1 to 60",
		default: 30,
		description: "Frames per second.",
	},
	{
		path: "clips",
		type: "array, 1 to 8",
		required: true,
		description:
			"Main-track clips, played back to back in this order. Source files are probed, so durations come from the files.",
	},
	{
		path: "clips[].id",
		type: "string, 1 to 80 characters",
		required: true,
		description: "Unique clip id; transitions refer to clips by it.",
	},
	{
		path: "clips[].source",
		type: "string",
		required: true,
		description:
			"Video or image file; relative paths resolve from the manifest's folder.",
	},
	...trimFields({ owner: "clips[]", media: "source" }),
	{
		path: "clips[].filters",
		type: "array, at most 16",
		default: [],
		description: "Filter Lab cards applied to the clip in order.",
	},
	{
		path: "clips[].filters[].resourceId",
		type: "string of digits",
		required: true,
		description: "Filter Lab resource id, from `qcut filter-lab list`.",
	},
	{
		path: "clips[].filters[].intensity",
		type: "number 0 to 100",
		default: 100,
		description: "Filter strength.",
	},
	...volumeKeyframeFields({ owner: "clips[]" }),
	{
		path: "transitions",
		type: "array, at most 7",
		default: [],
		description: "Crossfades between clips.",
	},
	{
		path: "transitions[].between",
		type: "[clipId, clipId]",
		required: true,
		description:
			"Two clip ids that are next to each other in `clips` order, earlier one first.",
	},
	{
		path: "transitions[].preset",
		type: '"crossfade"',
		default: "crossfade",
		description: "Transition style.",
	},
	{
		path: "transitions[].duration",
		type: "number > 0, at most 5",
		default: 0.5,
		description:
			"Seconds the two clips overlap; the edit gets shorter by this much.",
	},
	{
		path: "overlays",
		type: "array, at most 50",
		default: [],
		description: "Stickers over the video.",
	},
	{
		path: "overlays[].type",
		type: '"sticker"',
		required: true,
		description: "Overlay kind.",
	},
	{
		path: "overlays[].source",
		type: "string",
		required: true,
		description:
			"Sticker image (.png, .jpg, .jpeg, .webp, .svg); relative paths resolve from the manifest's folder.",
	},
	{
		path: "overlays[].start",
		type: "number >= 0",
		required: true,
		description: "Timeline seconds the sticker appears at.",
	},
	{
		path: "overlays[].duration",
		type: "number > 0, at most 120",
		required: true,
		description: "Seconds on screen.",
	},
	{
		path: "overlays[].transform",
		type: "object",
		default: { x: 0, y: 0, scale: 0.2, rotation: 0 },
		description: "Placement on the canvas.",
	},
	{
		path: "overlays[].transform.x",
		type: "number -1 to 1",
		default: 0,
		description: "Horizontal centre: -1 left edge, 0 middle, 1 right edge.",
	},
	{
		path: "overlays[].transform.y",
		type: "number -1 to 1",
		default: 0,
		description: "Vertical centre: -1 top edge, 0 middle, 1 bottom edge.",
	},
	{
		path: "overlays[].transform.scale",
		type: "number > 0, at most 2",
		default: 0.2,
		description: "Sticker width as a fraction of the canvas's shorter side.",
	},
	{
		path: "overlays[].transform.rotation",
		type: "number -360 to 360",
		default: 0,
		description: "Degrees clockwise.",
	},
	{
		path: "overlays[].opacity",
		type: "number 0 to 1",
		default: 1,
		description: "1 is fully opaque.",
	},
	...fadeFields({ owner: "overlays[]", what: "sticker" }),
	{
		path: "audio",
		type: "array, at most 50",
		default: [],
		description:
			"Sound effects and music, each on its own track and mixed over the clips' audio.",
	},
	{
		path: "audio[].type",
		type: '"sound-effect"',
		required: true,
		description: "Audio kind; music beds use it too.",
	},
	{
		path: "audio[].source",
		type: "string",
		required: true,
		description:
			"Audio file, or a video with an audio stream; relative paths resolve from the manifest's folder.",
	},
	{
		path: "audio[].start",
		type: "number >= 0",
		required: true,
		description: "Timeline seconds the sound starts at.",
	},
	...trimFields({ owner: "audio[]", media: "file" }),
	{
		path: "audio[].volume",
		type: "number 0 to 4",
		default: 1,
		description:
			"Fixed gain, 1 unchanged. Editor targets accept at most 1. Leave it at 1 when volumeKeyframes set the level.",
	},
	...fadeFields({ owner: "audio[]", what: "sound" }),
	...volumeKeyframeFields({ owner: "audio[]" }),
];

/**
 * Two clips joined by a crossfade, a filter on the first, a sticker, and a
 * music bed ducked under the second clip's dialogue.
 */
export const COMPOSE_MANIFEST_EXAMPLE = {
	schemaVersion: 1,
	canvas: { width: 1920, height: 1080, fps: 30 },
	clips: [
		{
			id: "intro",
			source: "media/intro.mp4",
			trim: { in: 1, out: 7 },
			filters: [{ resourceId: "7524288987129810214", intensity: 70 }],
		},
		{
			id: "interview",
			source: "media/interview.mp4",
			trim: { in: 0, out: 12 },
		},
	],
	transitions: [
		{ between: ["intro", "interview"], preset: "crossfade", duration: 0.5 },
	],
	overlays: [
		{
			type: "sticker",
			source: "stickers/logo.png",
			start: 0.5,
			duration: 4,
			transform: { x: 0.7, y: -0.7, scale: 0.15, rotation: 0 },
			opacity: 0.9,
			fadeIn: 0.3,
			fadeOut: 0.3,
		},
	],
	audio: [
		{
			type: "sound-effect",
			source: "audio/music.mp3",
			start: 0,
			trim: { in: 0, out: 17.5 },
			fadeOut: 1.5,
			volumeKeyframes: [
				{ time: 0, volumeDb: 0 },
				{ time: 5.5, volumeDb: 0 },
				{ time: 6.5, volumeDb: -18 },
				{ time: 16, volumeDb: -18 },
				{ time: 17, volumeDb: -6 },
			],
		},
	],
} as const;
