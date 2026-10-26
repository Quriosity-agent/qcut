import { promises as fs } from "node:fs";
import path from "node:path";
import { runAudioMeasurementProcess } from "../../../ffmpeg/audio-measurement-process.js";
import { measureFileTruePeak } from "../../../ffmpeg/audio-true-peak.js";
import { getFFmpegPath } from "../../../ffmpeg/utils.js";
import type { ExportAudioValidation } from "../../../types/export-audio-validation.js";

const OVERSAMPLE_FACTOR = 4;
const HEADROOM_DB = 0.3;
const METER_ROUNDING_DB = 0.050001;
const MAX_ENCODE_ATTEMPTS = 4;
const PROCESS_TIMEOUT_MS = 30 * 60_000;

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

function encodingArgs({
	options,
	limitedAudioPath,
	candidatePath,
	attenuationDb,
}: {
	options: TruePeakLimitedExportOptions;
	limitedAudioPath: string;
	candidatePath: string;
	attenuationDb: number;
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
		"-i",
		limitedAudioPath,
		...(isAudioOnly ? ["-vn"] : ["-map", "0:v:0", "-c:v", "copy"]),
		"-map",
		`${isAudioOnly ? 0 : 1}:a:0`,
		"-af",
		`volume=${-attenuationDb}dB:precision=double`,
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

/** Publish only a measured candidate; every retry reads the same lossless mix. */
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
		const limitedAudioPath = path.join(audioWorkDir, "limited.wav");
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
				"-rf64",
				"auto",
				limitedAudioPath,
			],
			signal,
		});

		const encodeCandidate = async ({
			attempt,
			attenuationDb,
		}: {
			attempt: number;
			attenuationDb: number;
		}): Promise<ExportAudioValidation> => {
			await run({
				args: encodingArgs({
					options,
					limitedAudioPath,
					candidatePath,
					attenuationDb,
				}),
				signal,
			});
			const peak = await measureFileTruePeak({ file: candidatePath, signal });
			signal?.throwIfAborted();
			if (peak === null || (peak !== -Infinity && !Number.isFinite(peak))) {
				throw new Error(
					"True-peak limited export has no measurable audio stream"
				);
			}
			// A rounded reading at the ceiling can conceal 0.05 dB of overshoot.
			if (peak + METER_ROUNDING_DB <= limiter.ceilingDb) {
				return {
					status: "passed",
					ceilingDbtp: limiter.ceilingDb,
					truePeakDbtp: Number.isFinite(peak) ? peak : null,
					limiting: {
						oversampleFactor: OVERSAMPLE_FACTOR,
						encodeAttempts: attempt,
						attenuationDb,
					},
				};
			}
			if (attempt >= MAX_ENCODE_ATTEMPTS) {
				throw new Error(
					`True-peak limited export still measures ${peak.toFixed(1)} dBTP above the safe ceiling after ${attempt} encodes`
				);
			}
			return encodeCandidate({
				attempt: attempt + 1,
				attenuationDb: attenuationDb + peak - limiter.ceilingDb + HEADROOM_DB,
			});
		};

		const audioValidation = await encodeCandidate({
			attempt: 1,
			attenuationDb: 0,
		});
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
