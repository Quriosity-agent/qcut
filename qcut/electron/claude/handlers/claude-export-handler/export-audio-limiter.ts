import { promises as fs } from "node:fs";
import path from "node:path";
import { runAudioMeasurementProcess } from "../../../ffmpeg/audio-measurement-process.js";
import { measureFileTruePeakBlocks } from "../../../ffmpeg/audio-true-peak.js";
import { getFFmpegPath } from "../../../ffmpeg/utils.js";
import type { ExportAudioValidation } from "../../../types/export-audio-validation.js";
import {
	applyPeakDips,
	type PeakDip,
	planPeakDips,
	summarizePeakDips,
} from "./export-audio-peak-dips.js";

const OVERSAMPLE_FACTOR = 4;
const HEADROOM_DB = 0.3;
const METER_ROUNDING_DB = 0.050001;
const MAX_ENCODE_ATTEMPTS = 6;
const PROCESS_TIMEOUT_MS = 30 * 60_000;
/**
 * Encoding again moves a block's true peak by up to a dB (by 0.5 dB or less
 * for 99 in 100 loud blocks of a trailer mix), so a correction takes every
 * block within the guard of the ceiling down to the target below it, where
 * the next encode is unlikely to push it back over.
 */
const CORRECTION_GUARD_DB = 0.75;
const CORRECTION_TARGET_DB = 1.25;
/** Each correction after the first takes blocks over the ceiling this much further again. */
const REPEAT_CORRECTION_DB = 0.5;
/** A corrected block's dip spans one AAC or MP3 window (2 × 1152 samples) either side. */
const CODEC_WINDOW_SAMPLES = 2304;

export interface TruePeakLimitedExportOptions {
	sourceAudioPath: string;
	sourceVideoPath?: string;
	outputPath: string;
	tempDir: string;
	duration: number;
	limiter: { ceilingDb: number; releaseMs: number };
	sampleRate: number;
	channels: 1 | 2;
	bitrateKbps: number;
	format: string;
	signal?: AbortSignal;
	onPublished?: () => void;
}

function validateOptions({
	options,
}: {
	options: TruePeakLimitedExportOptions;
}) {
	const { format, duration, limiter, sampleRate, channels, bitrateKbps } =
		options;
	if (!["mp4", "mov", "mp3"].includes(format)) {
		throw new Error(`True-peak limited export does not support ${format}`);
	}
	if (format !== "mp3" && !options.sourceVideoPath) {
		throw new Error("True-peak limited video export requires a video source");
	}
	if (
		path.resolve(options.sourceAudioPath) === path.resolve(options.outputPath)
	) {
		throw new Error("True-peak export must preserve its lossless source");
	}
	if (!Number.isFinite(duration) || duration <= 0) {
		throw new Error("True-peak limited export requires a positive duration");
	}
	if (
		!Number.isFinite(limiter.ceilingDb) ||
		limiter.ceilingDb < -60 ||
		limiter.ceilingDb > 0 ||
		!Number.isFinite(limiter.releaseMs)
	) {
		throw new Error("Invalid master limiter settings for true-peak export");
	}
	if (
		!Number.isInteger(sampleRate) ||
		sampleRate < 8000 ||
		sampleRate > 96_000 ||
		![1, 2].includes(channels) ||
		!Number.isFinite(bitrateKbps) ||
		bitrateKbps <= 0
	) {
		throw new Error("Invalid encoding settings for true-peak export");
	}
}

async function run({ args, signal }: { args: string[]; signal?: AbortSignal }) {
	await runAudioMeasurementProcess({
		command: getFFmpegPath(),
		args: [
			"-hide_banner",
			"-nostdin",
			"-nostats",
			"-v",
			"error",
			"-y",
			...args,
		],
		signal,
		timeout: PROCESS_TIMEOUT_MS,
	});
	signal?.throwIfAborted();
}

function limitingFilter({
	options,
}: {
	options: TruePeakLimitedExportOptions;
}) {
	const { sampleRate, channels, limiter, duration } = options;
	const targetDb = limiter.ceilingDb - HEADROOM_DB;
	const minimumLimitDb = 20 * Math.log10(0.0625);
	const filterLimitDb = Math.max(targetDb, minimumLimitDb);
	const limit = 10 ** (filterLimitDb / 20);
	const release = Math.max(1, Math.min(8000, limiter.releaseMs));
	return [
		`aresample=${sampleRate}`,
		`aformat=sample_fmts=fltp:channel_layouts=${channels === 1 ? "mono" : "stereo"}`,
		`aresample=${sampleRate * OVERSAMPLE_FACTOR}`,
		// Match pre/post gain below alimiter's -24.08 dB minimum to keep quiet audio intact.
		`volume=${filterLimitDb - targetDb}dB:precision=double`,
		`alimiter=limit=${limit}:attack=3:release=${release}:level=0:latency=1`,
		`aresample=${sampleRate}`,
		`volume=${targetDb - filterLimitDb}dB:precision=double`,
		"apad",
		`atrim=duration=${duration}`,
		"asetpts=N/SR/TB",
	].join(",");
}

/**
 * The limited mix is headerless float PCM, so a correction can rewrite the
 * samples of a moment in place.
 */
function rawPcmFormat({
	sampleRate,
	channels,
}: {
	sampleRate: number;
	channels: 1 | 2;
}): string[] {
	return ["-f", "f32le", "-ar", String(sampleRate), "-ac", String(channels)];
}

