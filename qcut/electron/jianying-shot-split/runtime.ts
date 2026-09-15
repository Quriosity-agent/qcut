/**
 * Offline shot-boundary detection with the Jianying 智能镜头分割 model, run
 * from the verified private runtime snapshot without the Jianying app. Two
 * engines share this entry point: the native bridge (original ByteNN models)
 * and the torch engine (bit-exact PyTorch reproduction of the same models).
 */

import path from "node:path";
import { getFFmpegPath, getFFprobePath } from "../ffmpeg/paths.js";
import {
	JIANYING_SHOT_SPLIT_ROUTE,
	type JianyingShotSplitProgress,
	type JianyingShotSplitRequest,
	type JianyingShotSplitResult,
	type JianyingShotSplitStatus,
} from "../jianying-shot-split-contract.js";
import {
	parseShotSplitBridgeOutput,
	shotBoundariesFromPredictResult,
} from "./bridge-output.js";
import { resolveJianyingShotSplitBridge } from "./bridge-resolver.js";
import {
	runShotSplitPipeline,
	shotSplitAbortError,
} from "./process-pipeline.js";
import {
	defaultShotSplitRuntimeRoot,
	EXPECTED_SHOT_SPLIT_CORE_SHA256,
	shotSplitRuntimePaths,
	verifyShotSplitRuntimeSnapshot,
} from "./runtime-assets.js";
import {
	inspectTorchEngine,
	resolveTorchDetectorScript,
	resolveTorchLayerTables,
	runTorchDetector,
	torchModelPaths,
	torchResultFromDetectorOutput,
} from "./torch-engine.js";
import {
	estimateShotSplitFrameCount,
	probeShotSplitSource,
	requireShotSplitSourceFile,
	validateShotSplitSampling,
} from "./video-input.js";

const DECODE_PROGRESS_START = 20;
const DECODE_PROGRESS_SPAN = 70;
const UNSUPPORTED_PLATFORM_MESSAGE = "本机镜头分割仅支持 Apple Silicon macOS";
const BRIDGE_UNAVAILABLE_MESSAGE =
	"本机镜头分割桥不可用：需要 Xcode 命令行工具和 research/jianying-shot-split-probe 源码";

type ProgressCallback = (progress: JianyingShotSplitProgress) => void;

export function shotSplitRuntimeRoot() {
	return path.resolve(
		process.env.QCUT_JIANYING_SHOT_SPLIT_RUNTIME ??
			defaultShotSplitRuntimeRoot()
	);
}

function platformSupported() {
	return process.platform === "darwin" && process.arch === "arm64";
}

export async function inspectJianyingShotSplit(): Promise<JianyingShotSplitStatus> {
	const base = {
		available: false,
		localOnly: true as const,
		offlineReady: false,
		platformSupported: platformSupported(),
		route: JIANYING_SHOT_SPLIT_ROUTE,
	};
	if (!base.platformSupported) {
		return { ...base, message: UNSUPPORTED_PLATFORM_MESSAGE };
	}
	const runtimeRoot = shotSplitRuntimeRoot();
	try {
		const manifest = await verifyShotSplitRuntimeSnapshot({
			snapshotPath: runtimeRoot,
		});
		const identity = {
			appVersion: manifest.app.version,
			coreSha256: EXPECTED_SHOT_SPLIT_CORE_SHA256,
			coreUuid: manifest.core.arm64Uuid,
			runtimeRoot,
		};
		const [bridgePath, torch] = await Promise.all([
			resolveJianyingShotSplitBridge({
				runtimeRoot,
				runtimeSha256: EXPECTED_SHOT_SPLIT_CORE_SHA256,
			}),
			inspectTorchEngine(),
		]);
		if (!bridgePath) {
			return {
				...base,
				...identity,
				message: BRIDGE_UNAVAILABLE_MESSAGE,
				torch,
			};
		}
		return {
			...base,
			...identity,
			available: true,
			message: `剪映 ${manifest.app.version} 智能镜头分割私有 runtime 已就绪`,
			offlineReady: true,
			torch,
		};
	} catch (error) {
		return {
			...base,
			message:
				error instanceof Error ? error.message : "无法校验本机镜头分割 runtime",
			runtimeRoot,
		};
	}
}

