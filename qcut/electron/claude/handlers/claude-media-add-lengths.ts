/**
 * What the lengths of a media add request mean, settled before the editor
 * places the clip, and the lengths that cannot be what the caller meant
 * refused.
 *
 * The editor keeps a clip's `duration` as its source span BEFORE trims: what
 * shows is `duration − trimStart − trimEnd`, divided by the speed. `timeline
 * export` reports the span AFTER trims instead, with `timelineDuration` (the
 * length on the timeline) and `endTime` beside it. A request may be written
 * either way:
 *
 * - with `timelineDuration`, `duration` is the span after the trims, as the
 *   export writes it (without a `duration`, it is `timelineDuration` × speed);
 * - with `endTime` and no `duration`, the clip lasts `endTime − startTime` on
 *   the timeline;
 * - otherwise `duration` is the span before the trims, and a trimmed clip of
 *   a video or audio file must then span the whole file. A shorter one is a
 *   length after trims written as one before: 8.5 s with trimEnd 6.54 s on a
 *   15.04 s file put a 1.96 s clip on the timeline (Q1, 2026-11-08 report).
 *
 * Either way a clip with nothing left after its trims is refused (Q3: such
 * clips were placed at 0 s), and the editor gets its own `duration` with no
 * `timelineDuration` or `endTime` left to read differently.
 *
 * @module electron/claude/handlers/claude-media-add-lengths
 */

import { clampMediaPlaybackRate } from "../../ffmpeg/media-speed-constants.js";
import type { MediaFile } from "../../types/claude-api";
import {
	mediaFileFor,
	withDefaultMediaDurations,
} from "./claude-media-default-duration.js";
import { listMediaFiles } from "./claude-media-handler.js";
import { withMediaProbes } from "./claude-media-probe.js";

/** Lengths this close are the same length (the read-back tolerance). */
const SAME_LENGTH_SECONDS = 0.001;

/**
 * How far short of its file a whole-file `duration` may fall: a length
 * rounded to two decimals (15.04 for 15.041667) is still the file's.
 */
const FILE_LENGTH_SLACK_SECONDS = 0.05;

const MEDIA_FAMILY_TYPES = new Set(["media", "video", "audio", "image"]);
const TIMED_FILE_TYPES = new Set<MediaFile["type"]>(["video", "audio"]);

/** The add-request fields this reads; everything else passes through. */
export interface MediaLengthRequest {
	type?: unknown;
	id?: unknown;
	name?: unknown;
	sourceName?: unknown;
	sourceId?: unknown;
	mediaId?: unknown;
	startTime?: unknown;
	duration?: unknown;
	durationFrames?: unknown;
	endTime?: unknown;
	timelineDuration?: unknown;
	trimStart?: unknown;
	trimEnd?: unknown;
	playbackRate?: unknown;
	speedKeyframes?: unknown;
	freezeFrameDuration?: unknown;
	style?: unknown;
}

const WITH_TRIMS_HINT =
	'With trims, give "timelineDuration" (the length on the timeline; duration is then the span after the trims, as timeline export writes it), or give the file\'s whole length as duration.';

function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function seconds(value: number): string {
	return `${Number(value.toFixed(6))}s`;
}

interface ClipTiming {
	trimStart: number;
	trimEnd: number;
	/** Constant speed, clamped as the editor clamps it; 1 when none is given. */
	rate: number;
	freeze: number;
	/** Speed keyframes reshape the span, so no formula maps it. */
	keyframed: boolean;
}

/** Trims and speed as the editor reads them (a field, else its `style`). */
function timingOf(element: MediaLengthRequest): ClipTiming {
	const style =
		typeof element.style === "object" && element.style !== null
			? (element.style as Record<string, unknown>)
			: {};
	const read = (
		key: "playbackRate" | "speedKeyframes" | "freezeFrameDuration"
	) => element[key] ?? style[key];
	const rate = finite(read("playbackRate"));
	const keyframes = read("speedKeyframes");
	return {
		trimStart: Math.max(0, finite(element.trimStart) ?? 0),
		trimEnd: Math.max(0, finite(element.trimEnd) ?? 0),
		// Clamped as the editor clamps it (0.1–10), or a length worked out
		// from a speed it does not keep would place the clip at another length.
		rate: clampMediaPlaybackRate({ rate }),
		freeze: Math.max(0, finite(read("freezeFrameDuration")) ?? 0),
		keyframed: Array.isArray(keyframes) && keyframes.length > 0,
	};
}

