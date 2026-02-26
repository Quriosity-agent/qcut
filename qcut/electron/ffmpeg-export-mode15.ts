/**
 * FFmpeg Mode 1.5 Export
 *
 * Handles video normalization with FFmpeg padding (Mode 1.5).
 * Normalizes all video sources to a common resolution/fps, concatenates
 * them using the concat demuxer, and optionally mixes overlay audio.
 *
 * Location: electron/ffmpeg-export-mode15.ts
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";

import type {
	ExportOptions,
	ExportResult,
	AudioFile,
	FFmpegProgress,
} from "./ffmpeg/types";

import { parseProgress, getFFprobePath, normalizeVideo } from "./ffmpeg/utils";

import type { IpcMainInvokeEvent } from "electron";

/**
 * Handles Mode 1.5: Video Normalization with FFmpeg Padding.
 * Normalizes all video sources, concatenates them, and optionally mixes audio.
 */
export async function handleMode1_5(
	options: ExportOptions,
	ffmpegPath: string,
	frameDir: string,
	outputFile: string,
	width: number,
	height: number,
	fps: number,
	audioFiles: AudioFile[],
	event: IpcMainInvokeEvent,
	resolve: (value: ExportResult) => void,
	reject: (reason: Error) => void
): Promise<void> {
	console.log(
		"⚡ [MODE 1.5 EXPORT] ============================================"
	);
	console.log(
		"⚡ [MODE 1.5 EXPORT] Mode 1.5: Video Normalization with Padding"
	);
	console.log(
		`⚡ [MODE 1.5 EXPORT] Number of videos: ${options.videoSources?.length || 0}`
	);
	console.log(`⚡ [MODE 1.5 EXPORT] Target resolution: ${width}x${height}`);
	console.log(`⚡ [MODE 1.5 EXPORT] Target FPS: ${fps}`);
	console.log("⚡ [MODE 1.5 EXPORT] Expected speedup: 5-7x faster than Mode 3");
	console.log(
		"⚡ [MODE 1.5 EXPORT] ============================================"
	);

	try {
		// Validate video sources exist
		if (!options.videoSources || options.videoSources.length === 0) {
			const error = "Mode 1.5 requires video sources but none provided";
			console.error(`❌ [MODE 1.5 EXPORT] ${error}`);
			reject(new Error(error));
			return;
		}

		// Validate each video source file exists before processing
		for (let i = 0; i < options.videoSources.length; i++) {
			const source = options.videoSources[i];
			if (!fs.existsSync(source.path)) {
				const error = `Video source ${i + 1} not found: ${source.path}`;
				console.error(`❌ [MODE 1.5 EXPORT] ${error}`);
				reject(new Error(error));
				return;
			}
		}

		console.log(
			`⚡ [MODE 1.5 EXPORT] ✅ All ${options.videoSources.length} video sources validated`
		);

		// Step 1: Normalize all videos to target resolution and fps
		console.log(
			`⚡ [MODE 1.5 EXPORT] Step 1/3: Normalizing ${options.videoSources.length} videos...`
		);
		const normalizedPaths: string[] = [];

		for (let i = 0; i < options.videoSources.length; i++) {
			const source = options.videoSources[i];
			const normalizedPath = path.join(frameDir, `normalized_video_${i}.mp4`);

			console.log(
				`⚡ [MODE 1.5 EXPORT] Normalizing video ${i + 1}/${options.videoSources.length}...`
			);
			console.log(
				`⚡ [MODE 1.5 EXPORT]   Source: ${path.basename(source.path)}`
			);
			console.log(
				`⚡ [MODE 1.5 EXPORT]   Expected duration: ${source.duration}s`
			);
			console.log(
				`⚡ [MODE 1.5 EXPORT]   Trim: start=${source.trimStart || 0}s, end=${source.trimEnd || 0}s`
			);

			// Call normalizeVideo function from utils
			await normalizeVideo(
				source.path,
				normalizedPath,
				width,
				height,
				fps,
				source.duration,
				source.trimStart || 0,
				source.trimEnd || 0
			);

			normalizedPaths.push(normalizedPath);
			console.log(
				`⚡ [MODE 1.5 EXPORT] ✅ Video ${i + 1}/${options.videoSources.length} normalized`
			);
		}

		console.log("⚡ [MODE 1.5 EXPORT] All videos normalized successfully");

		// Step 2/3: Create concat list file for FFmpeg concat demuxer
		console.log("⚡ [MODE 1.5 EXPORT] Step 2/3: Creating concat list...");
		const concatListPath = path.join(frameDir, "concat-list.txt");

		// Escape Windows backslashes for FFmpeg concat file format
		const concatContent = normalizedPaths
			.map((p) => {
				const escapedPath = p.replace(/\\/g, "/").replace(/'/g, "'\\''");
				return `file '${escapedPath}'`;
			})
			.join("\n");

		fs.writeFileSync(concatListPath, concatContent, "utf-8");
		console.log(
			`⚡ [MODE 1.5 EXPORT] ✅ Concat list created: ${normalizedPaths.length} videos`
		);

		// Step 3/3: Concatenate normalized videos using FFmpeg concat demuxer
		console.log(
			`⚡ [MODE 1.5 EXPORT] Step 3/3: Concatenating ${normalizedPaths.length} normalized videos...`
		);

		const concatArgs: string[] = [
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			concatListPath,
			"-c",
			"copy",
			"-movflags",
			"+faststart",
			outputFile,
		];

		console.log(
			`⚡ [MODE 1.5 EXPORT] FFmpeg concat command: ffmpeg ${concatArgs.join(" ")}`
		);

		// Execute concat with progress monitoring
		await new Promise<void>((concatResolve, concatReject) => {
			const concatProcess: ChildProcess = spawn(ffmpegPath, concatArgs, {
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let concatStderr = "";

			concatProcess.stderr?.on("data", (chunk: Buffer) => {
				const text = chunk.toString();
				concatStderr += text;

				const progress: FFmpegProgress | null = parseProgress(text);
				if (progress) {
					event.sender?.send?.("ffmpeg-progress", progress);
				}
			});

			concatProcess.on("close", (code: number | null) => {
				if (code === 0) {
					if (fs.existsSync(outputFile)) {
						const stats = fs.statSync(outputFile);
						console.log("⚡ [MODE 1.5 EXPORT] ✅ Concatenation complete!");
						console.log(
							`⚡ [MODE 1.5 EXPORT] Output size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`
						);
						concatResolve();
					} else {
						concatReject(new Error(`Output file not created: ${outputFile}`));
					}
				} else {
					console.error(
						`❌ [MODE 1.5 EXPORT] Concatenation failed with code ${code}`
					);
					console.error(`❌ [MODE 1.5 EXPORT] FFmpeg stderr:\n${concatStderr}`);
					concatReject(new Error(`FFmpeg concat failed with code ${code}`));
				}
			});

			concatProcess.on("error", (err: Error) => {
				console.error("❌ [MODE 1.5 EXPORT] FFmpeg process error:", err);
				concatReject(err);
			});
		});

		// Mix overlay audio files into the concatenated output if present
		if (audioFiles && audioFiles.length > 0) {
			await mixOverlayAudio(ffmpegPath, frameDir, outputFile, audioFiles);
		}

		// Success!
		console.log(
			"⚡ [MODE 1.5 EXPORT] ============================================"
		);
		console.log("⚡ [MODE 1.5 EXPORT] ✅ Export complete!");
		console.log(`⚡ [MODE 1.5 EXPORT] Output: ${outputFile}`);
		console.log(
			"⚡ [MODE 1.5 EXPORT] ============================================"
		);

		resolve({
			success: true,
			outputFile,
			method: "spawn",
		});
	} catch (error: any) {
		console.error(
			"❌ [MODE 1.5 EXPORT] ============================================"
		);
		console.error(
			"❌ [MODE 1.5 EXPORT] Normalization failed - no fallback available"
		);
		console.error("❌ [MODE 1.5 EXPORT] Error:", error.message || error);
		console.error(
			"❌ [MODE 1.5 EXPORT] ============================================"
		);

		reject(error);
	}
}

/**
 * Mixes overlay audio files into the concatenated video output.
 * Uses adelay for per-file timing and amix for multiple audio streams.
 */
async function mixOverlayAudio(
	ffmpegPath: string,
	frameDir: string,
	outputFile: string,
	audioFiles: AudioFile[]
): Promise<void> {
	console.log(
		`🎧 [MODE 1.5 EXPORT] Mixing ${audioFiles.length} overlay audio file(s) into output...`
	);

	const concatOutputTemp = path.join(frameDir, "concat_before_audio.mp4");
	// Rename current output to temp so we can mix into final output
	fs.renameSync(outputFile, concatOutputTemp);

	// Build FFmpeg inputs: video + each audio file
	const mixArgs: string[] = ["-y", "-i", concatOutputTemp];
	for (const af of audioFiles) {
		mixArgs.push("-i", af.path);
	}

	// Check if the concat output has an audio stream
	const probePath = await getFFprobePath();
	const hasBaseAudio = await new Promise<boolean>((resolve) => {
		const probe = spawn(
			probePath,
			[
				"-v",
				"quiet",
				"-select_streams",
				"a",
				"-show_entries",
				"stream=codec_type",
				"-of",
				"csv=p=0",
				concatOutputTemp,
			],
			{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
		);
		let stdout = "";
		probe.stdout?.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		probe.on("close", () => resolve(stdout.trim().length > 0));
		probe.on("error", () => resolve(false));
	});

	// Build filter_complex for audio mixing
	const filterParts: string[] = [];
	const mixInputLabels: string[] = [];

	if (hasBaseAudio) {
		mixInputLabels.push("[0:a]"); // base video audio
	} else {
		console.log(
			"🔇 [MODE 1.5 EXPORT] No base audio stream — mixing overlays only"
		);
	}

	for (let i = 0; i < audioFiles.length; i++) {
		const af = audioFiles[i];
		const delayMs = Math.round((af.startTime ?? 0) * 1000);
		const vol = af.volume ?? 1.0;
		const label = `[oa${i}]`;
		filterParts.push(
			`[${i + 1}:a]adelay=${delayMs}|${delayMs},volume=${vol}${label}`
		);
		mixInputLabels.push(label);
	}

	// Use "first" duration when base audio sets the length, "longest" otherwise
	const amixDuration = hasBaseAudio ? "first" : "longest";
	const mixInputCount = mixInputLabels.length;
	filterParts.push(
		`${mixInputLabels.join("")}amix=inputs=${mixInputCount}:duration=${amixDuration}:dropout_transition=0[aout]`
	);

	mixArgs.push(
		"-filter_complex",
		filterParts.join(";"),
		"-map",
		"0:v",
		"-map",
		"[aout]",
		"-c:v",
		"copy",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-movflags",
		"+faststart",
		outputFile
	);

	console.log(
		`🎧 [MODE 1.5 EXPORT] Audio mix command: ffmpeg ${mixArgs.join(" ")}`
	);

	await new Promise<void>((mixResolve, mixReject) => {
		const mixProcess: ChildProcess = spawn(ffmpegPath, mixArgs, {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let mixStderr = "";

		mixProcess.stderr?.on("data", (chunk: Buffer) => {
			mixStderr += chunk.toString();
		});

		mixProcess.on("close", (code: number | null) => {
			if (code === 0) {
				console.log("🎧 [MODE 1.5 EXPORT] ✅ Audio mixing complete!");
				// Clean up temp file
				try {
					fs.unlinkSync(concatOutputTemp);
				} catch {
					// ignore cleanup errors
				}
				mixResolve();
			} else {
				console.error(
					`❌ [MODE 1.5 EXPORT] Audio mixing failed with code ${code}`
				);
				console.error(`❌ [MODE 1.5 EXPORT] FFmpeg stderr:\n${mixStderr}`);
				// Restore original concat output (without overlay audio)
				try {
					fs.renameSync(concatOutputTemp, outputFile);
				} catch {
					// ignore restore errors
				}
				console.warn(
					"⚠️ [MODE 1.5 EXPORT] Falling back to output without overlay audio"
				);
				mixResolve(); // Don't reject — export with embedded audio only
			}
		});

		mixProcess.on("error", (err: Error) => {
			console.error("❌ [MODE 1.5 EXPORT] Audio mix process error:", err);
			// Restore original concat output
			try {
				fs.renameSync(concatOutputTemp, outputFile);
			} catch {
				// ignore restore errors
			}
			console.warn(
				"⚠️ [MODE 1.5 EXPORT] Falling back to output without overlay audio"
			);
			mixResolve(); // Don't reject — graceful fallback
		});
	});
}
