/**
 * What `editor timeline apply` can tell is wrong from the manifest alone,
 * checked before any media is imported or the timeline touched.
 *
 * The editor refuses these one request at a time, which used to mean a
 * misspelt track colour was found seconds into the apply, after tracks had
 * been deleted and made again, and the whole write was rolled back. Every
 * problem is reported at once so one edit of the manifest fixes them all.
 *
 * @module electron/native-pipeline/editor/editor-timeline-apply-preflight
 */
import {
	CLAUDE_TIMELINE_COLOR_LABELS,
	type ClaudeTrackType,
	isClaudeTimelineColorLabel,
} from "../../types/claude-api.js";
import { readGradeCubeLuts } from "../../types/color-cube-lut.js";
import {
	aliasFor,
	collectTransitions,
	isRecord,
	MEDIA_FAMILY_TYPES,
	manifestElementLength,
	type ManifestElement,
	type ManifestTrack,
	type TimelineManifest,
} from "./editor-timeline-manifest.js";

/** Every track type, so a new one cannot be added without listing it here. */
const TRACK_TYPES: Record<ClaudeTrackType, true> = {
	media: true,
	effect: true,
	text: true,
	audio: true,
	sticker: true,
	captions: true,
	adjustment: true,
	remotion: true,
	hyperframes: true,
	markdown: true,
};
const FIT_MODES = ["cover", "contain", "fill"];
const BLEND_MODES = [
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
];
const VISUAL_NUMBER_FIELDS = [
	"x",
	"y",
	"rotation",
	"scaleX",
	"scaleY",
	"opacity",
];

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** As the editor reads it: absent, null, "" and "none" all mean no colour. */
function colorLabelProblem({ value }: { value: unknown }): string | undefined {
	if (
		value === undefined ||
		value === null ||
		value === "" ||
		value === "none"
	) {
		return undefined;
	}
	if (isClaudeTimelineColorLabel(value)) return undefined;
	return `colorLabel must be one of: ${CLAUDE_TIMELINE_COLOR_LABELS.join(", ")} (got ${JSON.stringify(value)})`;
}

function isClipType({ element }: { element: ManifestElement }): boolean {
	return MEDIA_FAMILY_TYPES.has(element.type ?? "");
}

function trackProblems({
	track,
	index,
}: {
	track: ManifestTrack;
	index: number;
}): string[] {
	const name = `Track '${aliasFor(track, `track-${index}`)}'`;
	if (!isRecord(track)) return [`Track ${index} must be an object`];
	const problems: string[] = [];
	if (!track.type) {
		problems.push(`${name} is missing type`);
	} else if (!Object.hasOwn(TRACK_TYPES, track.type)) {
		problems.push(
			`${name}: type must be one of ${Object.keys(TRACK_TYPES).join(", ")} (got ${JSON.stringify(track.type)})`
		);
	}
	const colorLabel = colorLabelProblem({ value: track.colorLabel });
	if (colorLabel) problems.push(`${name}: ${colorLabel}`);
	if (track.elements !== undefined && !Array.isArray(track.elements)) {
		problems.push(`${name}: elements must be a list`);
	}
	return problems;
}

function elementProblems({
	element,
	alias,
}: {
	element: ManifestElement;
	alias: string;
}): string[] {
	const name = `Element '${alias}'`;
	if (!isRecord(element)) return [`${name} must be an object`];
	const problems: string[] = [];
	if (!element.type) problems.push(`${name} is missing type`);
	if (typeof element.startTime !== "number") {
		problems.push(`${name} is missing startTime`);
	} else if (element.startTime >= 0) {
		try {
			manifestElementLength({
				element: { ...element, startTime: element.startTime },
				alias,
			});
		} catch (error) {
			problems.push(messageOf(error));
		}
	} else {
		problems.push(`${name}: startTime must be 0 or more`);
	}
	const colorLabel = colorLabelProblem({ value: element.colorLabel });
	if (colorLabel) problems.push(`${name}: ${colorLabel}`);
	if (
		isClipType({ element }) &&
		element.fitMode !== undefined &&
		!FIT_MODES.includes(element.fitMode as string)
	) {
		problems.push(`${name}: fitMode must be one of ${FIT_MODES.join(", ")}`);
	}
	if (
		isClipType({ element }) &&
		element.blendMode !== undefined &&
		!BLEND_MODES.includes(element.blendMode as string)
	) {
		problems.push(
			`${name}: blendMode must be one of ${BLEND_MODES.join(", ")}`
		);
	}
	if (
		isClipType({ element }) &&
		element.blendEnabled !== undefined &&
		typeof element.blendEnabled !== "boolean"
	) {
		problems.push(`${name}: blendEnabled must be true or false`);
	}
	// Placement and grade are a clip's; text has a `color` and an `x` of its own.
	const isClip = isClipType({ element });
	for (const field of isClip ? VISUAL_NUMBER_FIELDS : []) {
		const value = element[field];
		if (value === undefined) continue;
		if (typeof value !== "number" || !Number.isFinite(value)) {
			problems.push(`${name}: ${field} must be a finite number`);
		}
	}
	const isGraded = isClip || element.type === "adjustment";
	if (isGraded && element.color !== undefined && element.color !== null) {
		if (isRecord(element.color)) {
			try {
				readGradeCubeLuts({ color: element.color });
			} catch (error) {
				problems.push(`${name}: ${messageOf(error)}`);
			}
		} else {
			problems.push(
				`${name}: color must be an object (a partial colour grade)`
			);
		}
	}
	return problems;
}

/**
 * Every problem the manifest itself shows, in manifest order; empty when
 * there is none. Aliases match the ones the apply reports later
 * (`element-<n>` counts top-level `elements` first, then each track's).
 */
export function manifestProblems({
	manifest,
}: {
	manifest: TimelineManifest;
}): string[] {
	const problems: string[] = [];
	const tracks = manifest.tracks ?? [];
	for (const [index, track] of tracks.entries()) {
		problems.push(...trackProblems({ track, index }));
	}
	let elementIndex = 0;
	const checkElements = (elements: unknown) => {
		if (!Array.isArray(elements)) return;
		for (const element of elements as ManifestElement[]) {
			const alias = isRecord(element)
				? aliasFor(element, `element-${elementIndex}`)
				: `element-${elementIndex}`;
			problems.push(...elementProblems({ element, alias }));
			elementIndex += 1;
		}
	};
	checkElements(manifest.elements);
	for (const track of tracks) {
		if (isRecord(track)) checkElements(track.elements);
	}
	// Left alone when a track is malformed: that is reported above already.
	const transitions = problems.length === 0 ? collectTransitions(manifest) : [];
	for (const [index, transition] of transitions.entries()) {
		if (!transition.type || typeof transition.duration !== "number") {
			problems.push(`Transition ${index} needs type and duration`);
		}
	}
	return problems;
}

/** The problems as one error, most useful first, capped so it stays readable. */
export function describeManifestProblems({
	problems,
	limit = 20,
}: {
	problems: string[];
	limit?: number;
}): string {
	const shown = problems.slice(0, limit).join("; ");
	const more =
		problems.length > limit ? `; and ${problems.length - limit} more` : "";
	const count =
		problems.length === 1 ? "1 problem" : `${problems.length} problems`;
	return `The manifest has ${count}; nothing was changed. ${shown}${more}`;
}