/** The span after trims, as it lasts on the timeline at constant speed. */
function spanOnTimeline({
	afterTrims,
	timing,
}: {
	afterTrims: number;
	timing: ClipTiming;
}): number {
	return afterTrims / timing.rate + timing.freeze;
}

function clipLabel({
	element,
	index,
	count,
}: {
	element: MediaLengthRequest;
	index: number;
	count: number;
}): string {
	const name = [
		element.id,
		element.name,
		element.sourceName,
		element.sourceId,
		element.mediaId,
	].find((value) => typeof value === "string" && value.trim());
	const head = count === 1 ? "The clip" : `Element ${index}`;
	return name ? `${head} ("${name}")` : head;
}

/** The request with the editor's `duration` and no timeline lengths left. */
function withoutTimelineFields<T extends MediaLengthRequest>({
	element,
	duration,
}: {
	element: T;
	duration: number;
}): T {
	const {
		timelineDuration: _timelineDuration,
		endTime: _endTime,
		...rest
	} = element;
	return { ...rest, duration } as unknown as T;
}

/**
 * A request written with the timeline's lengths (`timelineDuration`, or an
 * `endTime` without `duration`), turned into the editor's `duration`. Returns
 * undefined for a request in the editor's own terms.
 */
function fromTimelineLength<T extends MediaLengthRequest>({
	element,
	label,
}: {
	element: T;
	label: string;
}): T | undefined {
	const timing = timingOf(element);
	const startTime = finite(element.startTime);
	const endTime = finite(element.endTime);
	const duration = finite(element.duration);
	let span = finite(element.timelineDuration);
	if (span === undefined) {
		if (
			endTime === undefined ||
			element.duration !== undefined ||
			element.durationFrames !== undefined
		) {
			return;
		}
		if (startTime === undefined) {
			throw new Error(`${label}: endTime needs a startTime in seconds`);
		}
		span = endTime - startTime;
	} else if (
		endTime !== undefined &&
		startTime !== undefined &&
		Math.abs(startTime + span - endTime) > SAME_LENGTH_SECONDS
	) {
		throw new Error(
			`${label}: endTime ${seconds(endTime)} disagrees with startTime ${seconds(startTime)} + timelineDuration ${seconds(span)}`
		);
	}
	if (span <= SAME_LENGTH_SECONDS) {
		throw new Error(`${label}: its length on the timeline must be above 0`);
	}
	if (duration === undefined && timing.keyframed) {
		throw new Error(
			`${label}: a clip with speed keyframes needs duration (the span after the trims) beside its length on the timeline`
		);
	}
	const afterTrims =
		duration ?? Math.max(0, span - timing.freeze) * timing.rate;
	if (afterTrims <= SAME_LENGTH_SECONDS) {
		throw new Error(`${label}: nothing is left of it after its trims`);
	}
	if (
		duration !== undefined &&
		!timing.keyframed &&
		Math.abs(spanOnTimeline({ afterTrims, timing }) - span) >
			SAME_LENGTH_SECONDS
	) {
		const expected = Math.max(0, span - timing.freeze) * timing.rate;
		throw new Error(
			`${label}: duration ${seconds(duration)} disagrees with its ${seconds(span)} on the timeline. Beside timelineDuration, duration is the span after the trims, as timeline export writes it: ${seconds(expected)} here (or leave duration out).`
		);
	}
	return withoutTimelineFields({
		element,
		duration: afterTrims + timing.trimStart + timing.trimEnd,
	});
}

/**
 * Checks a request in the editor's own terms (`duration` before trims) and
 * drops an `endTime` that agrees with it. `fileLength` is the clip's video or
 * audio file length when known.
 */
