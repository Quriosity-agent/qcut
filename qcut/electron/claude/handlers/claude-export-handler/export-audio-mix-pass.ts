import * as fs from "node:fs/promises";
import path from "node:path";
import { buildTimelineAudioFilters } from "../../../ffmpeg/audio-filter-graph.js";
import type { AudioFile, AudioMixConfig } from "../../../ffmpeg/types.js";
import { probeHasAudioStream } from "../../../ffmpeg/utils.js";
import type { ExportAudioValidation } from "../../../types/export-audio-validation.js";
import { renderTruePeakLimitedExport } from "./export-audio-limiter.js";
import { embeddedAudioMixInput } from "./export-audio-mix.js";
import { throwIfCancelled } from "./export-cancel.js";
import { moveFile } from "./move-file.js";
import type { ExportSegment, ResolvedExportSettings } from "./types.js";

interface AudioMixCommandOptions {
	args: string[];
	estimatedDuration: number;
	signal?: AbortSignal;
}

async function publishVideoWithoutAudio({
	sourcePath,
	outputPath,
	format,
	duration,
	runFFmpegCommand,
	signal,
	onPublished,
}: {
	sourcePath: string;
	outputPath: string;
	format: string;
	duration: number;
	runFFmpegCommand: (options: AudioMixCommandOptions) => Promise<void>;
	signal?: AbortSignal;
	onPublished?: () => void;
}): Promise<void> {
	throwIfCancelled(signal);
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	const candidateDir = await fs.mkdtemp(
		path.join(path.dirname(outputPath), ".qcut-video-only-")
	);
	try {
		const candidatePath = path.join(candidateDir, `video.${format}`);
		await runFFmpegCommand({
			signal,
			estimatedDuration: duration,
			args: [
				"-y",
				"-i",
				sourcePath,
				"-map",
				"0:v:0",
				"-an",
				"-c:v",
				"copy",
				"-movflags",
				"+faststart",
				"-f",
				format,
				candidatePath,
			],
		});
		throwIfCancelled(signal);
		// The candidate is already on the destination disk; a failed copy cannot touch the old export.
		await fs.rename(candidatePath, outputPath);
		onPublished?.();
		throwIfCancelled(signal);
	} finally {
		await fs.rm(candidateDir, { recursive: true, force: true });
	}
}

function deferMasterLimiter({
	config,
}: {
	config: AudioMixConfig;
}): AudioMixConfig {
	return {
		...config,
		master: {
			...config.master,
			effects: {
				...config.master.effects,
				limiter: { ...config.master.effects.limiter, enabled: false },
			},
		},
	};
}

