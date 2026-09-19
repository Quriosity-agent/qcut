import { existsSync } from "node:fs";
import path from "node:path";
import { getFFmpegPath, getFFprobePath } from "../ffmpeg/paths.js";
import {
	JIANYING_SHOT_SPLIT_ONNX_ROUTE,
	type JianyingShotSplitOnnxStatus,
	type JianyingShotSplitProgress,
	type JianyingShotSplitRequest,
	type JianyingShotSplitResult,
} from "../jianying-shot-split-contract.js";
import { shotBoundariesFromPredictResult } from "./bridge-output.js";
import {
	parseOnnxShotOutput,
	SHOT_ONNX_MAX_FRAMES,
	SHOT_ONNX_MODEL_SHA256,
	SHOT_ONNX_PREPROCESSING,
} from "./onnx-output.js";
import { runOnnxProcess } from "./onnx-process.js";
import {
	fpsText,
	probeShotSplitSource,
	requireShotSplitSourceFile,
	validateShotSplitSampling,
} from "./video-input.js";

export function resolveOnnxShotConfig() {
	const contract = process.env.QCUT_JIANYING_SHOT_SPLIT_ONNX_CONTRACT;
	if (!contract || !path.isAbsolute(contract) || !existsSync(contract)) {
		throw new Error(
			"ONNX 本地模型未配置：设置 QCUT_JIANYING_SHOT_SPLIT_ONNX_CONTRACT 为已验证 contract.json 的绝对路径"
		);
	}
	const researchPath = path.join(
		"research",
		"local-model-pytorch",
		"shot_onnx.py"
	);
	const candidates = [
		...(process.resourcesPath
			? [
					path.join(
						process.resourcesPath,
						"local-models",
						"shot",
						"shot_onnx.py"
					),
				]
			: []),
		path.resolve(process.cwd(), researchPath),
		path.resolve(__dirname, "..", "..", researchPath),
		path.resolve(__dirname, "..", "..", "..", researchPath),
		path.resolve(__dirname, "..", "..", "..", "..", researchPath),
	];
	const script = candidates.find((candidate) => existsSync(candidate));
	if (!script) throw new Error("ONNX shot detector scripts are missing");
	return {
		contract,
		script,
		python: process.env.QCUT_JIANYING_SHOT_SPLIT_ONNX_PYTHON ?? "python3",
	};
}

export async function inspectOnnxEngine(): Promise<JianyingShotSplitOnnxStatus> {
	try {
		const { contract, script, python } = resolveOnnxShotConfig();
		const stdout = await runOnnxProcess({
			python,
			args: [script, "--contract", contract, "--check"],
			timeoutMs: 60_000,
		});
		const result: unknown = JSON.parse(stdout);
		if (
			!result ||
			typeof result !== "object" ||
			!("available" in result) ||
			result.available !== true ||
			!("artifact_sha256" in result) ||
			result.artifact_sha256 !== SHOT_ONNX_MODEL_SHA256 ||
			!("onnx_version" in result) ||
			typeof result.onnx_version !== "string"
		) {
			throw new Error("ONNX shot model inspection failed");
		}
		return {
			available: true,
			python,
			onnxVersion: result.onnx_version,
			message: `ONNX Runtime ${result.onnx_version} 本地分镜已就绪`,
		};
	} catch (error) {
		return {
			available: false,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function detectShotsWithOnnxEngine({
	request,
	signal,
	onProgress,
}: {
	request: JianyingShotSplitRequest;
	signal?: AbortSignal;
	onProgress?: (progress: JianyingShotSplitProgress) => void;
}): Promise<JianyingShotSplitResult> {
	const start = Date.now();
	if (
		typeof request.sourcePath !== "string" ||
		!path.isAbsolute(request.sourcePath)
	) {
		throw new Error("镜头分割素材必须使用绝对路径");
	}
	const sampling = validateShotSplitSampling(request);
	const { contract, script, python } = resolveOnnxShotConfig();
	await requireShotSplitSourceFile({ sourcePath: request.sourcePath });
	onProgress?.({ progress: 5, stage: "probe", status: "正在读取视频信息" });
	const metadata = await probeShotSplitSource({
		ffprobePath: await getFFprobePath(),
		sourcePath: request.sourcePath,
		signal,
	});
	const expectedFrames = Math.ceil(metadata.durationSeconds * sampling.fps);
	if (expectedFrames > SHOT_ONNX_MAX_FRAMES)
		throw new Error("ONNX 分镜最多分析 86400 帧，请先缩短素材或降低采样帧率");
	const stdout = await runOnnxProcess({
		python,
		signal,
		args: [
			script,
			"--contract",
			contract,
			"--video",
			request.sourcePath,
			"--ffmpeg",
			getFFmpegPath(),
			"--fps",
			fpsText({ fps: sampling.fps }),
			"--width",
			String(sampling.width),
			"--height",
			String(sampling.height),
		],
		onFrames: (frames) =>
			onProgress?.({
				progress: Math.min(95, 10 + Math.round((85 * frames) / expectedFrames)),
				stage: "decode",
				status: `ONNX 已分析 ${frames}/${expectedFrames} 帧`,
			}),
	});
	const output = parseOnnxShotOutput({
		stdout,
		expectedSampling: {
			...sampling,
			fps: Number(fpsText({ fps: sampling.fps })),
		},
	});
	onProgress?.({ progress: 100, stage: "collect", status: "本地分镜完成" });
	return {
		...sampling,
		...shotBoundariesFromPredictResult({
			fps: sampling.fps,
			frameCount: output.frameCount,
			predictResult: output.cutFrames,
		}),
		appVersion: "11.3.0",
		coreUuid: "",
		engine: "onnx",
		route: JIANYING_SHOT_SPLIT_ONNX_ROUTE,
		durationSeconds: metadata.durationSeconds,
		elapsedMs: Date.now() - start,
		frameCount: output.frameCount,
		sourcePath: request.sourcePath,
		scores: output.scores,
		modelSha256: SHOT_ONNX_MODEL_SHA256,
		preprocessing: SHOT_ONNX_PREPROCESSING,
	};
}