function checkEditorLength<T extends MediaLengthRequest>({
	element,
	label,
	fileLength,
}: {
	element: T;
	label: string;
	fileLength?: number;
}): T {
	const timing = timingOf(element);
	const trimmed = timing.trimStart > 0 || timing.trimEnd > 0;
	if (trimmed && element.durationFrames !== undefined) {
		throw new Error(
			`${label}: durationFrames counts the frames before the trims. ${WITH_TRIMS_HINT}`
		);
	}
	const duration = finite(element.duration);
	if (duration === undefined) return element;
	const afterTrims = duration - timing.trimStart - timing.trimEnd;
	if (afterTrims <= SAME_LENGTH_SECONDS) {
		throw new Error(
			`${label}: trimStart ${seconds(timing.trimStart)} and trimEnd ${seconds(timing.trimEnd)} leave nothing of duration ${seconds(duration)}, the clip's source span before its trims. ${WITH_TRIMS_HINT}`
		);
	}
	if (
		trimmed &&
		fileLength !== undefined &&
		duration < fileLength - FILE_LENGTH_SLACK_SECONDS
	) {
		const shown = timing.keyframed
			? ""
			: `, so the trims leave ${seconds(spanOnTimeline({ afterTrims, timing }))} on the timeline`;
		throw new Error(
			`${label}: duration ${seconds(duration)} is the clip's source span before its trims${shown}, but the file is ${seconds(fileLength)} long. ${WITH_TRIMS_HINT}`
		);
	}
	const endTime = finite(element.endTime);
	const startTime = finite(element.startTime);
	if (endTime === undefined) return element;
	if (
		startTime !== undefined &&
		!timing.keyframed &&
		Math.abs(startTime + spanOnTimeline({ afterTrims, timing }) - endTime) >
			SAME_LENGTH_SECONDS
	) {
		throw new Error(
			`${label}: endTime ${seconds(endTime)} disagrees with duration ${seconds(duration)} and its trims, which end the clip at ${seconds(startTime + spanOnTimeline({ afterTrims, timing }))}`
		);
	}
	return withoutTimelineFields({ element, duration });
}

/** File lengths of the trimmed clips `checkEditorLength` compares, by index. */
async function trimmedClipFileLengths({
	projectId,
	elements,
	settled,
}: {
	projectId: string;
	elements: MediaLengthRequest[];
	settled: Set<number>;
}): Promise<Map<number, number>> {
	const indexes = elements.flatMap((element, index) => {
		if (settled.has(index) || !MEDIA_FAMILY_TYPES.has(String(element.type))) {
			return [];
		}
		const { trimStart, trimEnd } = timingOf(element);
		return (trimStart > 0 || trimEnd > 0) &&
			finite(element.duration) !== undefined
			? [index]
			: [];
	});
	const lengths = new Map<number, number>();
	if (indexes.length === 0) return lengths;
	const files = await listMediaFiles(projectId);
	const fileByIndex = new Map<number, MediaFile>();
	for (const index of indexes) {
		const file = mediaFileFor({ element: elements[index], files });
		if (file && TIMED_FILE_TYPES.has(file.type)) fileByIndex.set(index, file);
	}
	// One probe per distinct file; results are cached by path, size and time.
	const probed = await withMediaProbes([...new Set(fileByIndex.values())]);
	const lengthByPath = new Map(
		probed.map((file) => [file.path, file.duration])
	);
	for (const [index, file] of fileByIndex) {
		const length = lengthByPath.get(file.path);
		if (length !== undefined && length > 0) lengths.set(index, length);
	}
	return lengths;
}

/**
 * Settles the lengths of every media request in an add (one element or a
 * batch): timeline lengths become the editor's `duration`, media without a
 * length takes its file's, and a length that cannot be meant is refused with
 * the reason and both ways to write it. Other element types pass unchanged.
 */
export async function withMediaAddLengths<T extends MediaLengthRequest>({
	projectId,
	elements,
}: {
	projectId: string;
	elements: T[];
}): Promise<T[]> {
	const count = elements.length;
	const labelOf = (element: T, index: number) =>
		clipLabel({ element, index, count });
	const settled = new Set<number>();
	const converted = elements.map((element, index) => {
		if (!MEDIA_FAMILY_TYPES.has(String(element.type))) return element;
		const resolved = fromTimelineLength({
			element,
			label: labelOf(element, index),
		});
		if (!resolved) return element;
		settled.add(index);
		return resolved;
	});
	const timed = await withDefaultMediaDurations({
		projectId,
		elements: converted,
	});
	const fileLengths = await trimmedClipFileLengths({
		projectId,
		elements: timed,
		settled,
	});
	return timed.map((element, index) =>
		settled.has(index) || !MEDIA_FAMILY_TYPES.has(String(element.type))
			? element
			: checkEditorLength({
					element,
					label: labelOf(element, index),
					fileLength: fileLengths.get(index),
				})
	);
}
