import { execFile } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { interpolateFrameDirectory } from "../rife/rife-bridge.js";
import { getFFmpegPath, getFFprobePath } from "./paths.js";

const execFileAsync = promisify(execFile);

/**
 * Export-time neural frame interpolation (`frameInterpolation: "neural"`).
 *
 * RIFE works on image sequences, so a source clip is decoded to PNG frames,
 * interpolated to the frame count the export will actually display, and
 * re-encoded as a lossless, colour-tagged intermediate that the normal filter
 * graph then consumes in place of the original file. The RGB round trip is
 * done with the source's own matrix/range on both legs so the intermediate
 * lands back in the same YUV space it came from.
 *
 * Returns null when the source already holds at least as many frames as the
 * output needs — synthesising nothing is the honest answer there, and the
 * caller keeps the original file.
 */

export interface NeuralInterpolationRequest {
	sourcePath: string;
	/** Source in-point in seconds. */
	trimStart: number;
	/** Seconds of source consumed (timeline duration × playback rate). */
	readDuration: number;
	/** Distinct frames the export will show for this stretch. */
	requiredFrames: number;
	/** Scratch directory owned by the caller; two subdirectories are created. */
	workDir: string;
	signal?: AbortSignal;
	onProgress?: (progress: number) => void;
}

export interface NeuralInterpolationResult {
	/** Lossless intermediate to use as the segment source, starting at 0. */
	path: string;
	frameRate: number;
	sourceFrames: number;
	outputFrames: number;
}

interface ProbedVideo {
	frameRate: number;
	colorMatrix: string | null;
	colorPrimaries: string | null;
	colorTransfer: string | null;
	colorRange: "tv" | "pc";
}

const FRAME_PATTERN = /^\d{8}\.png$/;
const KNOWN_MATRICES = new Set([
	"bt709",
	"bt601",
	"smpte170m",
	"bt470bg",
	"bt2020nc",
	"bt2020c",
	"smpte240m",
	"fcc",
]);

function parseFrameRate({ value }: { value: string }): number {
	const [numeratorText, denominatorText = "1"] = value.split("/");
	const numerator = Number(numeratorText);
	const denominator = Number(denominatorText);
	if (
		!Number.isFinite(numerator) ||
		!Number.isFinite(denominator) ||
		denominator <= 0 ||
		numerator <= 0
	) {
		throw new Error(`无法读取视频帧率：${value}`);
	}
	return numerator / denominator;
}

async function probeVideo({
	sourcePath,
}: {
	sourcePath: string;
}): Promise<ProbedVideo> {
	const { stdout } = await execFileAsync(
		await getFFprobePath(),
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=avg_frame_rate,color_space,color_primaries,color_transfer,color_range",
			"-of",
			"json",
			sourcePath,
		],
		{ windowsHide: true }
	);
	const stream = (
		JSON.parse(stdout) as {
			streams?: Array<{
				avg_frame_rate?: string;
				color_space?: string;
				color_primaries?: string;
				color_transfer?: string;
				color_range?: string;
			}>;
		}
	).streams?.[0];
	if (!stream?.avg_frame_rate) {
		throw new Error(`没有可补帧的视频流：${sourcePath}`);
	}
	const known = (value: string | undefined) =>
		value && value !== "unknown" ? value : null;
	return {
		frameRate: parseFrameRate({ value: stream.avg_frame_rate }),
		colorMatrix: known(stream.color_space),
		colorPrimaries: known(stream.color_primaries),
		colorTransfer: known(stream.color_transfer),
		colorRange: stream.color_range === "pc" ? "pc" : "tv",
	};
}

function matrixArgument({ probed }: { probed: ProbedVideo }): string | null {
	return probed.colorMatrix && KNOWN_MATRICES.has(probed.colorMatrix)
		? probed.colorMatrix
		: null;
}

async function countFrames({
	directory,
}: {
	directory: string;
}): Promise<number> {
	return (await readdir(directory)).filter((name) => FRAME_PATTERN.test(name))
		.length;
}