export async function detectShotsWithJianyingRuntime({
	onProgress,
	request,
	signal,
}: {
	onProgress?: ProgressCallback;
	request: JianyingShotSplitRequest;
	signal?: AbortSignal;
}): Promise<JianyingShotSplitResult> {
	const startedAt = Date.now();
	if (!platformSupported()) throw new Error(UNSUPPORTED_PLATFORM_MESSAGE);
	if (
		typeof request.sourcePath !== "string" ||
		!path.isAbsolute(request.sourcePath)
	) {
		throw new Error("镜头分割素材必须使用绝对路径");
	}
	const sampling = validateShotSplitSampling(request);
	const report = (progress: JianyingShotSplitProgress) =>
		onProgress?.(progress);
	const throwIfAborted = () => {
		if (signal?.aborted) throw shotSplitAbortError();
	};
	report({ progress: 2, stage: "verify", status: "正在校验私有 runtime" });
	await requireShotSplitSourceFile({ sourcePath: request.sourcePath });
	const runtimeRoot = shotSplitRuntimeRoot();
	const manifest = await verifyShotSplitRuntimeSnapshot({
		snapshotPath: runtimeRoot,
	});
	throwIfAborted();
	report({ progress: 10, stage: "prepare", status: "正在准备本机镜头分割桥" });
	const [bridgePath, ffprobePath] = await Promise.all([
		resolveJianyingShotSplitBridge({
			runtimeRoot,
			runtimeSha256: EXPECTED_SHOT_SPLIT_CORE_SHA256,
		}),
		getFFprobePath(),
	]);
	if (!bridgePath) throw new Error(BRIDGE_UNAVAILABLE_MESSAGE);
	throwIfAborted();
	report({ progress: 15, stage: "probe", status: "正在读取视频信息" });
	const metadata = await probeShotSplitSource({
		ffprobePath,
		signal,
		sourcePath: request.sourcePath,
	});
	const expectedFrames = estimateShotSplitFrameCount({
		durationSeconds: metadata.durationSeconds,
		fps: sampling.fps,
	});
	report({
		progress: DECODE_PROGRESS_START,
		stage: "decode",
		status: `正在逐帧分析（约 ${expectedFrames} 帧）`,
	});
	const { stdout } = await runShotSplitPipeline({
		bridgePath,
		ffmpegPath: getFFmpegPath(),
		graphPath: shotSplitRuntimePaths({ runtimeRoot }).graphPath,
		onFrameProgress: (frames) =>
			report({
				progress:
					DECODE_PROGRESS_START +
					Math.min(
						DECODE_PROGRESS_SPAN,
						Math.round((frames / expectedFrames) * DECODE_PROGRESS_SPAN)
					),
				stage: "decode",
				status: `已分析 ${frames}/${expectedFrames} 帧`,
			}),
		runtimeRoot,
		sampling,
		signal,
		sourcePath: request.sourcePath,
	});
	report({ progress: 95, stage: "collect", status: "正在整理切点" });
	const output = parseShotSplitBridgeOutput({ stdout });
	if (output.frameCount === 0) throw new Error("没有从视频解码出任何帧");
	const boundaries = shotBoundariesFromPredictResult({
		fps: sampling.fps,
		frameCount: output.frameCount,
		predictResult: output.predictResult,
	});
	return {
		...sampling,
		...boundaries,
		appVersion: manifest.app.version,
		coreUuid: manifest.core.arm64Uuid,
		durationSeconds: metadata.durationSeconds,
		elapsedMs: Date.now() - startedAt,
		engine: "bridge",
		frameCount: output.frameCount,
		route: JIANYING_SHOT_SPLIT_ROUTE,
		sourcePath: request.sourcePath,
	};
}

/**
 * Same request and result shape as the bridge, computed by the PyTorch
 * reproduction. The models still come from the verified snapshot; only the
 * inference engine differs.
 */
export async function detectShotsWithTorchEngine({
	onProgress,
	request,
	signal,
}: {
	onProgress?: ProgressCallback;
	request: JianyingShotSplitRequest;
	signal?: AbortSignal;
}): Promise<JianyingShotSplitResult> {
	const startedAt = Date.now();
	if (
		typeof request.sourcePath !== "string" ||
		!path.isAbsolute(request.sourcePath)
	) {
		throw new Error("镜头分割素材必须使用绝对路径");
	}
	const sampling = validateShotSplitSampling(request);
	const report = (progress: JianyingShotSplitProgress) =>
		onProgress?.(progress);
	const throwIfAborted = () => {
		if (signal?.aborted) throw shotSplitAbortError();
	};
	report({ progress: 2, stage: "verify", status: "正在校验私有 runtime" });
	await requireShotSplitSourceFile({ sourcePath: request.sourcePath });
	const runtimeRoot = shotSplitRuntimeRoot();
	const manifest = await verifyShotSplitRuntimeSnapshot({
		snapshotPath: runtimeRoot,
	});
	throwIfAborted();
	report({
		progress: 10,
		stage: "prepare",
		status: "正在准备 PyTorch 复现引擎",
	});
	const torch = await inspectTorchEngine();
	if (!torch.available) throw new Error(torch.message);
	const script = resolveTorchDetectorScript();
	const layerTables = script
		? resolveTorchLayerTables({ projectRoot: script.projectRoot })
		: null;
	if (!script || !layerTables) throw new Error(torch.message);
	const ffprobePath = await getFFprobePath();
	throwIfAborted();
	report({ progress: 15, stage: "probe", status: "正在读取视频信息" });
	const metadata = await probeShotSplitSource({
		ffprobePath,
		signal,
		sourcePath: request.sourcePath,
	});
	report({
		progress: DECODE_PROGRESS_START,
		stage: "decode",
		status: "正在用 PyTorch 逐帧分析",
	});
	const output = await runTorchDetector({
		ffmpegPath: getFFmpegPath(),
		layerTables,
		models: torchModelPaths({ runtimeRoot }),
		onProgress: ({ fraction, status }) =>
			report({
				progress:
					DECODE_PROGRESS_START +
					Math.round((fraction ?? 0) * DECODE_PROGRESS_SPAN),
				stage: "decode",
				status,
			}),
		sampling,
		scriptPath: script.scriptPath,
		signal,
		sourcePath: request.sourcePath,
	});
	report({ progress: 95, stage: "collect", status: "正在整理切点" });
	if (output.frameCount === 0) throw new Error("没有从视频解码出任何帧");
	return torchResultFromDetectorOutput({
		appVersion: manifest.app.version,
		coreUuid: manifest.core.arm64Uuid,
		durationSeconds: metadata.durationSeconds,
		elapsedMs: Date.now() - startedAt,
		output,
		sampling,
		sourcePath: request.sourcePath,
	});
}
