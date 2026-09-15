/**
 * The torch engine: runs the bit-exact PyTorch reproduction of the Jianying
 * shot-split models (`research/jianying-shot-split-probe/detect_cuts_torch.py`)
 * against the `.bytenn` files in the verified private runtime snapshot. Needs a
 * `python3` with torch on PATH (or `QCUT_JIANYING_SHOT_SPLIT_PYTHON`) and the
 * layer tables exported by `weight-dump` (`.local/jianying-shot-split/params2`,
 * or `QCUT_JIANYING_SHOT_SPLIT_LAYER_TABLES`). Neither the models nor the layer
 * tables are part of the repository.
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
	JIANYING_SHOT_SPLIT_TORCH_ROUTE,
	type JianyingShotSplitResult,
	type JianyingShotSplitSampling,
	type JianyingShotSplitTorchStatus,
} from "../jianying-shot-split-contract.js";
import { shotBoundariesFromPredictResult } from "./bridge-output.js";
import { findShotSplitProjectRoot } from "./bridge-resolver.js";
import { shotSplitAbortError } from "./process-pipeline.js";
import { SHOT_SPLIT_MODEL_RELATIVE_PATHS } from "./runtime-assets.js";
import { fpsText } from "./video-input.js";

const execFileAsync = promisify(execFile);
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60 * 60_000;
const DETECTOR_RELATIVE_PATH = path.join(
	"research",
	"jianying-shot-split-probe",
	"detect_cuts_torch.py"
);
const LAYER_TABLE_RELATIVE_PATHS = {
	backbone: path.join(
		".local",
		"jianying-shot-split",
		"params2",
		"engine-4",
		"params.tsv"
	),
	predhead: path.join(
		".local",
		"jianying-shot-split",
		"params2",
		"engine-5",
		"params.tsv"
	),
} as const;
const PROGRESS_LINE =
	/^\[progress\] (decoded (\d+) frames|loading models|features (\d+)\/(\d+)|windows (\d+)\/(\d+))$/;
const TORCH_MISSING_MESSAGE =
	"PyTorch 镜头分割引擎不可用：需要带 torch 的 python3（或设置 QCUT_JIANYING_SHOT_SPLIT_PYTHON）";
const LAYER_TABLES_MISSING_MESSAGE =
	"PyTorch 镜头分割引擎不可用：缺少 weight-dump 导出的层表（.local/jianying-shot-split/params2 或 QCUT_JIANYING_SHOT_SPLIT_LAYER_TABLES）";
const DETECTOR_MISSING_MESSAGE =
	"PyTorch 镜头分割引擎不可用：找不到 research/jianying-shot-split-probe/detect_cuts_torch.py";

export interface TorchDetectorOutput {
	cutFrames: number[];
	elapsedMs: number;
	frameCount: number;
	scores: Array<[number, number]>;
	torchVersion: string;
}

export interface TorchProgress {
	/** 0–1 within the detector's own work, when the line carries a fraction. */
	fraction: number | null;
	status: string;
}

export function pythonInterpreter() {
	return process.env.QCUT_JIANYING_SHOT_SPLIT_PYTHON ?? "python3";
}

export function resolveTorchDetectorScript() {
	const projectRoot = findShotSplitProjectRoot();
	if (!projectRoot) return null;
	const scriptPath = path.join(projectRoot, DETECTOR_RELATIVE_PATH);
	return existsSync(scriptPath) ? { projectRoot, scriptPath } : null;
}

export function resolveTorchLayerTables({
	projectRoot,
}: {
	projectRoot: string;
}) {
	const configured = process.env.QCUT_JIANYING_SHOT_SPLIT_LAYER_TABLES;
	const tables = configured
		? {
				backbone: path.join(configured, "engine-4", "params.tsv"),
				predhead: path.join(configured, "engine-5", "params.tsv"),
			}
		: {
				backbone: path.join(projectRoot, LAYER_TABLE_RELATIVE_PATHS.backbone),
				predhead: path.join(projectRoot, LAYER_TABLE_RELATIVE_PATHS.predhead),
			};
	return existsSync(tables.backbone) && existsSync(tables.predhead)
		? tables
		: null;
}

export function torchModelPaths({ runtimeRoot }: { runtimeRoot: string }) {
	const [backbone, predhead] = SHOT_SPLIT_MODEL_RELATIVE_PATHS;
	return {
		backbone: path.join(runtimeRoot, backbone),
		predhead: path.join(runtimeRoot, predhead),
	};
}

