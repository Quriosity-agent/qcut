/**
 * Runs ffmpeg and the shot-split bridge as one streaming pipeline: decoded RGBA
 * frames flow through a named pipe straight into the bridge, so nothing is
 * spooled to disk and no JavaScript stream sits in the data path. The bridge
 * runs under sandbox-exec with networking denied.
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { JianyingShotSplitSampling } from "../jianying-shot-split-contract.js";
import { parseShotSplitProgressLine } from "./bridge-output.js";
import { buildShotSplitDecodeArguments, fpsText } from "./video-input.js";

const execFileAsync = promisify(execFile);
const NETWORK_DENY_PROFILE = "(version 1) (allow default) (deny network*)";
const OUTPUT_LIMIT = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60 * 60_000;

export function shotSplitAbortError() {
	const error = new Error("镜头分割已取消");
	error.name = "AbortError";
	return error;
}

function outputCollector({
	onLine,
	stream,
}: {
	onLine?: (line: string) => void;
	stream: NodeJS.ReadableStream | null;
}) {
	if (!stream) throw new Error("子进程没有可读取的输出流");
	let text = "";
	let lineBuffer = "";
	stream.setEncoding("utf8");
	stream.on("data", (chunk: string) => {
		text = (text + chunk).slice(-OUTPUT_LIMIT);
		if (!onLine) return;
		lineBuffer += chunk;
		const lines = lineBuffer.split("\n");
		lineBuffer = lines.pop() ?? "";
		for (const line of lines) onLine(line);
	});
	return () => text;
}

function waitForExit({
	child,
	getOutput,
	label,
}: {
	child: ChildProcess;
	getOutput: () => string;
	label: string;
}) {
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			reject(new Error(`${label}无法启动: ${error.message}`));
		});
		child.once("close", (code, signal) => {
			if (settled) return;
			settled = true;
			if (code === 0) {
				resolve();
				return;
			}
			const detail = getOutput().trim().split("\n").slice(-8).join("\n");
			reject(
				new Error(
					`${label}失败 (${signal ?? code ?? "unknown"})${detail ? `: ${detail}` : ""}`
				)
			);
		});
	});
}

function terminate({ child }: { child: ChildProcess }) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	try {
		child.kill("SIGKILL");
	} catch {
		// The process died in this window; `close` still settles the run.
	}
}

async function createFramePipe() {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), "qcut-shot-split-pipe-")
	);
	const framePath = path.join(directory, "frames.rgba");
	try {
		await execFileAsync("/usr/bin/mkfifo", [framePath], { timeout: 10_000 });
		return { directory, framePath };
	} catch (error) {
		await rm(directory, { force: true, recursive: true });
		throw error;
	}
}

export function buildShotSplitBridgeArguments({
	bridgePath,
	framePath,
	graphPath,
	runtimeRoot,
	sampling,
}: {
	bridgePath: string;
	framePath: string;
	graphPath: string;
	runtimeRoot: string;
	sampling: JianyingShotSplitSampling;
}) {
	return [
		"-p",
		NETWORK_DENY_PROFILE,
		bridgePath,
		runtimeRoot,
		"VESDK",
		"",
		graphPath,
		framePath,
		String(sampling.width),
		String(sampling.height),
		fpsText({ fps: sampling.fps }),
		"0",
		"1",
	];
}

export async function runShotSplitPipeline({
	bridgePath,
	ffmpegPath,
	graphPath,
	onFrameProgress,
	runtimeRoot,
	sampling,
	signal,
	sourcePath,
	timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
	bridgePath: string;
	ffmpegPath: string;
	graphPath: string;
	onFrameProgress?: (frames: number) => void;
	runtimeRoot: string;
	sampling: JianyingShotSplitSampling;
	signal?: AbortSignal;
	sourcePath: string;
	timeoutMs?: number;
}): Promise<{ stdout: string }> {
	if (signal?.aborted) throw shotSplitAbortError();
	const pipe = await createFramePipe();
	const decoder = spawn(
		ffmpegPath,
		buildShotSplitDecodeArguments({
			...sampling,
			rawPath: pipe.framePath,
			sourcePath,
		}),
		{ stdio: ["ignore", "ignore", "pipe"] }
	);
	const bridge = spawn(
		"/usr/bin/sandbox-exec",
		buildShotSplitBridgeArguments({
			bridgePath,
			framePath: pipe.framePath,
			graphPath,
			runtimeRoot,
			sampling,
		}),
		{ stdio: ["ignore", "pipe", "pipe"] }
	);
	const decoderStderr = outputCollector({ stream: decoder.stderr });
	const bridgeStdout = outputCollector({
		onLine: (line) => {
			const frames = parseShotSplitProgressLine({ line });
			if (frames !== null) onFrameProgress?.(frames);
		},
		stream: bridge.stdout,
	});
	const bridgeStderr = outputCollector({ stream: bridge.stderr });
	const children = [decoder, bridge];
	const killAll = () => {
		for (const child of children) terminate({ child });
	};
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		killAll();
	}, timeoutMs);
	timeout.unref();
	signal?.addEventListener("abort", killAll, { once: true });
	// One failure kills the other side: a decoder stuck opening the pipe or a
	// bridge blocked on it must not keep the pipeline alive.
	const settleAll = (promise: Promise<void>) =>
		promise.catch((error: unknown) => {
			killAll();
			throw error;
		});
	try {
		const [decoderExit, bridgeExit] = await Promise.allSettled([
			settleAll(
				waitForExit({
					child: decoder,
					getOutput: decoderStderr,
					label: `视频解码 (${path.basename(ffmpegPath)})`,
				})
			),
			settleAll(
				waitForExit({
					child: bridge,
					getOutput: () => `${bridgeStderr()}\n${bridgeStdout()}`,
					label: "本机镜头分割",
				})
			),
		]);
		if (signal?.aborted) throw shotSplitAbortError();
		if (timedOut) {
			throw new Error(`镜头分割超过 ${Math.round(timeoutMs / 1000)} 秒未完成`);
		}
		// A bridge crash also breaks the decoder's pipe, so report the bridge first.
		if (bridgeExit.status === "rejected") throw bridgeExit.reason;
		if (decoderExit.status === "rejected") throw decoderExit.reason;
		return { stdout: bridgeStdout() };
	} catch (error) {
		killAll();
		if (signal?.aborted) throw shotSplitAbortError();
		throw error;
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", killAll);
		await rm(pipe.directory, { force: true, recursive: true });
	}
}
