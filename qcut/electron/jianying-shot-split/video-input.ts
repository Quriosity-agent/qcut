/**
 * Source probing and the ffmpeg decode command that streams resampled RGBA
 * frames to the shot-split bridge through a named pipe. The Bach graph rescales every frame to
 * 96×96 itself, so a small 320×180 sample is all the model needs.
 */

import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { JianyingShotSplitSampling } from "../jianying-shot-split-contract.js";

const execFileAsync = promisify(execFile);
const MIN_FPS = 1;
const MAX_FPS = 60;
const MIN_DIMENSION = 16;
const MAX_DIMENSION = 1920;
const MAX_SOURCE_DURATION_SECONDS = 6 * 60 * 60;

export const SHOT_SPLIT_DEFAULT_SAMPLING: JianyingShotSplitSampling = {
	fps: 24,
	height: 180,
	width: 320,
};

export interface ShotSplitSourceMetadata {
	durationSeconds: number;
	height: number;
	width: number;
}

export function fpsText({ fps }: { fps: number }) {
	return fps.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** Fills in defaults and rejects sampling settings the model was not measured at. */
export function validateShotSplitSampling({
	fps = SHOT_SPLIT_DEFAULT_SAMPLING.fps,
	height = SHOT_SPLIT_DEFAULT_SAMPLING.height,
	width = SHOT_SPLIT_DEFAULT_SAMPLING.width,
}: Partial<JianyingShotSplitSampling>): JianyingShotSplitSampling {
	if (!Number.isFinite(fps) || fps < MIN_FPS || fps > MAX_FPS) {
		throw new Error(`采样帧率必须在 ${MIN_FPS}–${MAX_FPS} fps 之间`);
	}
	for (const dimension of [width, height]) {
		if (
			!Number.isSafeInteger(dimension) ||
			dimension < MIN_DIMENSION ||
			dimension > MAX_DIMENSION
		) {
			throw new Error(
				`采样尺寸必须是 ${MIN_DIMENSION}–${MAX_DIMENSION} 之间的整数`
			);
		}
	}
	return { fps, height, width };
}

export async function requireShotSplitSourceFile({
	sourcePath,
}: {
	sourcePath: string;
}) {
	try {
		await access(sourcePath);
	} catch {
		throw new Error(`镜头分割素材不存在: ${sourcePath}`);
	}
	const metadata = await stat(sourcePath);
	if (!metadata.isFile() || metadata.size === 0) {
		throw new Error("镜头分割素材不是可读取的本机视频");
	}
}

export function probeFailureDetail({ error }: { error: unknown }) {
	const stderr =
		error && typeof error === "object" && "stderr" in error
			? String((error as { stderr?: unknown }).stderr ?? "")
			: "";
	const lastLine = stderr.trim().split("\n").filter(Boolean).at(-1);
	if (lastLine) return lastLine;
	return error instanceof Error ? error.message : String(error);
}

export async function probeShotSplitSource({
	ffprobePath,
	signal,
	sourcePath,
}: {
	ffprobePath: string;
	signal?: AbortSignal;
	sourcePath: string;
}): Promise<ShotSplitSourceMetadata> {
	let stdout: string;
	try {
		({ stdout } = await execFileAsync(
			ffprobePath,
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=width,height:format=duration",
				"-of",
				"json",
				sourcePath,
			],
			{ maxBuffer: 1024 * 1024, signal, timeout: 60_000 }
		));
	} catch (error) {
		if (signal?.aborted) throw error;
		throw new Error(`无法读取视频信息: ${probeFailureDetail({ error })}`);
	}
	const value = JSON.parse(stdout) as {
		format?: { duration?: unknown };
		streams?: Array<{ height?: unknown; width?: unknown }>;
	};
	const stream = value.streams?.[0];
	if (
		!stream ||
		!Number.isSafeInteger(stream.width) ||
		!Number.isSafeInteger(stream.height) ||
		(stream.width as number) <= 0 ||
		(stream.height as number) <= 0
	) {
		throw new Error("视频没有可分析的画面流");
	}
	const durationSeconds = Number(value.format?.duration);
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		throw new Error("无法读取视频时长");
	}
	if (durationSeconds > MAX_SOURCE_DURATION_SECONDS) {
		throw new Error("镜头分割单次最多处理 6 小时的视频");
	}
	return {
		durationSeconds,
		height: stream.height as number,
		width: stream.width as number,
	};
}

/** ffmpeg arguments that write resampled raw RGBA frames to `rawPath` (a named pipe or file). */
export function buildShotSplitDecodeArguments({
	fps,
	height,
	rawPath,
	sourcePath,
	width,
}: JianyingShotSplitSampling & { rawPath: string; sourcePath: string }) {
	return [
		"-hide_banner",
		"-loglevel",
		"error",
		"-nostdin",
		"-y",
		"-i",
		sourcePath,
		"-map",
		"0:v:0",
		"-an",
		"-sn",
		"-vf",
		`fps=${fpsText({ fps })},scale=${width}:${height}:flags=bilinear`,
		"-pix_fmt",
		"rgba",
		"-f",
		"rawvideo",
		rawPath,
	];
}

export function estimateShotSplitFrameCount({
	durationSeconds,
	fps,
}: {
	durationSeconds: number;
	fps: number;
}) {
	return Math.max(1, Math.round(durationSeconds * fps));
}