let torchProbe: Promise<{ torchVersion: string } | null> | undefined;

async function probeTorch() {
	torchProbe ??= execFileAsync(
		pythonInterpreter(),
		["-c", "import torch; print(torch.__version__)"],
		{ maxBuffer: 64 * 1024, timeout: 60_000 }
	)
		.then(({ stdout }) => ({ torchVersion: stdout.trim() }))
		.catch(() => null);
	return torchProbe;
}

/** Reports whether the torch engine can run here; cheap after the first call. */
export async function inspectTorchEngine(): Promise<JianyingShotSplitTorchStatus> {
	const script = resolveTorchDetectorScript();
	if (!script) return { available: false, message: DETECTOR_MISSING_MESSAGE };
	if (!resolveTorchLayerTables({ projectRoot: script.projectRoot })) {
		return { available: false, message: LAYER_TABLES_MISSING_MESSAGE };
	}
	const probe = await probeTorch();
	if (!probe) return { available: false, message: TORCH_MISSING_MESSAGE };
	return {
		available: true,
		message: `PyTorch ${probe.torchVersion} 复现引擎已就绪`,
		python: pythonInterpreter(),
		torchVersion: probe.torchVersion,
	};
}

export function parseTorchProgressLine({
	line,
}: {
	line: string;
}): TorchProgress | null {
	const match = line.trim().match(PROGRESS_LINE);
	if (!match) return null;
	if (match[2]) return { fraction: 0.15, status: `已解码 ${match[2]} 帧` };
	if (match[1] === "loading models")
		return { fraction: 0.2, status: "正在装载 PyTorch 复现模型" };
	if (match[3]) {
		const done = Number(match[3]);
		const total = Number(match[4]);
		return {
			fraction: 0.2 + 0.6 * (total ? done / total : 0),
			status: `已提取特征 ${done}/${total} 帧`,
		};
	}
	const done = Number(match[5]);
	const total = Number(match[6]);
	return {
		fraction: 0.8 + 0.2 * (total ? done / total : 0),
		status: `已评估 ${done}/${total} 个窗口`,
	};
}

function isFrameList(value: unknown): value is number[] {
	return (
		Array.isArray(value) &&
		value.every((frame) => Number.isSafeInteger(frame) && frame >= 0)
	);
}

/** Throws when the detector's JSON is not the shape `detect_cuts_torch.py --json` prints. */
export function parseTorchDetectorOutput({
	stdout,
}: {
	stdout: string;
}): TorchDetectorOutput {
	const line = stdout
		.split("\n")
		.map((candidate) => candidate.trim())
		.filter((candidate) => candidate.startsWith("{"))
		.at(-1);
	if (!line) throw new Error("PyTorch 镜头分割引擎没有返回 JSON 结果");
	let value: Record<string, unknown>;
	try {
		value = JSON.parse(line) as Record<string, unknown>;
	} catch {
		throw new Error("PyTorch 镜头分割引擎返回的 JSON 无法解析");
	}
	if (value.engine !== "torch" || !isFrameList(value.cut_frames)) {
		throw new Error("PyTorch 镜头分割引擎返回了无效的切点");
	}
	if (
		!Number.isSafeInteger(value.frame_count) ||
		(value.frame_count as number) < 0
	) {
		throw new Error("PyTorch 镜头分割引擎返回了无效的帧数");
	}
	const scores = Array.isArray(value.scores)
		? (value.scores as unknown[]).filter(
				(entry): entry is [number, number] =>
					Array.isArray(entry) &&
					entry.length === 2 &&
					Number.isSafeInteger(entry[0]) &&
					Number.isFinite(entry[1])
			)
		: [];
	return {
		cutFrames: value.cut_frames,
		elapsedMs: Number.isFinite(value.elapsed_ms) ? Number(value.elapsed_ms) : 0,
		frameCount: value.frame_count as number,
		scores,
		torchVersion:
			typeof value.torch_version === "string" ? value.torch_version : "",
	};
}

