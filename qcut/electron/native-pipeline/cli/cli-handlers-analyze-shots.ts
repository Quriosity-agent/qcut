/**
 * `qcut analyze shots` — offline shot-boundary detection with the Jianying
 * 智能镜头分割 model, run from QCut's private runtime snapshot. No cloud call,
 * no Jianying app; the runtime must have been snapshotted on this Mac.
 */

import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
	JianyingShotSplitResult,
	JianyingShotSplitStatus,
} from "../../jianying-shot-split-contract.js";
import {
	detectShotsWithJianyingRuntime,
	inspectJianyingShotSplit,
} from "../../jianying-shot-split/runtime.js";
import type {
	CLIRunOptions,
	CLIResult,
	ProgressFn,
} from "./cli-runner/types.js";

export interface AnalyzeShotsDependencies {
	detect: typeof detectShotsWithJianyingRuntime;
	inspect: typeof inspectJianyingShotSplit;
}

const DEFAULT_DEPENDENCIES: AnalyzeShotsDependencies = {
	detect: detectShotsWithJianyingRuntime,
	inspect: inspectJianyingShotSplit,
};

export function buildAnalyzeShotsReport({
	result,
}: {
	result: JianyingShotSplitResult;
}) {
	return {
		route: result.route,
		app_version: result.appVersion,
		core_uuid: result.coreUuid,
		input: result.sourcePath,
		fps: result.fps,
		width: result.width,
		height: result.height,
		frame_count: result.frameCount,
		duration_seconds: result.durationSeconds,
		cut_count: result.cutFrames.length,
		cut_frames: result.cutFrames,
		cut_points: result.cutPoints,
		shots: result.shots.map((shot) => ({
			index: shot.index,
			start_frame: shot.startFrame,
			end_frame: shot.endFrame,
			start_time: shot.startTime,
			end_time: shot.endTime,
		})),
		elapsed_ms: result.elapsedMs,
	};
}

export function buildAnalyzeShotsStatus({
	status,
}: {
	status: JianyingShotSplitStatus;
}) {
	return {
		route: status.route,
		available: status.available,
		message: status.message,
		platform_supported: status.platformSupported,
		offline_ready: status.offlineReady,
		runtime_root: status.runtimeRoot ?? null,
		app_version: status.appVersion ?? null,
		core_uuid: status.coreUuid ?? null,
	};
}

async function pathExists({ filePath }: { filePath: string }) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function handleAnalyzeShots(
	options: CLIRunOptions,
	onProgress: ProgressFn,
	signal: AbortSignal,
	dependencies: AnalyzeShotsDependencies = DEFAULT_DEPENDENCIES
): Promise<CLIResult> {
	const startedAt = Date.now();
	try {
		if (options.checkOnly) {
			const status = await dependencies.inspect();
			return {
				data: buildAnalyzeShotsStatus({ status }),
				duration: (Date.now() - startedAt) / 1000,
				success: true,
			};
		}
		if (!options.input) {
			throw new Error(
				"--input is required (pass --check to inspect the runtime)"
			);
		}
		const sourcePath = resolve(options.input);
		const outputPath = options.output ? resolve(options.output) : undefined;
		if (
			outputPath &&
			!options.force &&
			(await pathExists({ filePath: outputPath }))
		) {
			throw new Error(`Output already exists: ${outputPath}`);
		}
		const result = await dependencies.detect({
			onProgress: ({ progress, stage, status }) =>
				onProgress({
					message: status,
					model: "jianying-shot-split",
					percent: progress,
					stage,
				}),
			request: {
				fps: options.fps,
				height: options.height,
				sourcePath,
				width: options.width,
			},
			signal,
		});
		const report = buildAnalyzeShotsReport({ result });
		if (outputPath) {
			await mkdir(dirname(outputPath), { recursive: true });
			await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
		}
		return {
			data: report,
			duration: (Date.now() - startedAt) / 1000,
			success: true,
			...(outputPath ? { outputPath, outputPaths: [outputPath] } : {}),
		};
	} catch (error) {
		return {
			duration: (Date.now() - startedAt) / 1000,
			error: error instanceof Error ? error.message : String(error),
			success: false,
		};
	}
}
