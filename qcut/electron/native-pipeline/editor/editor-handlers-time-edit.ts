/**
 * Edits of the timeline's time and the frame grid:
 *
 * - `editor editing insert-gap` opens empty time, the reverse of
 *   `editing delete-range`;
 * - `editor timeline snap --to frames` puts clip edges on whole frames;
 * - `--snap-frames` on the commands that take a time rounds that time to the
 *   project's frames before it is sent.
 *
 * Times are seconds throughout the editor API, and a cut made by time (on a
 * bar line, at 52.425333 s) leaves clips that start and end between frames.
 *
 * @module electron/native-pipeline/editor/editor-handlers-time-edit
 */

import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import type { EditorApiClient } from "./editor-api-client.js";

/** The project's frame rate, as its settings give it. */
export async function projectFrameRate({
	client,
	projectId,
}: {
	client: EditorApiClient;
	projectId: string;
}): Promise<number> {
	const settings = await client.get<{ fps?: unknown }>(
		`/api/claude/project/${encodeURIComponent(projectId)}/settings`
	);
	const fps = settings?.fps;
	if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) {
		throw new Error(
			`Project ${projectId} gave no frame rate to snap to (fps: ${JSON.stringify(fps)})`
		);
	}
	return fps;
}

/** `seconds` on the nearest frame at `fps`. */
export function snapSecondsToFrame({
	seconds,
	fps,
}: {
	seconds: number;
	fps: number;
}): number {
	return Math.round(seconds * fps) / fps;
}

/**
 * The times a command was given, each on its nearest frame when
 * `--snap-frames` is set (the project's rate is read once), else as given.
 * `snapped` reports what was used, for the command's answer.
 */
export async function snapCommandTimes<Name extends string>({
	client,
	opts,
	times,
}: {
	client: EditorApiClient;
	opts: CLIRunOptions;
	times: Record<Name, number | undefined>;
}): Promise<{
	times: Record<Name, number | undefined>;
	snapped?: { fps: number } & Record<string, number>;
}> {
	if (!opts.snapFrames || !opts.projectId) return { times };
	const fps = await projectFrameRate({ client, projectId: opts.projectId });
	const rounded = { ...times };
	const used: Record<string, number> = {};
	for (const name of Object.keys(times) as Name[]) {
		const seconds = times[name];
		if (seconds === undefined || !Number.isFinite(seconds)) continue;
		rounded[name] = snapSecondsToFrame({ seconds, fps });
		used[name] = rounded[name] as number;
	}
	return { times: rounded, snapped: { fps, ...used } };
}

/** Closer to a frame than this (in frames) is float noise, not an offset. */
const ON_FRAME_TOLERANCE = 1e-3;

function isOnFrame({ time, fps }: { time: number; fps: number }): boolean {
	const frames = time * fps;
	return Math.abs(frames - Math.round(frames)) < ON_FRAME_TOLERANCE;
}

/** The clips whose edges sit between frames, as `timeline export` reports them. */
export interface FrameAlignmentSummary {
	fps: number;
	/** Clips with a start or an end between frames. */
	offFrameClips: number;
	/** How many of them are on the main track. */
	mainTrackOffFrameClips: number;
	/** The first of them, in track order (at most 20). */
	elementIds: string[];
}

/**
 * How many clips of an exported timeline start or end between frames, so a
 * script can tell before it exports (`timeline snap --to frames` fixes them).
 * Undefined when the timeline gives no frame rate.
 */
export function summarizeFrameAlignment({
	timeline,
}: {
	timeline: {
		fps?: unknown;
		tracks?: Array<{
			isMain?: boolean;
			elements?: Array<{ id?: string; startTime?: unknown; endTime?: unknown }>;
		}>;
	};
}): FrameAlignmentSummary | undefined {
	const fps = timeline.fps;
	if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) {
		return undefined;
	}
	const elementIds: string[] = [];
	let mainTrackOffFrameClips = 0;
	for (const track of timeline.tracks ?? []) {
		for (const element of track.elements ?? []) {
			const { startTime, endTime } = element;
			if (typeof startTime !== "number" || typeof endTime !== "number") {
				continue;
			}
			if (
				isOnFrame({ time: startTime, fps }) &&
				isOnFrame({ time: endTime, fps })
			) {
				continue;
			}
			elementIds.push(element.id ?? "");
			if (track.isMain) mainTrackOffFrameClips += 1;
		}
	}
	return {
		fps,
		offFrameClips: elementIds.length,
		mainTrackOffFrameClips,
		elementIds: elementIds.slice(0, 20),
	};
}

function readIdList(value: string | string[] | undefined): string[] {
	const given = Array.isArray(value) ? value : value ? [value] : [];
	return given
		.flatMap((entry) => String(entry).split(","))
		.map((id) => id.trim())
		.filter(Boolean);
}

/** `editor editing insert-gap --at <seconds> --duration <seconds>`. */
export async function editingInsertGap(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	// --start-time reads the same, beside delete-range's --start-time/--end-time.
	const at = opts.at ?? opts.startTime;
	if (at === undefined) return { success: false, error: "Missing --at" };
	if (!Number.isFinite(at) || at < 0) {
		return {
			success: false,
			error: "--at must be a number of seconds, 0 or more",
		};
	}
	if (opts.duration === undefined || String(opts.duration).trim() === "") {
		return { success: false, error: "Missing --duration" };
	}
	const duration = Number(opts.duration);
	if (!Number.isFinite(duration) || duration <= 0) {
		return {
			success: false,
			error: `--duration must be a number of seconds above 0 (got "${opts.duration}")`,
		};
	}

	const { times, snapped } = await snapCommandTimes({
		client,
		opts,
		times: { time: at, duration },
	});
	if (snapped && (times.duration ?? 0) <= 0) {
		return {
			success: false,
			error: `--duration ${duration} is less than half a frame at ${snapped.fps} fps, so --snap-frames leaves nothing to insert`,
		};
	}
	const trackIds = readIdList(opts.trackId);
	const data = await client.post<Record<string, unknown>>(
		`/api/claude/timeline/${encodeURIComponent(opts.projectId)}/gap`,
		{
			time: times.time,
			duration: times.duration,
			...(trackIds.length > 0 ? { trackIds } : {}),
			...(opts.keepAutomation ? { keepAutomation: true } : {}),
		}
	);
	return { success: true, data: snapped ? { ...data, snapped } : data };
}

const FRAME_ALIGN_CHOICES = ["visual", "all"];

/** `editor timeline snap --to frames [--track-id a,b] [--element-ids x,y]`. */
export async function timelineSnapToFrames(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	if (
		opts.frameAlign !== undefined &&
		!FRAME_ALIGN_CHOICES.includes(opts.frameAlign)
	) {
		return {
			success: false,
			error: "--frame-align must be visual or all with --to frames",
		};
	}
	const trackIds = readIdList(opts.trackId);
	const elementIds = [
		...readIdList(opts.elementIds as string | string[] | undefined),
		...readIdList(opts.elementId),
	];
	const data = await client.post(
		`/api/claude/timeline/${encodeURIComponent(opts.projectId)}/snap-to-frames`,
		{
			...(trackIds.length > 0 ? { trackIds } : {}),
			...(elementIds.length > 0 ? { elementIds } : {}),
			...(opts.frameAlign ? { frameAlign: opts.frameAlign } : {}),
			...(opts.dryRun ? { dryRun: true } : {}),
		}
	);
	return { success: true, data };
}
