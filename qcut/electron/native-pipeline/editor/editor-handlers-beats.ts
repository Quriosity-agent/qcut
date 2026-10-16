/**
 * `editor beats mark` and `editor timeline snap --to beats`: a clip's beats
 * found by the main process (the same engine as `analyze beats`) go into the
 * editor's beat store, where the beat panel and the ruler's markers read
 * them; clips are then moved onto those beats through the editor's own move.
 *
 * @module electron/native-pipeline/editor/editor-handlers-beats
 */
import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import type { EditorApiClient } from "./editor-api-client.js";

const BOOKMARK_CHOICES = ["none", "downbeats", "all"] as const;
const EDGE_CHOICES = ["start", "end", "onset"] as const;
const FRAME_ALIGN_CHOICES = ["visual", "all", "none"] as const;
const MEDIA_ELEMENT_TYPES = new Set(["media", "audio", "video"]);

interface SnapshotElement {
	id: string;
	type: string;
	sourceId?: string;
	mediaId?: string;
	trimStart?: number;
	playbackRate?: number;
}

interface TimelineSnapshot {
	tracks: Array<{ id: string; elements: SnapshotElement[] }>;
}

/** What `--edge onset` found for one clip. */
interface ClipOnset {
	mediaId?: string;
	/** The attack in the media file's own seconds. */
	sourceTime: number | null;
	/** Seconds from the clip's start on the timeline to that attack. */
	offset?: number;
	reason?: string;
}

/** The media id behind a clip, from the timeline the editor has open. */
async function mediaIdOfElement({
	client,
	projectId,
	elementId,
}: {
	client: EditorApiClient;
	projectId: string;
	elementId: string;
}): Promise<string> {
	const timeline = await client.get<TimelineSnapshot>(
		`/api/claude/timeline/${encodeURIComponent(projectId)}`
	);
	for (const track of timeline.tracks) {
		const element = track.elements.find((item) => item.id === elementId);
		if (!element) continue;
		const mediaId = element.sourceId ?? element.mediaId;
		if (
			element.type !== "media" &&
			element.type !== "audio" &&
			element.type !== "video"
		) {
			throw new Error(`Element ${elementId} is not a media clip`);
		}
		if (!mediaId) throw new Error(`Element ${elementId} has no media`);
		return mediaId;
	}
	throw new Error(`Element not found: ${elementId}`);
}

/**
 * For `--edge onset`: each clip's first attack through its trims and speed,
 * found by the main process the way `analyze beats` reads onsets. A clip
 * whose attack is trimmed away, or has none, is reported and left alone.
 */
async function clipOnsets({
	client,
	projectId,
	elementIds,
	threshold,
}: {
	client: EditorApiClient;
	projectId: string;
	elementIds: string[];
	threshold?: number;
}): Promise<Record<string, ClipOnset>> {
	const timeline = await client.get<TimelineSnapshot>(
		`/api/claude/timeline/${encodeURIComponent(projectId)}`
	);
	const elements = timeline.tracks.flatMap((track) => track.elements);
	const onsets: Record<string, ClipOnset> = {};
	for (const elementId of elementIds) {
		const element = elements.find((item) => item.id === elementId);
		if (!element) throw new Error(`Element not found: ${elementId}`);
		const mediaId = element.sourceId ?? element.mediaId;
		if (!MEDIA_ELEMENT_TYPES.has(element.type) || !mediaId) {
			onsets[elementId] = {
				sourceTime: null,
				reason: "not a media clip, so it has no onset",
			};
			continue;
		}
		const found = await client.post<{ time: number | null }>(
			`/api/claude/analyze/${encodeURIComponent(projectId)}/onset`,
			{ mediaId, ...(threshold !== undefined ? { threshold } : {}) },
			{ timeout: 300_000 }
		);
		if (found.time === null) {
			onsets[elementId] = {
				mediaId,
				sourceTime: null,
				reason: "no onset reaches the threshold in the media",
			};
			continue;
		}
		const trimStart = element.trimStart ?? 0;
		const rate =
			typeof element.playbackRate === "number" && element.playbackRate > 0
				? element.playbackRate
				: 1;
		const offset = (found.time - trimStart) / rate;
		if (offset < 0) {
			onsets[elementId] = {
				mediaId,
				sourceTime: found.time,
				reason: "the first onset is trimmed away",
			};
			continue;
		}
		onsets[elementId] = {
			mediaId,
			sourceTime: found.time,
			offset: Math.round(offset * 1000) / 1000,
		};
	}
	return onsets;
}