export function buildTorchDetectorArguments({
	ffmpegPath,
	layerTables,
	models,
	sampling,
	scriptPath,
	sourcePath,
}: {
	ffmpegPath: string;
	layerTables: { backbone: string; predhead: string };
	models: { backbone: string; predhead: string };
	sampling: JianyingShotSplitSampling;
	scriptPath: string;
	sourcePath: string;
}) {
	return [
		scriptPath,
		models.backbone,
		layerTables.backbone,
		models.predhead,
		layerTables.predhead,
		"--video",
		sourcePath,
		"--fps",
		fpsText({ fps: sampling.fps }),
		"--width",
		String(sampling.width),
		"--height",
		String(sampling.height),
		"--ffmpeg",
		ffmpegPath,
		"--json",
	];
}

function terminate({ child }: { child: ChildProcess }) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	const escalate = setTimeout(() => child.kill("SIGKILL"), 5_000);
	escalate.unref();
}

/** Runs the detector as a child process; resolves with its parsed JSON output. */
export async function runTorchDetector({
	ffmpegPath,
	layerTables,
	models,
	onProgress,
	sampling,
	scriptPath,
	signal,
	sourcePath,
	timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
	ffmpegPath: string;
	layerTables: { backbone: string; predhead: string };
	models: { backbone: string; predhead: string };
	onProgress?: (progress: TorchProgress) => void;
	sampling: JianyingShotSplitSampling;
	scriptPath: string;
	signal?: AbortSignal;
	sourcePath: string;
	timeoutMs?: number;
}): Promise<TorchDetectorOutput> {
	if (signal?.aborted) throw shotSplitAbortError();
	const child = spawn(
		pythonInterpreter(),
		buildTorchDetectorArguments({
			ffmpegPath,
			layerTables,
			models,
			sampling,
			scriptPath,
			sourcePath,
		}),
		{
			env: { ...process.env, PYTHONUNBUFFERED: "1" },
			stdio: ["ignore", "pipe", "pipe"],
		}
	);
	let stdout = "";
	let stderr = "";
	let lineBuffer = "";
	child.stdout?.setEncoding("utf8");
	child.stderr?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => {
		stdout = (stdout + chunk).slice(-OUTPUT_LIMIT);
	});
	child.stderr?.on("data", (chunk: string) => {
		stderr = (stderr + chunk).slice(-OUTPUT_LIMIT);
		lineBuffer += chunk;
		const lines = lineBuffer.split("\n");
		lineBuffer = lines.pop() ?? "";
		for (const line of lines) {
			const progress = parseTorchProgressLine({ line });
			if (progress) onProgress?.(progress);
		}
	});
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		terminate({ child });
	}, timeoutMs);
	timeout.unref();
	const abort = () => terminate({ child });
	signal?.addEventListener("abort", abort, { once: true });
	try {
		const exit = await new Promise<{
			code: number | null;
			signal: string | null;
		}>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code, exitSignal) =>
				resolve({ code, signal: exitSignal })
			);
		});
		if (signal?.aborted) throw shotSplitAbortError();
		if (timedOut) {
			throw new Error(
				`PyTorch 镜头分割超过 ${Math.round(timeoutMs / 1000)} 秒未完成`
			);
		}
		if (exit.code !== 0) {
			const detail = stderr
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith("[progress]"))
				.at(-1);
			throw new Error(
				`PyTorch 镜头分割引擎退出码 ${exit.code ?? exit.signal}${detail ? `: ${detail}` : ""}`
			);
		}
		return parseTorchDetectorOutput({ stdout });
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abort);
	}
}

/** Maps the detector's cut frames to the shared result shape (same convention as the bridge). */
export function torchResultFromDetectorOutput({
	appVersion,
	coreUuid,
	durationSeconds,
	elapsedMs,
	output,
	sampling,
	sourcePath,
}: {
	appVersion: string;
	coreUuid: string;
	durationSeconds: number;
	elapsedMs: number;
	output: TorchDetectorOutput;
	sampling: JianyingShotSplitSampling;
	sourcePath: string;
}): JianyingShotSplitResult {
	return {
		...sampling,
		...shotBoundariesFromPredictResult({
			fps: sampling.fps,
			frameCount: output.frameCount,
			predictResult: output.cutFrames,
		}),
		appVersion,
		coreUuid,
		durationSeconds,
		elapsedMs,
		engine: "torch",
		frameCount: output.frameCount,
		route: JIANYING_SHOT_SPLIT_TORCH_ROUTE,
		scores: output.scores,
		sourcePath,
	};
}
