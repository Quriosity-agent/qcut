/**
 * Part of the timeline, for `export start --start-time/--end-time` and
 * `mix loudness` over a stretch, and how a range export renders it.
 *
 * @module electron/claude/handlers/claude-export-handler/export-range
 */

import * as path from "node:path";
import type { VideoTransition } from "../../../ffmpeg/types.js";
import type { ClaudeTimeRange } from "../../../types/claude-api.js";
import type { AdjustmentLayer } from "./adjustment-layer-pass.js";
import type {
	ExportSegment,
	JianyingTextOverlay,
	ResolvedExportSettings,
	StickerOverlay,
	TextOverlay,
} from "./types.js";
import { parseBitrateForKbps } from "./utils.js";

/** A resolved range on the timeline, in seconds. */
export interface TimelineRange {
	start: number;
	end: number;
}

function formatSeconds(seconds: number): string {
	return `${Number(seconds.toFixed(3))} s`;
}

function snapToFrame({ seconds, fps }: { seconds: number; fps?: number }) {
	if (!fps || !Number.isFinite(fps) || fps <= 0) return seconds;
	return Math.round(seconds * fps) / fps;
}

/**
 * The range on a timeline `duration` seconds long: a missing start is 0, a
 * missing end the timeline's end, and with `fps` both land on the nearest
 * frame. A range outside the timeline, or shorter than a frame, is refused
 * rather than cut to fit.
 */
export function resolveTimelineRange({
	range,
	duration,
	fps,
}: {
	range: ClaudeTimeRange;
	duration: number;
	fps?: number;
}): TimelineRange {
	if (!Number.isFinite(duration) || duration <= 0) {
		throw new Error(
			"The timeline's length is not known, so no range of it can be taken"
		);
	}
	const requestedStart = range.startTime ?? 0;
	const requestedEnd = range.endTime ?? duration;
	if (!Number.isFinite(requestedStart) || requestedStart < 0) {
		throw new Error("The range start must be a number of seconds, 0 or more");
	}
	if (!Number.isFinite(requestedEnd)) {
		throw new Error("The range end must be a number of seconds");
	}
	const start = snapToFrame({ seconds: requestedStart, fps });
	const end = snapToFrame({ seconds: requestedEnd, fps });
	const halfFrame = fps && fps > 0 ? 0.5 / fps : 0;
	if (start >= duration) {
		throw new Error(
			`The range starts at ${formatSeconds(requestedStart)}, at or after the end of the timeline (${formatSeconds(duration)})`
		);
	}
	if (end > duration + halfFrame) {
		throw new Error(
			`The range ends at ${formatSeconds(requestedEnd)}, after the end of the timeline (${formatSeconds(duration)}); leave the end out to run to it`
		);
	}
	if (end <= start) {
		throw new Error(
			`The range ${formatSeconds(requestedStart)}–${formatSeconds(requestedEnd)} is empty${fps ? " at the export's frame rate" : ""}`
		);
	}
	return { start, end: Math.min(end, duration) };
}

/**
 * A range export is the full export cut to the range. The pipeline keeps the
 * whole timeline's timing, so every overlay, transition and the mix land
 * where they do in a full export; only work that cannot reach the range is
 * left out:
 * - a clip whose picture cannot show in the range is encoded as black frames
 *   with its real sound (`segmentsShowingInRange`), because the mix needs
 *   all of it: a limiter, a reverb tail or a fade reaching into the range
 *   depends on what plays before it;
 * - overlays and layers outside the range are dropped (`layersShowingInRange`);
 * - after the picture passes the picture is cut to the range
 *   (`buildRangePictureArgs`), and the mix is cut from the same full-length
 *   mix a full export makes (export-audio-mix-pass.ts, export-audio-limiter.ts).
 */

/** Whether `[start, end)` and the range share any time. */
function overlapsRange({
	start,
	end,
	range,
}: {
	start: number;
	end: number;
	range: TimelineRange;
}): boolean {
	return start < range.end && end > range.start;
}

/**
 * Positions (in `segments`) of the clips whose picture can show in the
 * range: those that overlap it, and both clips of a transition reaching
 * into it (a transition is taken to span its length either side of the cut).
 */
export function segmentsShowingInRange({
	segments,
	transitions,
	range,
}: {
	segments: Pick<ExportSegment, "elementId" | "startTime" | "duration">[];
	transitions: Pick<
		VideoTransition,
		"fromElementId" | "toElementId" | "duration"
	>[];
	range: TimelineRange;
}): Set<number> {
	const shown = new Set<number>();
	for (const [index, segment] of segments.entries()) {
		const end = segment.startTime + segment.duration;
		if (overlapsRange({ start: segment.startTime, end, range })) {
			shown.add(index);
		}
	}
	const indexOf = (elementId: string) =>
		segments.findIndex((segment) => segment.elementId === elementId);
	for (const transition of transitions) {
		const from = indexOf(transition.fromElementId);
		const to = indexOf(transition.toElementId);
		if (from < 0 || to < 0) continue;
		const cut = segments[from].startTime + segments[from].duration;
		const reachesRange = overlapsRange({
			start: cut - transition.duration,
			end: cut + transition.duration,
			range,
		});
		if (reachesRange) {
			shown.add(from);
			shown.add(to);
		}
	}
	return shown;
}

/** The layers drawn over the joined picture that show in the range. */
export interface PictureLayers {
	mediaOverlays: ExportSegment[];
	stickerOverlays: StickerOverlay[];
	textOverlays: TextOverlay[];
	jianyingTextOverlays: JianyingTextOverlay[];
	adjustmentLayers: AdjustmentLayer[];
}

function spanOf(item: { startTime: number; endTime: number }) {
	return { start: item.startTime, end: item.endTime };
}

