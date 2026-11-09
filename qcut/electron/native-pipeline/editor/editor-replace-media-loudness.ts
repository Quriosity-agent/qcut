/**
 * `replace-media --match-loudness`: the clip plays its new file as loud as
 * it played the old one. Each file is measured over the stretch the clip
 * reads (from its in-point, its timeline length times its speed) with
 * FFmpeg's EBU R 128 meter, and the difference goes into the clip's gain:
 * `audio.volumeDb` and every volumeDb keyframe, so a level curve keeps its
 * shape. The editor holds a clip's gain within -60..12 dB.
 *
 * @module electron/native-pipeline/editor/editor-replace-media-loudness
 */

import { runAudioMeasurementProcess } from "../../ffmpeg/audio-measurement-process.js";
import { parseEbur128Report } from "../../ffmpeg/ebur128-report.js";
import { getFFmpegPath, probeHasAudioStream } from "../../ffmpeg/utils.js";
import type { ClaudeElement } from "../../types/claude-api.js";

const CLIP_GAIN_MIN_DB = -60;
const CLIP_GAIN_MAX_DB = 12;
/** R 128's absolute gate: a reading at or below it is silence. */
const SILENCE_LUFS = -70;
const MEASURE_TIMEOUT_MS = 10 * 60_000;

/** A stretch of a file, in seconds. */
export interface SourceStretch {
	path: string;
	start: number;
	duration: number;
}

/** A volumeDb keyframe as the editor keeps it. */
interface VolumeKeyframe {
	frame: number;
	value: number;
	[field: string]: unknown;
}

/** The change to send with the swap, and what it did to the gain. */
export interface ClipGainChange {
	audio: { volumeDb: number; keyframes?: { volumeDb: VolumeKeyframe[] } };
	/** dB the gain moved; less than the difference when the range cut it off. */
	appliedDb: number;
	/** The -60..12 dB range cut the gain or a keyframe off. */
	clamped: boolean;
}

function readAudioRecord({
	clip,
}: {
	clip: ClaudeElement;
}): Record<string, unknown> | undefined {
	const audio = clip.audio;
	return typeof audio === "object" && audio !== null && !Array.isArray(audio)
		? (audio as Record<string, unknown>)
		: undefined;
}

/**
 * Seconds of source the clip reads: its timeline length times a constant
 * speed. A speed curve counts as 1×, as the native export plays it.
 */
export function clipSourceSeconds({ clip }: { clip: ClaudeElement }): number {
	const timelineSeconds =
		typeof clip.timelineDuration === "number" && clip.timelineDuration > 0
			? clip.timelineDuration
			: clip.endTime - clip.startTime;
	const hasConstantSpeed =
		typeof clip.playbackRate === "number" &&
		Number.isFinite(clip.playbackRate) &&
		clip.playbackRate > 0 &&
		(clip.speedKeyframes?.length ?? 0) === 0;
	return (
		timelineSeconds * (hasConstantSpeed ? (clip.playbackRate as number) : 1)
	);
}

/**
 * The clip's gain in dB: `audio.volumeDb`, else the legacy linear `volume`,
 * else 0 dB, the precedence the export applies.
 */
export function clipGainDb({ clip }: { clip: ClaudeElement }): number {
	const volumeDb = readAudioRecord({ clip })?.volumeDb;
	if (typeof volumeDb === "number" && Number.isFinite(volumeDb)) {
		return volumeDb;
	}
	if (typeof clip.volume === "number" && Number.isFinite(clip.volume)) {
		return clip.volume > 0
			? Math.max(CLIP_GAIN_MIN_DB, 20 * Math.log10(clip.volume))
			: CLIP_GAIN_MIN_DB;
	}
	return 0;
}

function readVolumeKeyframes({
	clip,
}: {
	clip: ClaudeElement;
}): VolumeKeyframe[] | undefined {
	const keyframes = readAudioRecord({ clip })?.keyframes;
	if (typeof keyframes !== "object" || keyframes === null) return;
	const volume = (keyframes as Record<string, unknown>).volumeDb;
	if (!Array.isArray(volume) || volume.length === 0) return;
	return volume.filter(
		(keyframe): keyframe is VolumeKeyframe =>
			typeof keyframe === "object" &&
			keyframe !== null &&
			typeof (keyframe as VolumeKeyframe).value === "number"
	);
}

/** Gains in tenths of a dB, as the meter reads loudness. */
function roundGain(db: number): number {
	return Math.round(db * 10) / 10;
}

function clampGain(db: number): number {
	return Math.min(CLIP_GAIN_MAX_DB, Math.max(CLIP_GAIN_MIN_DB, db));
}

/** The clip's gain moved by `differenceDb`, its volume curve with it. */
export function matchedClipGain({
	clip,
	differenceDb,
}: {
	clip: ClaudeElement;
	differenceDb: number;
}): ClipGainChange {
	const before = clipGainDb({ clip });
	const wanted = roundGain(before + differenceDb);
	const volumeDb = roundGain(clampGain(wanted));
	const currentKeyframes = readVolumeKeyframes({ clip });
	const keyframes = currentKeyframes?.map((keyframe) => ({
		...keyframe,
		value: roundGain(clampGain(keyframe.value + differenceDb)),
	}));
	const keyframeClamped = (currentKeyframes ?? []).some(
		(keyframe) =>
			clampGain(keyframe.value + differenceDb) !== keyframe.value + differenceDb
	);
	return {
		audio: {
			volumeDb,
			...(keyframes ? { keyframes: { volumeDb: keyframes } } : {}),
		},
		appliedDb: roundGain(volumeDb - before),
		clamped: volumeDb !== wanted || keyframeClamped,
	};
}

/**
 * Integrated loudness of the stretch in LUFS; null when the file has no
 * sound there (no audio stream, or nothing above R 128's gate).
 */
export async function measureStretchLoudness({
	stretch,
}: {
	stretch: SourceStretch;
}): Promise<number | null> {
	if (!(await probeHasAudioStream({ mediaPath: stretch.path }))) return null;
	const { stderr } = await runAudioMeasurementProcess({
		command: getFFmpegPath(),
		args: [
			"-hide_banner",
			"-nostdin",
			"-nostats",
			"-v",
			"info",
			"-ss",
			String(stretch.start),
			"-t",
			String(stretch.duration),
			"-i",
			stretch.path,
			"-map",
			"0:a:0",
			"-vn",
			"-af",
			"ebur128=peak=true:framelog=quiet",
			"-f",
			"null",
			"-",
		],
		timeout: MEASURE_TIMEOUT_MS,
	});
	const { integratedLufs } = parseEbur128Report({ stderr });
	return Number.isFinite(integratedLufs) && integratedLufs > SILENCE_LUFS
		? integratedLufs
		: null;
}
