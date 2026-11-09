/**
 * Loudness of the mix as the native export engine renders it: the timeline
 * is exported through the same FFmpeg pipeline as a real export, at a
 * thumbnail-sized picture so only the sound costs time, and the file is
 * measured with FFmpeg's EBU R 128 meter. A number measured this way agrees
 * with `ffmpeg -af ebur128` on the export itself; the browser renderer's
 * limiter and FFmpeg's differ by a few tenths of an LU on dense material.
 *
 * @module electron/claude/handlers/claude-export-handler/export-loudness
 */

import { spawn } from "node:child_process";
import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getFFmpegPath, getFFprobePath } from "../../../ffmpeg/utils.js";
import type {
	ClaudeTimeline,
	ClaudeTimeRange,
	MediaFile,
} from "../../../types/claude-api.js";
import type { ClaudeMixLoudness } from "../../../types/claude-audio-mix-api.js";
import { parseEbur128Report } from "../../../ffmpeg/ebur128-report.js";
import { resolveTimelineRange, type TimelineRange } from "./export-range.js";
import { getExportJobStatus } from "./job-manager.js";
import { startExportJob } from "./public-api.js";
import { EXPORT_JOB_STATUS } from "./types.js";

/** Picture size of the measuring export: enough for the encoder, no more. */
const PROXY_WIDTH = 64;
const PROXY_HEIGHT = 36;
const POLL_INTERVAL_MS = 500;

function runCapturing({
	command,
	args,
}: {
	command: string;
	args: string[];
}): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ stdout, stderr, code }));
	});
}

/**
 * Measures a finished file with FFmpeg's R 128 meter, or with `range` only
 * that stretch of it (cut sample-exactly, so the meter starts fresh there).
 */
export async function measureFileLoudness({
	file,
	range,
}: {
	file: string;
	range?: TimelineRange;
}): Promise<ClaudeMixLoudness> {
	const rangeFilter = range
		? `atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS,`
		: "";
	const metered = await runCapturing({
		command: getFFmpegPath(),
		args: [
			"-hide_banner",
			"-nostats",
			"-v",
			"info",
			"-i",
			file,
			"-vn",
			"-af",
			`${rangeFilter}ebur128=peak=true,astats=measure_overall=Peak_level:measure_perchannel=none`,
			"-f",
			"null",
			"-",
		],
	});
	if (metered.code !== 0) {
		throw new Error(
			`FFmpeg could not measure ${file}: ${metered.stderr.slice(-400)}`
		);
	}
	const probed = await runCapturing({
		command: await getFFprobePath(),
		args: [
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"csv=p=0",
			file,
		],
	});
	const probedSeconds = Number(probed.stdout.trim());
	const fileSeconds = Number.isFinite(probedSeconds) ? probedSeconds : 0;
	const durationSeconds = range
		? Math.max(0, Math.min(range.end, fileSeconds) - range.start)
		: fileSeconds;
	return {
		...parseEbur128Report({ stderr: metered.stderr }),
		durationSeconds,
	};
}

async function waitForExport({ jobId }: { jobId: string }): Promise<void> {
	for (;;) {
		const job = getExportJobStatus(jobId);
		if (!job) throw new Error(`The measuring export ${jobId} disappeared`);
		if (job.status === EXPORT_JOB_STATUS.completed) return;
		if (
			job.status === EXPORT_JOB_STATUS.failed ||
			job.status === EXPORT_JOB_STATUS.cancelled
		) {
			throw new Error(job.error ?? "The measuring export failed");
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
}

/**
 * Exports the timeline through the native engine into a temporary folder,
 * sound at the export's defaults and the picture shrunk to a thumbnail, then
 * measures the result, or the stretch `range` names, and removes it. The
 * whole programme is rendered either way, so a stretch reads as it plays in
 * the export: a limiter or reverb reaching into it hears what came before.
 */
export async function measureNativeExportLoudness({
	projectId,
	timeline,
	mediaFiles,
	range,
}: {
	projectId: string;
	timeline: ClaudeTimeline;
	mediaFiles: MediaFile[];
	range?: ClaudeTimeRange;
}): Promise<ClaudeMixLoudness> {
	const stretch = range
		? resolveTimelineRange({
				range,
				duration: timeline.duration,
				fps: timeline.fps,
			})
		: undefined;
	const tempDir = await fsPromises.mkdtemp(
		path.join(os.tmpdir(), "qcut-mix-loudness-")
	);
	try {
		const outputPath = path.join(tempDir, "mix.mp4");
		const { jobId } = await startExportJob({
			projectId,
			request: {
				engine: "native",
				outputPath,
				settings: {
					width: PROXY_WIDTH,
					height: PROXY_HEIGHT,
					bitrate: "100k",
					...(timeline.fps > 0 ? { fps: timeline.fps } : {}),
				},
			},
			timeline,
			mediaFiles,
		});
		await waitForExport({ jobId });
		const audioValidation = getExportJobStatus(jobId)?.audioValidation;
		return {
			...(await measureFileLoudness({ file: outputPath, range: stretch })),
			engine: "native",
			...(stretch
				? { range: { startTime: stretch.start, endTime: stretch.end } }
				: {}),
			...(audioValidation ? { audioValidation } : {}),
		};
	} finally {
		await fsPromises.rm(tempDir, { recursive: true, force: true });
	}
}
