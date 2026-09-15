/**
 * `qcut analyze shots` — offline shot-boundary detection with the Jianying
 * 智能镜头分割 model, run from QCut's private runtime snapshot. No cloud call,
 * no Jianying app; the runtime must have been snapshotted on this Mac.
 *
 * `--engine bridge` (default) runs the original ByteNN models through the
 * native bridge, `--engine torch` runs the bit-exact PyTorch reproduction, and
 * `--engine both` runs the two and reports how their cut points line up.
 */

import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	JIANYING_SHOT_SPLIT_ENGINES,
	type JianyingShotSplitComparison,
	type JianyingShotSplitEngine,
	type JianyingShotSplitResult,
	type JianyingShotSplitStatus,
} from "../../jianying-shot-split-contract.js";
import { compareShotSplitResults } from "../../jianying-shot-split/compare.js";
import {
	detectShotsWithJianyingRuntime,
	detectShotsWithTorchEngine,
	inspectJianyingShotSplit,
} from "../../jianying-shot-split/runtime.js";
import type {
	CLIRunOptions,
	CLIResult,
	ProgressFn,
} from "./cli-runner/types.js";

export interface AnalyzeShotsDependencies {
	detect: typeof detectShotsWithJianyingRuntime;
	detectTorch: typeof detectShotsWithTorchEngine;
	inspect: typeof inspectJianyingShotSplit;
}

const DEFAULT_DEPENDENCIES: AnalyzeShotsDependencies = {
	detect: detectShotsWithJianyingRuntime,
	detectTorch: detectShotsWithTorchEngine,
	inspect: inspectJianyingShotSplit,
};

export function resolveAnalyzeShotsEngine({
	engine,
}: {
	engine?: string;
}): JianyingShotSplitEngine {
	if (engine === undefined || engine === "") return "bridge";
	if ((JIANYING_SHOT_SPLIT_ENGINES as readonly string[]).includes(engine)) {
		return engine as JianyingShotSplitEngine;
	}
	throw new Error(
		`--engine must be one of ${JIANYING_SHOT_SPLIT_ENGINES.join(", ")} (got ${engine})`
	);
}

export function buildAnalyzeShotsReport({
	result,
}: {
	result: JianyingShotSplitResult;
}) {
	return {
		route: result.route,
		engine: result.engine,
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

export function buildAnalyzeShotsComparisonReport({
	comparison,
}: {
	comparison: JianyingShotSplitComparison;
}) {
	return {
		agreement: comparison.agreement,
		tolerance_frames: comparison.toleranceFrames,
		matched_count: comparison.matches.length,
		matches: comparison.matches.map((match) => ({
			bridge_frame: match.bridgeFrame,
			torch_frame: match.torchFrame,
			frame_delta: match.frameDelta,
		})),
		bridge_only_frames: comparison.bridgeOnlyFrames,
		torch_only_frames: comparison.torchOnlyFrames,
		max_frame_delta: comparison.maxFrameDelta,
		frame_count_matches: comparison.frameCountMatches,
		bridge_elapsed_ms: comparison.bridgeElapsedMs,
		torch_elapsed_ms: comparison.torchElapsedMs,
	};
}

/** `both`: the bridge report stays at the top level so existing consumers keep working. */
export function buildAnalyzeShotsBothReport({
	bridge,
	torch,
}: {
	bridge: JianyingShotSplitResult;
	torch: JianyingShotSplitResult;
}) {
	return {
		...buildAnalyzeShotsReport({ result: bridge }),
		engine: "both" as const,
		torch: buildAnalyzeShotsReport({ result: torch }),
		comparison: buildAnalyzeShotsComparisonReport({
			comparison: compareShotSplitResults({ bridge, torch }),
		}),
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
		torch_available: status.torch?.available ?? false,
		torch_message: status.torch?.message ?? null,
		torch_version: status.torch?.torchVersion ?? null,
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

type EngineProgress = { percent: number; status: string };

/** Runs both engines concurrently; the reported percent is the mean of the two. */
async function detectWithBothEngines({
	dependencies,
	onProgress,
	request,
	signal,
}: {
	dependencies: AnalyzeShotsDependencies;
	onProgress: ProgressFn;
	request: Parameters<AnalyzeShotsDependencies["detect"]>[0]["request"];
	signal: AbortSignal;
}) {
	const latest: Record<"bridge" | "torch", EngineProgress> = {
		bridge: { percent: 0, status: "" },
		torch: { percent: 0, status: "" },
	};
	const relay =
		(engine: "bridge" | "torch") =>
		({
			progress,
			stage,
			status,
		}: {
			progress: number;
			stage: string;
			status: string;
		}) => {
			latest[engine] = { percent: progress, status };
			onProgress({
				message: `[${engine}] ${status}`,
				model: "jianying-shot-split",
				percent: Math.round((latest.bridge.percent + latest.torch.percent) / 2),
				stage,
			});
		};
	const [bridge, torch] = await Promise.all([
		dependencies.detect({ onProgress: relay("bridge"), request, signal }),
		dependencies.detectTorch({ onProgress: relay("torch"), request, signal }),
	]);
	return { bridge, torch };
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
		const engine = resolveAnalyzeShotsEngine({ engine: options.engine });
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
		const request = {
			fps: options.fps,
			height: options.height,
			sourcePath,
			width: options.width,
		};
		let report: Record<string, unknown>;
		if (engine === "both") {
			const { bridge, torch } = await detectWithBothEngines({
				dependencies,
				onProgress,
				request,
				signal,
			});
			report = buildAnalyzeShotsBothReport({ bridge, torch });
		} else {
			const detect =
				engine === "torch" ? dependencies.detectTorch : dependencies.detect;
			const result = await detect({
				onProgress: ({ progress, stage, status }) =>
					onProgress({
						message: status,
						model: "jianying-shot-split",
						percent: progress,
						stage,
					}),
				request,
				signal,
			});
			report = buildAnalyzeShotsReport({ result });
		}
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
