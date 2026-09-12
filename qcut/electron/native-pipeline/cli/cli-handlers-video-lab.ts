import {
	copyFile,
	link,
	mkdir,
	mkdtemp,
	realpath,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { deflickerLocalVideo } from "../../ffmpeg/deflicker-video.js";
import { deflickerWithJianyingRuntime } from "../../jianying-basic-video-runtime/runtime.js";
import type {
	CLIRunOptions,
	CLIResult,
	ProgressFn,
} from "./cli-runner/types.js";

function defaultOutputPath({ inputPath }: { inputPath: string }) {
	const extension = extname(inputPath);
	const stem = basename(inputPath, extension);
	return resolve(dirname(inputPath), `${stem}-deflicker.mp4`);
}

function validateStrength({ value }: { value: number | undefined }) {
	const strength = value ?? 70;
	if (!Number.isInteger(strength) || strength < 1 || strength > 100) {
		throw new Error("--strength must be an integer from 1 to 100");
	}
	return strength;
}

async function pathExists({ filePath }: { filePath: string }) {
	try {
		await stat(filePath);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

async function assertDistinctSourceAndOutput({
	sourcePath,
	outputPath,
}: {
	sourcePath: string;
	outputPath: string;
}) {
	if (sourcePath === outputPath) {
		throw new Error("Output must not overwrite the source video");
	}
	if (!(await pathExists({ filePath: outputPath }))) return;
	const [canonicalSource, canonicalOutput, sourceStat, outputStat] =
		await Promise.all([
			realpath(sourcePath),
			realpath(outputPath),
			stat(sourcePath),
			stat(outputPath),
		]);
	const sameEntryWithDifferentCase =
		sourceStat.dev === outputStat.dev &&
		sourceStat.ino === outputStat.ino &&
		basename(canonicalSource).toLowerCase() ===
			basename(canonicalOutput).toLowerCase();
	if (canonicalSource === canonicalOutput || sameEntryWithDifferentCase) {
		throw new Error("Output must not overwrite the source video");
	}
}

async function publishOutput({
	cachePath,
	force,
	outputPath,
	signal,
}: {
	cachePath: string;
	force: boolean;
	outputPath: string;
	signal: AbortSignal;
}) {
	if (resolve(cachePath) === resolve(outputPath)) return;
	const outputExists = await pathExists({ filePath: outputPath });
	if (outputExists && !force)
		throw new Error(`Output already exists: ${outputPath}`);
	await mkdir(dirname(outputPath), { recursive: true });
	const temporaryDirectory = await mkdtemp(
		resolve(dirname(outputPath), ".qcut-deflicker-publish-")
	);
	const temporaryPath = resolve(temporaryDirectory, "result.mp4");
	try {
		await copyFile(cachePath, temporaryPath);
		signal.throwIfAborted();
		if (force) await rename(temporaryPath, outputPath);
		else await link(temporaryPath, outputPath);
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}

export async function handleVideoLabDeflicker(
	options: CLIRunOptions,
	onProgress: ProgressFn,
	signal: AbortSignal
): Promise<CLIResult> {
	const startedAt = Date.now();
	try {
		if (!options.input) throw new Error("--input is required");
		const sourcePath = resolve(options.input);
		const outputPath = options.output
			? resolve(options.output)
			: defaultOutputPath({ inputPath: sourcePath });
		await assertDistinctSourceAndOutput({ sourcePath, outputPath });
		const strength = validateStrength({ value: options.strength });
		if ((await pathExists({ filePath: outputPath })) && !options.force) {
			throw new Error(`Output already exists: ${outputPath}`);
		}
		const backend = options.backend ?? "ffmpeg";
		if (backend !== "ffmpeg" && backend !== "jianying") {
			throw new Error("--backend must be ffmpeg or jianying");
		}
		const reportProgress = ({
			progress,
			stage,
			status,
		}: {
			progress: number;
			stage: string;
			status: string;
		}) =>
			onProgress({
				message: status,
				model: backend === "ffmpeg" ? "ffmpeg" : "jianying-private-cache",
				percent: progress,
				stage,
			});
		const result =
			backend === "ffmpeg"
				? await deflickerLocalVideo({
						sourcePath,
						outputPath,
						strength,
						force: options.force,
						signal,
						onProgress: reportProgress,
					})
				: await deflickerWithJianyingRuntime({
						request: {
							sourcePath,
							strength,
							taskId: options.commandId ?? `cli-deflicker-${Date.now()}`,
						},
						signal,
						onProgress: reportProgress,
					});
		if (backend === "jianying") {
			signal.throwIfAborted();
			await publishOutput({
				cachePath: result.outputPath,
				force: options.force ?? false,
				outputPath,
				signal,
			});
		}
		return {
			data: {
				backend,
				cache_hit: result.cacheHit,
				fps: result.fps,
				frame_count: result.frameCount,
				has_audio: result.hasAudio,
				height: result.height,
				provider: result.provider,
				route: result.route,
				strength: result.strength,
				width: result.width,
			},
			duration: (Date.now() - startedAt) / 1000,
			outputPath,
			outputPaths: [outputPath],
			success: true,
		};
	} catch (error) {
		return {
			duration: (Date.now() - startedAt) / 1000,
			error: error instanceof Error ? error.message : String(error),
			success: false,
		};
	}
}