async function runFFmpeg({
	args,
	signal,
}: {
	args: string[];
	signal?: AbortSignal;
}): Promise<void> {
	try {
		await execFileAsync(getFFmpegPath(), ["-y", "-v", "error", ...args], {
			windowsHide: true,
			maxBuffer: 16 * 1024 * 1024,
			signal,
		});
	} catch (error) {
		const stderr =
			error instanceof Error && "stderr" in error
				? String((error as { stderr?: unknown }).stderr ?? "").trim()
				: "";
		throw new Error(
			`FFmpeg failed during neural interpolation${stderr ? `: ${stderr.split("\n").at(-1)}` : ""}`,
			{
				cause: error,
			}
		);
	}
}

export async function prepareNeuralInterpolation({
	sourcePath,
	trimStart,
	readDuration,
	requiredFrames,
	workDir,
	signal,
	onProgress,
}: NeuralInterpolationRequest): Promise<NeuralInterpolationResult | null> {
	if (!(readDuration > 0) || !Number.isFinite(readDuration)) {
		throw new RangeError("readDuration must be a positive finite number");
	}
	if (!Number.isInteger(requiredFrames) || requiredFrames < 2) {
		throw new RangeError("requiredFrames must be an integer of at least 2");
	}
	const probed = await probeVideo({ sourcePath });
	const inputDir = path.join(workDir, "source-frames");
	const outputDir = path.join(workDir, "interpolated-frames");
	await mkdir(inputDir, { recursive: true });
	await mkdir(outputDir, { recursive: true });
	onProgress?.(0.05);

	const matrix = matrixArgument({ probed });
	// Every decoded frame in the read window, no duplication or dropping, so
	// the RIFE timeline is the source timeline.
	await runFFmpeg({
		signal,
		args: [
			...(trimStart > 0 ? ["-ss", String(trimStart)] : []),
			"-t",
			String(readDuration),
			"-i",
			sourcePath,
			"-an",
			"-fps_mode",
			"passthrough",
			"-vf",
			[
				`scale=${[matrix ? `in_color_matrix=${matrix}` : null, `in_range=${probed.colorRange}`, "out_range=pc"].filter(Boolean).join(":")}`,
				"format=rgb24",
			].join(","),
			path.join(inputDir, "%08d.png"),
		],
	});
	const sourceFrames = await countFrames({ directory: inputDir });
	if (sourceFrames < 2) {
		throw new Error(`神经补帧需要至少两帧，实际解出 ${sourceFrames} 帧`);
	}
	onProgress?.(0.25);
	if (requiredFrames <= sourceFrames) return null;

	await interpolateFrameDirectory({
		inputDir,
		outputDir,
		targetFrameCount: requiredFrames,
		signal,
	});
	onProgress?.(0.8);

	const frameRate = requiredFrames / readDuration;
	const intermediate = path.join(workDir, "neural-interpolated.mp4");
	await runFFmpeg({
		signal,
		args: [
			"-framerate",
			String(frameRate),
			"-i",
			path.join(outputDir, "%08d.png"),
			"-vf",
			[
				`scale=${[matrix ? `out_color_matrix=${matrix}` : null, "in_range=pc", `out_range=${probed.colorRange}`].filter(Boolean).join(":")}`,
				"format=yuv444p",
			].join(","),
			"-c:v",
			"libx264",
			"-preset",
			"ultrafast",
			"-qp",
			"0",
			...(probed.colorMatrix ? ["-colorspace", probed.colorMatrix] : []),
			...(probed.colorPrimaries
				? ["-color_primaries", probed.colorPrimaries]
				: []),
			...(probed.colorTransfer ? ["-color_trc", probed.colorTransfer] : []),
			"-color_range",
			probed.colorRange,
			intermediate,
		],
	});
	onProgress?.(1);
	return {
		path: intermediate,
		frameRate,
		sourceFrames,
		outputFrames: requiredFrames,
	};
}
