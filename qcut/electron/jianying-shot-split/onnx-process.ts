import { type ChildProcess, execFile, spawn } from "node:child_process";
import { shotSplitAbortError } from "./process-pipeline.js";

const OUTPUT_LIMIT = 8 * 1024 * 1024;

function terminate({
	child,
	force = false,
}: {
	child: ChildProcess;
	force?: boolean;
}) {
	if (process.platform !== "win32" && child.pid) {
		// The isolated group includes FFmpeg, even if Python exits before cleanup.
		try {
			process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
		} catch {
			child.kill(force ? "SIGKILL" : "SIGTERM");
		}
		return;
	}
	if (child.exitCode !== null || child.signalCode !== null) return;
	if (process.platform === "win32" && child.pid) {
		// Windows TerminateProcess cannot run the Python FFmpeg cleanup handler.
		execFile(
			"taskkill",
			["/PID", String(child.pid), "/T", "/F"],
			{ windowsHide: true },
			() => {}
		);
		return;
	}
	child.kill("SIGTERM");
}

export async function runOnnxProcess({
	python,
	args,
	signal,
	onFrames,
	timeoutMs = 30 * 60_000,
}: {
	python: string;
	args: string[];
	signal?: AbortSignal;
	onFrames?: (frames: number) => void;
	timeoutMs?: number;
}): Promise<string> {
	if (signal?.aborted) throw shotSplitAbortError();
	const child = spawn(python, args, {
		env: { ...process.env, PYTHONUNBUFFERED: "1" },
		windowsHide: true,
		detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let lineBuffer = "";
	let failure: Error | undefined;
	let escalation: ReturnType<typeof setTimeout> | undefined;
	const stop = () => {
		terminate({ child });
		escalation ??= setTimeout(() => terminate({ child, force: true }), 5000);
		escalation.unref();
	};
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		if (failure) return;
		stdout += chunk;
		if (stdout.length > OUTPUT_LIMIT) {
			failure = new Error("ONNX shot output exceeded limit");
			stdout = "";
			stop();
		}
	});
	child.stderr.on("data", (chunk: string) => {
		stderr = (stderr + chunk).slice(-64 * 1024);
		lineBuffer = (lineBuffer + chunk).slice(-64 * 1024);
		const lines = lineBuffer.split("\n");
		lineBuffer = lines.pop() ?? "";
		for (const line of lines) {
			const match = line.match(/^\[progress\] frames (\d+)$/);
			if (match) onFrames?.(Number(match[1]));
		}
	});
	const timer = setTimeout(() => {
		failure = new Error("ONNX shot detection timed out");
		stop();
	}, timeoutMs);
	timer.unref();
	signal?.addEventListener("abort", stop, { once: true });
	if (signal?.aborted) stop();
	try {
		const code = await new Promise<number | null>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", resolve);
		});
		if (signal?.aborted) throw shotSplitAbortError();
		if (failure) throw failure;
		if (code !== 0)
			throw new Error(
				`ONNX shot detector exited (${code}): ${stderr.slice(-4096)}`
			);
		return stdout;
	} finally {
		clearTimeout(timer);
		clearTimeout(escalation);
		signal?.removeEventListener("abort", stop);
	}
}
