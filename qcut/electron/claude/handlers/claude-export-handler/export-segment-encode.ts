/**
 * The FFmpeg command that renders one timeline segment to an intermediate
 * MOV before the segments are joined.
 * @module electron/claude/handlers/claude-export-handler/export-segment-encode
 */

import { buildAtempoChain } from "../../../ffmpeg/segment-transform-filter.js";
import type { ExportSegment, ResolvedExportSettings } from "./types.js";
import { parseBitrateForKbps } from "./utils.js";

/** The sound every intermediate segment and gap carries, so all of them join. */
export interface SegmentAudioFormat {
	sampleRate: number;
	channels: 1 | 2;
}

/** The export's own rate and channels; the concat encodes the sound once at them. */
export function segmentAudioFormat({
	settings,
}: {
	settings: Pick<ResolvedExportSettings, "audioSampleRate" | "audioChannels">;
}): SegmentAudioFormat {
	return {
		sampleRate: settings.audioSampleRate ?? 48_000,
		channels: settings.audioChannels ?? 2,
	};
}

/**
 * Uncompressed sound for an intermediate file. AAC would put an encoder
 * priming frame in front of every segment and pad its end to a whole frame;
 * a stream-copy concat kept both, so each cut moved the clips after it
 * 40–60 ms later. Float PCM has exactly the samples it is given.
 */
export function segmentPcmAudioArgs({
	format,
}: {
	format: SegmentAudioFormat;
}): string[] {
	return [
		"-c:a",
		"pcm_f32le",
		"-ar",
		String(format.sampleRate),
		"-ac",
		String(format.channels),
	];
}

/** An endless silent input in `format`, for a segment with no sound of its own. */
export function silenceInputArgs({
	format,
}: {
	format: SegmentAudioFormat;
}): string[] {
	const layout = format.channels === 1 ? "mono" : "stereo";
	return ["-f", "lavfi", "-i", `anullsrc=r=${format.sampleRate}:cl=${layout}`];
}

/**
 * Build ffmpeg input args for one export segment. Seeks to the segment's
 * source in-point (trimStart) before decoding so trimmed clips start at the
 * right place instead of source time 0.
 */
export function buildExportSegmentInputArgs({
	segment,
}: {
	segment: ExportSegment;
}): string[] {
	if (segment.isImage) {
		return [
			"-loop",
			"1",
			"-t",
			String(segment.duration),
			"-i",
			segment.sourcePath,
		];
	}
	const seekArgs =
		segment.trimStart > 0 ? ["-ss", String(segment.trimStart)] : [];
	// duration is timeline seconds; a sped-up segment consumes rate× as much
	// of the source before setpts compresses it back to the timeline length.
	// `-t` before `-i` bounds what is read; the output is cut to the
	// timeline length by the encode command.
	const sourceReadDuration = segment.duration * (segment.playbackRate ?? 1);
	return [
		...seekArgs,
		"-t",
		String(sourceReadDuration),
		"-i",
		segment.sourcePath,
	];
}

/** Where a segment's sound is read; null means the segment gets silence. */
export type ExportSegmentAudio =
	| { kind: "input" }
	| { kind: "separate"; inputArgs: string[] }
	| null;

/**
 * Remembers, per file, whether it has an audio stream, so a project that
 * cuts one source into many clips probes it once.
 */
export function createAudioStreamProbe({
	probe,
}: {
	probe: ({ mediaPath }: { mediaPath: string }) => Promise<boolean>;
}) {
	const known = new Map<string, Promise<boolean>>();
	return ({ mediaPath }: { mediaPath: string }) => {
		let result = known.get(mediaPath);
		if (!result) {
			result = probe({ mediaPath });
			known.set(mediaPath, result);
		}
		return result;
	};
}

/**
 * The sound of `segment`: its own input's audio, the clip's original file
 * when the picture was replaced (`soundSource`), or silence for a picture
 * or a file without an audio stream.
 */
export async function resolveExportSegmentAudio({
	segment,
	hasAudioStream,
}: {
	segment: ExportSegment;
	hasAudioStream: ({ mediaPath }: { mediaPath: string }) => Promise<boolean>;
}): Promise<ExportSegmentAudio> {
	if (segment.isImage) return null;
	const sound = segment.soundSource;
	if (!sound)
		return (await hasAudioStream({ mediaPath: segment.sourcePath }))
			? { kind: "input" }
			: null;
	if (!(await hasAudioStream({ mediaPath: sound.path }))) return null;
	return {
		kind: "separate",
		inputArgs: buildExportSegmentInputArgs({
			segment: {
				...segment,
				sourcePath: sound.path,
				trimStart: sound.trimStart,
			},
		}),
	};
}

/**
 * Both streams are padded without end (the last frame is cloned, the sound
 * gets silence) and the output `-t` alone cuts the segment to exactly its
 * length, so a source shorter than the segment fills it too. There is no
 * `-shortest`: FFmpeg's sync queue then trims every other stream to the
 * first stream that ends, which dropped the last picture frame of clips
 * whose sound ended a little early.
 *
 * Every segment has sound, the source's or silence (a picture, a clip
 * without an audio stream), in one format: the concat takes its streams
 * from the first file and lays each file's samples straight after the
 * previous file's, so a segment without sound, or with sound in another
 * rate, would move every clip after it.
 */
export function buildExportSegmentEncodeArgs({
	inputArgs,
	scaleFilter,
	segment,
	settings,
	audio,
	outputPath,
}: {
	inputArgs: string[];
	scaleFilter: string;
	segment: ExportSegment;
	settings: Pick<
		ResolvedExportSettings,
		"fps" | "codec" | "bitrate" | "audioSampleRate" | "audioChannels"
	>;
	/**
	 * Where the segment's sound comes from: the video input itself, a
	 * separate input (its arguments; a neural-interpolated picture has no
	 * sound), or nothing, which gives silence.
	 */
	audio: ExportSegmentAudio;
	/** An intermediate MOV: the sound is PCM, which MP4 cannot hold. */
	outputPath: string;
}): string[] {
	const format = segmentAudioFormat({ settings });
	const atempo =
		segment.isImage || audio === null
			? null
			: buildAtempoChain({ rate: segment.playbackRate ?? 1 });
	const audioInputArgs =
		audio === null
			? silenceInputArgs({ format })
			: audio.kind === "separate"
				? audio.inputArgs
				: [];
	const audioStream = audio?.kind === "input" ? "0:a:0" : "1:a:0";
	return [
		"-y",
		...inputArgs,
		...audioInputArgs,
		"-map",
		"0:v:0",
		"-map",
		audioStream,
		"-vf",
		`${scaleFilter},tpad=stop_mode=clone:stop=-1`,
		"-r",
		String(settings.fps),
		"-c:v",
		settings.codec,
		"-preset",
		"medium",
		"-b:v",
		parseBitrateForKbps({ bitrate: settings.bitrate }),
		"-pix_fmt",
		"yuv420p",
		"-af",
		[
			// Sound that starts late in its file, or skips, is filled with
			// silence by its timestamps, so the PCM runs sample for sample
			// with the picture from the segment's first frame.
			"aresample=async=1:first_pts=0",
			...(atempo === null ? [] : [atempo]),
			"apad",
		].join(","),
		...segmentPcmAudioArgs({ format }),
		"-t",
		String(segment.duration),
		outputPath,
	];
}