export async function renderTimelineAudioMix({
	videoOutputPath,
	outputPath,
	tempDir,
	settings,
	segments,
	audioFiles,
	audioMixConfig,
	duration,
	runFFmpegCommand,
	signal,
	onPublished,
}: {
	videoOutputPath: string;
	outputPath: string;
	tempDir: string;
	settings: ResolvedExportSettings;
	segments: ExportSegment[];
	audioFiles: AudioFile[];
	duration: number;
	runFFmpegCommand: (options: AudioMixCommandOptions) => Promise<void>;
	audioMixConfig?: AudioMixConfig;
	signal?: AbortSignal;
	onPublished?: () => void;
}): Promise<{ finalized: boolean; audioValidation?: ExportAudioValidation }> {
	throwIfCancelled(signal);
	const limiter = audioMixConfig?.master.effects.limiter;
	const enforceTruePeak =
		limiter?.enabled === true && settings.format !== "gif";
	if (enforceTruePeak && !Number.isFinite(limiter.ceilingDb)) {
		throw new Error("The master limiter ceiling is not finite");
	}
	if (enforceTruePeak && !["mp4", "mov", "mp3"].includes(settings.format)) {
		throw new Error(
			`True-peak limited export does not support ${settings.format}`
		);
	}
	const sourcePath = path.join(tempDir, "video-before-audio-mix.mp4");
	await moveFile({ from: videoOutputPath, to: sourcePath });
	try {
		const hasEmbeddedAudio = await probeHasAudioStream({
			mediaPath: sourcePath,
		});
		const embedded =
			audioMixConfig && hasEmbeddedAudio
				? (embeddedAudioMixInput({ path: sourcePath, segments }) ?? {
						path: sourcePath,
						startTime: 0,
						volume: 1,
					})
				: null;
		const mixFiles = embedded ? [embedded, ...audioFiles] : audioFiles;
		if (mixFiles.length === 0 && !hasEmbeddedAudio) {
			if (settings.format === "mp3") {
				throw new Error("Cannot export MP3: the timeline has no audio");
			}
			throwIfCancelled(signal);
			if (enforceTruePeak) {
				await publishVideoWithoutAudio({
					sourcePath,
					outputPath,
					format: settings.format,
					duration,
					runFFmpegCommand,
					signal,
					onPublished,
				});
			} else {
				await moveFile({ from: sourcePath, to: videoOutputPath });
			}
			return {
				finalized: enforceTruePeak,
				...(enforceTruePeak
					? {
							audioValidation: {
								status: "no-audio",
								ceilingDbtp: limiter.ceilingDb,
							} satisfies ExportAudioValidation,
						}
					: {}),
			};
		}
		const inputArgs = ["-y", "-i", sourcePath];
		for (const audioFile of mixFiles) inputArgs.push("-i", audioFile.path);
		const graph = buildTimelineAudioFilters({
			audioFiles: mixFiles,
			audioStartIndex: 1,
			fps: settings.fps,
			audioMixConfig:
				enforceTruePeak && audioMixConfig
					? deferMasterLimiter({ config: audioMixConfig })
					: audioMixConfig,
		});
		if (!graph.mapAudio)
			throw new Error("Timeline audio filter graph produced no audio map");
		const filterSteps = [...graph.filterSteps];
		let audioMap = graph.mapAudio;
		if (hasEmbeddedAudio && !embedded) {
			const externalLabel = audioMap.startsWith("[")
				? audioMap
				: `[${audioMap}]`;
			filterSteps.push(
				`[0:a]${externalLabel}amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a_final]`
			);
			audioMap = "[a_final]";
		}
		const totalDuration = Math.max(
			duration,
			...audioFiles.map(
				(file) => file.startTime + Math.max(0, file.duration ?? 0)
			)
		);
		const graphArgs =
			filterSteps.length > 0 ? ["-filter_complex", filterSteps.join(";")] : [];
		if (enforceTruePeak) {
			const pcmPath = path.join(tempDir, "mixed-master.wav");
			await runFFmpegCommand({
				signal,
				estimatedDuration: totalDuration,
				args: [
					...inputArgs,
					...graphArgs,
					"-map",
					audioMap,
					"-vn",
					"-c:a",
					"pcm_f32le",
					"-rf64",
					"auto",
					"-t",
					String(totalDuration),
					pcmPath,
				],
			});
			const result = await renderTruePeakLimitedExport({
				sourceAudioPath: pcmPath,
				sourceVideoPath: settings.format === "mp3" ? undefined : sourcePath,
				outputPath,
				tempDir,
				duration: totalDuration,
				limiter,
				sampleRate: settings.audioSampleRate ?? 48_000,
				channels: settings.audioChannels ?? 2,
				bitrateKbps: settings.audioBitrate ?? 192,
				format: settings.format,
				signal,
				onPublished,
			});
			return { finalized: true, ...result };
		}
		await runFFmpegCommand({
			signal,
			estimatedDuration: totalDuration,
			args: [
				...inputArgs,
				...graphArgs,
				"-map",
				"0:v:0",
				"-map",
				audioMap,
				"-c:v",
				"copy",
				"-c:a",
				"aac",
				"-b:a",
				`${settings.audioBitrate ?? 192}k`,
				"-ar",
				String(settings.audioSampleRate ?? 48_000),
				"-ac",
				String(settings.audioChannels ?? 2),
				"-t",
				String(totalDuration),
				"-movflags",
				"+faststart",
				videoOutputPath,
			],
		});
		return { finalized: false };
	} catch (error) {
		await fs.rm(videoOutputPath, { force: true }).catch(() => undefined);
		if (!enforceTruePeak)
			await moveFile({ from: sourcePath, to: videoOutputPath });
		throwIfCancelled(signal);
		throw new Error(
			`Timeline audio mix failed: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error }
		);
	}
}