function encodingArgs({
	options,
	limitedAudioPath,
	candidatePath,
}: {
	options: TruePeakLimitedExportOptions;
	limitedAudioPath: string;
	candidatePath: string;
}): string[] {
	const {
		format,
		sourceVideoPath,
		sampleRate,
		channels,
		bitrateKbps,
		duration,
	} = options;
	const isAudioOnly = format === "mp3";
	return [
		...(isAudioOnly ? [] : ["-i", sourceVideoPath as string]),
		...rawPcmFormat({ sampleRate, channels }),
		"-i",
		limitedAudioPath,
		...(isAudioOnly ? ["-vn"] : ["-map", "0:v:0", "-c:v", "copy"]),
		"-map",
		`${isAudioOnly ? 0 : 1}:a:0`,
		"-c:a",
		isAudioOnly ? "libmp3lame" : "aac",
		"-b:a",
		`${bitrateKbps}k`,
		"-ar",
		String(sampleRate),
		"-ac",
		String(channels),
		"-t",
		String(duration),
		...(isAudioOnly ? [] : ["-movflags", "+faststart"]),
		"-f",
		format,
		candidatePath,
	];
}

/**
 * Publish only a measured candidate. Where an encode goes over the ceiling,
 * the moments at and near it are lowered in the lossless mix and it is
 * encoded again; the rest of the mix keeps its level, so a small change to
 * the mix cannot move the level of the whole export.
 */
export async function renderTruePeakLimitedExport({
	sourceAudioPath,
	sourceVideoPath,
	outputPath,
	tempDir,
	duration,
	limiter,
	sampleRate,
	channels,
	bitrateKbps,
	format,
	signal,
	onPublished,
}: TruePeakLimitedExportOptions): Promise<{
	audioValidation: ExportAudioValidation;
}> {
	const options = {
		sourceAudioPath,
		sourceVideoPath,
		outputPath,
		tempDir,
		duration,
		limiter,
		sampleRate,
		channels,
		bitrateKbps,
		format,
		signal,
	};
	signal?.throwIfAborted();
	validateOptions({ options });
	let audioWorkDir = "";
	let candidateDir = "";
	try {
		audioWorkDir = await fs.mkdtemp(path.join(tempDir, "true-peak-pcm-"));
		await fs.mkdir(path.dirname(outputPath), { recursive: true });
		// The candidate is on the destination volume, so publishing is one rename.
		candidateDir = await fs.mkdtemp(
			path.join(path.dirname(outputPath), ".qcut-true-peak-")
		);
		signal?.throwIfAborted();
		const limitedAudioPath = path.join(audioWorkDir, "limited.f32");
		const candidatePath = path.join(candidateDir, `encoded.${options.format}`);
		await run({
			args: [
				"-i",
				options.sourceAudioPath,
				"-map",
				"0:a:0",
				"-vn",
				"-af",
				limitingFilter({ options }),
				"-c:a",
				"pcm_f32le",
				"-f",
				"f32le",
				limitedAudioPath,
			],
			signal,
		});

		const dips: PeakDip[] = [];
		const encodeCandidate = async ({
			attempt,
		}: {
			attempt: number;
		}): Promise<ExportAudioValidation> => {
			await run({
				args: encodingArgs({ options, limitedAudioPath, candidatePath }),
				signal,
			});
			const { truePeak: peak, blocks } = await measureFileTruePeakBlocks({
				file: candidatePath,
				aboveDb: limiter.ceilingDb - CORRECTION_GUARD_DB,
				signal,
			});
			signal?.throwIfAborted();
			if (peak === null || (peak !== -Infinity && !Number.isFinite(peak))) {
				throw new Error(
					"True-peak limited export has no measurable audio stream"
				);
			}
			// A rounded reading at the ceiling can conceal 0.05 dB of overshoot.
			const overDb = limiter.ceilingDb - METER_ROUNDING_DB;
			if (peak <= overDb) {
				return {
					status: "passed",
					ceilingDbtp: limiter.ceilingDb,
					truePeakDbtp: Number.isFinite(peak) ? peak : null,
					limiting: {
						oversampleFactor: OVERSAMPLE_FACTOR,
						encodeAttempts: attempt,
						...summarizePeakDips({ dips, duration }),
					},
				};
			}
			if (attempt >= MAX_ENCODE_ATTEMPTS) {
				throw new Error(
					`True-peak limited export still measures ${peak.toFixed(1)} dBTP above the safe ceiling after ${attempt} encodes`
				);
			}
			const correction = planPeakDips({
				blocks,
				targetDb: limiter.ceilingDb - CORRECTION_TARGET_DB,
				overDb,
				extraDb: REPEAT_CORRECTION_DB * (attempt - 1),
				padSeconds: CODEC_WINDOW_SAMPLES / sampleRate,
			});
			await applyPeakDips({
				file: limitedAudioPath,
				dips: correction,
				sampleRate,
				channels,
			});
			dips.push(...correction);
			return encodeCandidate({ attempt: attempt + 1 });
		};

		const audioValidation = await encodeCandidate({ attempt: 1 });
		signal?.throwIfAborted();
		await fs.rename(candidatePath, outputPath);
		onPublished?.();
		signal?.throwIfAborted();
		return { audioValidation };
	} finally {
		await Promise.all(
			[audioWorkDir, candidateDir]
				.filter(Boolean)
				.map((directory) => fs.rm(directory, { recursive: true, force: true }))
		);
	}
}