/** `editor beats mark --element-id <clip> [--bookmarks none|downbeats|all]`. */
export async function beatsMark(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	const elementId = opts.elementId?.trim();
	if (!elementId) return { success: false, error: "Missing --element-id" };
	const bookmarks = opts.bookmarks?.trim() ?? "none";
	if (!BOOKMARK_CHOICES.some((choice) => choice === bookmarks)) {
		return {
			success: false,
			error: `--bookmarks must be one of ${BOOKMARK_CHOICES.join(", ")}`,
		};
	}
	const mediaId =
		opts.mediaId?.trim() ||
		(await mediaIdOfElement({ client, projectId: opts.projectId, elementId }));
	const result = await client.post(
		`/api/claude/analyze/${encodeURIComponent(opts.projectId)}/beats`,
		{ mediaId },
		{ timeout: 300_000 }
	);
	const marked = await client.post(
		`/api/claude/timeline/${encodeURIComponent(opts.projectId)}/beats/mark`,
		{ elementId, result, bookmarks },
		{ timeout: 180_000 }
	);
	return { success: true, data: { mediaId, ...(marked as object) } };
}

/** `editor timeline snap --to beats --element-ids a,b [--beats-from <clip>]`. */
export async function timelineSnap(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	const to = opts.to?.trim() ?? "beats";
	if (to !== "beats") {
		return { success: false, error: "--to must be beats" };
	}
	// --element-ids may be given several times and each value may hold a
	// comma-separated list; the CLI parser keeps every occurrence as is.
	const given: unknown = opts.elementIds;
	const listed = Array.isArray(given)
		? given
		: typeof given === "string"
			? [given]
			: [];
	const elementIds = [
		...listed.flatMap((value) => String(value).split(",")),
		...(opts.elementId ? [opts.elementId] : []),
	]
		.map((id) => id.trim())
		.filter(Boolean);
	if (elementIds.length === 0) {
		return { success: false, error: "Missing --element-ids (or --element-id)" };
	}
	const edge = opts.edge ?? "start";
	if (!EDGE_CHOICES.some((choice) => choice === edge)) {
		return { success: false, error: "--edge must be start, end or onset" };
	}
	if (
		opts.frameAlign !== undefined &&
		!FRAME_ALIGN_CHOICES.some((choice) => choice === opts.frameAlign)
	) {
		return {
			success: false,
			error: "--frame-align must be visual, all or none",
		};
	}
	if (
		opts.onsetThreshold !== undefined &&
		(!Number.isFinite(opts.onsetThreshold) ||
			opts.onsetThreshold <= 0 ||
			opts.onsetThreshold > 1)
	) {
		return {
			success: false,
			error: "--onset-threshold must be above 0 and at most 1",
		};
	}
	if (
		opts.maxDistance !== undefined &&
		(!Number.isFinite(opts.maxDistance) || opts.maxDistance <= 0)
	) {
		return {
			success: false,
			error: "--max-distance must be a positive number of seconds",
		};
	}
	const onsets =
		edge === "onset"
			? await clipOnsets({
					client,
					projectId: opts.projectId,
					elementIds,
					threshold: opts.onsetThreshold,
				})
			: undefined;
	const edgeOffsets = onsets
		? Object.fromEntries(
				Object.entries(onsets).flatMap(([elementId, onset]) =>
					onset.offset === undefined ? [] : [[elementId, onset.offset]]
				)
			)
		: undefined;
	const data = await client.post<Record<string, unknown>>(
		`/api/claude/timeline/${encodeURIComponent(opts.projectId)}/snap-to-beats`,
		{
			elementIds,
			...(opts.beatsFrom ? { beatsElementId: opts.beatsFrom.trim() } : {}),
			...(opts.edge ? { edge: opts.edge } : {}),
			...(edgeOffsets ? { edgeOffsets } : {}),
			...(opts.frameAlign ? { frameAlign: opts.frameAlign } : {}),
			...(opts.maxDistance !== undefined
				? { maxDistance: opts.maxDistance }
				: {}),
			...(opts.downbeatsOnly ? { downbeatsOnly: true } : {}),
			...(opts.dryRun ? { dryRun: true } : {}),
		}
	);
	return { success: true, data: onsets ? { ...data, onsets } : data };
}

export async function handleBeatsCommand(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const action = opts.command.split(":")[2];
	if (action === "mark") return beatsMark(client, opts);
	return {
		success: false,
		error: `Unknown beats action: ${action}. Available: mark`,
	};
}
