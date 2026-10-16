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
import type { ClaudeTimeline, MediaFile } from "../../../types/claude-api.js";
import type { ClaudeMixLoudness } from "../../../types/claude-audio-mix-api.js";
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
 * The numbers in FFmpeg's `ebur128=peak=true` log followed by `astats`:
 * integrated loudness and true peak from the summary, the loudest momentary
 * (400 ms) and short-term (3 s) windows from the running lines, the sample
 * peak from astats.
 */
export function parseEbur128Report({
	stderr,
}: {
	stderr: string;
}): Omit<ClaudeMixLoudness, "durationSeconds"> {
	const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
	const integrated = summary.match(/\bI:\s+(-?[\d.]+|-inf) LUFS/);
	const truePeak = summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/);
	if (!integrated || !truePeak) {
		throw new Error(
			`FFmpeg's ebur128 meter gave no summary: ${stderr.slice(-400)}`
		);
	}
	let maxMomentary = Number.NEGATIVE_INFINITY;
	let maxShortTerm = Number.NEGATIVE_INFINITY;
	for (const line of stderr.split("\n")) {
		const momentary = line.match(/\bM:\s*(-?[\d.]+)/);
		const shortTerm = line.match(/\bS:\s*(-?[\d.]+)/);
		if (!momentary || !shortTerm || !/\bt:\s*[\d.]+/.test(line)) continue;
		maxMomentary = Math.max(maxMomentary, Number(momentary[1]));
		maxShortTerm = Math.max(maxShortTerm, Number(shortTerm[1]));
	}
	const samplePeak = stderr.match(/Peak level dB:\s*(-?[\d.]+|-inf)/);
	const toNumber = (text: string) =>
		text === "-inf" ? Number.NEGATIVE_INFINITY : Number(text);
	return {
		integratedLufs: toNumber(integrated[1]),
		truePeakDbtp: toNumber(truePeak[1]),
		maxMomentaryLufs: maxMomentary,
		maxShortTermLufs: maxShortTerm,
		samplePeakDb: samplePeak
			? toNumber(samplePeak[1])
			: Number.NEGATIVE_INFINITY,
	};
}

/** Measures a finished file with FFmpeg's R 128 meter. */
export async function measureFileLoudness({
	file,
}: {
	file: string;
}): Promise<ClaudeMixLoudness> {
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
			"ebur128=peak=true,astats=measure_overall=Peak_level:measure_perchannel=none",
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
	const durationSeconds = Number(probed.stdout.trim());
	return {
		...parseEbur128Report({ stderr: metered.stderr }),
		durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
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
 * measures the result and removes it.
 */
export async function measureNativeExportLoudness({
	projectId,
	timeline,
	mediaFiles,
}: {
	projectId: string;
	timeline: ClaudeTimeline;
	mediaFiles: MediaFile[];
}): Promise<ClaudeMixLoudness> {
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
		return {
			...(await measureFileLoudness({ file: outputPath })),
			engine: "native",
		};
	} finally {
		await fsPromises.rm(tempDir, { recursive: true, force: true });
	}
}