/** `layers` without those that start after the range or end before it. */
export function layersShowingInRange({
	layers,
	range,
}: {
	layers: PictureLayers;
	range: TimelineRange;
}): PictureLayers {
	const timed = <T extends { startTime: number; endTime: number }>(
		items: T[]
	) => items.filter((item) => overlapsRange({ ...spanOf(item), range }));
	return {
		mediaOverlays: layers.mediaOverlays.filter((overlay) =>
			overlapsRange({
				start: overlay.startTime,
				end: overlay.startTime + overlay.duration,
				range,
			})
		),
		stickerOverlays: timed(layers.stickerOverlays),
		textOverlays: timed(layers.textOverlays),
		jianyingTextOverlays: timed(layers.jianyingTextOverlays),
		adjustmentLayers: timed(layers.adjustmentLayers),
	};
}

/** Frames the range holds at `fps`. */
export function rangeFrameCount({
	range,
	fps,
}: {
	range: TimelineRange;
	fps: number;
}): number {
	return Math.max(1, Math.round((range.end - range.start) * fps));
}

/**
 * Cuts the finished picture to the range: the frame at `range.start` first
 * (the seek lands a quarter frame early so rounding cannot skip it), as many
 * frames as the range holds, encoded as every pass is. The input seek alone
 * moves the clock to 0 and the constant-rate output snaps the quarter frame
 * away. No `setpts=PTS-STARTPTS`: where two clips' colour tags differ,
 * FFmpeg rebuilds its filter graph at the cut between them, that filter
 * starts counting again from the first frame after it, and the frames at
 * the cut are dropped and others doubled to make the clock fit.
 */
export function buildRangePictureArgs({
	inputPath,
	outputPath,
	range,
	settings,
}: {
	inputPath: string;
	outputPath: string;
	range: TimelineRange;
	settings: Pick<ResolvedExportSettings, "fps" | "codec" | "bitrate">;
}): string[] {
	const seekSeconds = Math.max(0, range.start - 0.25 / settings.fps);
	return [
		"-y",
		...(seekSeconds > 0 ? ["-ss", String(seekSeconds)] : []),
		"-i",
		inputPath,
		"-map",
		"0:v:0",
		"-an",
		"-r",
		String(settings.fps),
		"-frames:v",
		String(rangeFrameCount({ range, fps: settings.fps })),
		"-c:v",
		settings.codec,
		"-preset",
		"medium",
		"-b:v",
		parseBitrateForKbps({ bitrate: settings.bitrate }),
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		outputPath,
	];
}

/** The cut picture of a range export and the range it holds. */
export interface RangeCut {
	picturePath: string;
	range: TimelineRange;
}

/**
 * Cuts the finished full-length picture at `inputPath` to the range, into
 * `tempDir`. A range ending after the picture is cut where the picture
 * ends, as a full export would end there; one starting after it is refused.
 */
export async function cutPictureToRange({
	range,
	pictureEnd,
	inputPath,
	tempDir,
	settings,
	runFFmpegCommand,
	signal,
	onProgress,
}: {
	range: TimelineRange;
	/** Where the full-length picture ends, in seconds. */
	pictureEnd: number;
	inputPath: string;
	tempDir: string;
	settings: Pick<ResolvedExportSettings, "fps" | "codec" | "bitrate">;
	runFFmpegCommand: (options: {
		signal: AbortSignal;
		args: string[];
		estimatedDuration: number;
		onProgress?: (progress: { normalizedProgress: number }) => void;
	}) => Promise<unknown>;
	signal: AbortSignal;
	onProgress?: (progress: { normalizedProgress: number }) => void;
}): Promise<RangeCut> {
	const halfFrame = 0.5 / Math.max(1, settings.fps);
	if (range.start >= pictureEnd - halfFrame) {
		throw new Error(
			`The range starts at ${formatSeconds(range.start)}, but the picture ends at ${formatSeconds(pictureEnd)}`
		);
	}
	const cut = { start: range.start, end: Math.min(range.end, pictureEnd) };
	const picturePath = path.join(tempDir, "range-picture.mp4");
	await runFFmpegCommand({
		signal,
		args: buildRangePictureArgs({
			inputPath,
			outputPath: picturePath,
			range: cut,
			settings,
		}),
		estimatedDuration: cut.end - cut.start,
		onProgress,
	});
	return { picturePath, range: cut };
}

/** The filter that cuts a full-length mix to the range, sample-exactly. */
export function rangeAudioFilter({ range }: { range: TimelineRange }): string {
	return `atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS`;
}

/**
 * A range export without a mix: the range's picture with the sound of the
 * joined clips, cut from the full-length picture's sound and encoded again.
 */
export function buildRangeSoundArgs({
	sourcePath,
	picturePath,
	outputPath,
	range,
	settings,
}: {
	sourcePath: string;
	picturePath: string;
	outputPath: string;
	range: TimelineRange;
	settings: Pick<
		ResolvedExportSettings,
		"audioBitrate" | "audioSampleRate" | "audioChannels"
	>;
}): string[] {
	return [
		"-y",
		"-i",
		sourcePath,
		"-i",
		picturePath,
		"-map",
		"1:v:0",
		"-map",
		"0:a:0",
		"-c:v",
		"copy",
		"-af",
		rangeAudioFilter({ range }),
		"-c:a",
		"aac",
		"-b:a",
		`${settings.audioBitrate ?? 192}k`,
		"-ar",
		String(settings.audioSampleRate ?? 48_000),
		"-ac",
		String(settings.audioChannels ?? 2),
		"-t",
		String(range.end - range.start),
		"-movflags",
		"+faststart",
		outputPath,
	];
}
