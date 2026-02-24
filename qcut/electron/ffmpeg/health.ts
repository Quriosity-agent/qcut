/**
 * FFmpeg Health Check
 */

import { spawn } from "node:child_process";
import type { FFmpegHealthResult } from "./types";
import { getFFmpegPath, getFFprobePath } from "./paths";
import { debugError, debugLog } from "./constants";

// ============================================================================
// Health Check
// ============================================================================

/** Timeout for health check spawn (ms) */
const HEALTH_CHECK_TIMEOUT = 5000;

/**
 * Spawns a binary with `-version` and extracts the version string.
 */
function checkBinaryVersion(
	binaryPath: string,
	binaryName: string
): Promise<{ ok: boolean; version: string; error: string }> {
	return new Promise((resolve) => {
		try {
			const proc = spawn(binaryPath, ["-version"], {
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});

			const timeoutId = setTimeout(() => {
				proc.kill();
				resolve({
					ok: false,
					version: "",
					error: `${binaryName} timed out after ${HEALTH_CHECK_TIMEOUT}ms`,
				});
			}, HEALTH_CHECK_TIMEOUT);

			let stdout = "";

			proc.stdout?.on("data", (data: Buffer) => {
				stdout += data.toString();
			});

			proc.on("close", (code: number | null) => {
				clearTimeout(timeoutId);
				if (code === 0) {
					const firstLine = stdout.split("\n")[0] ?? "";
					const versionMatch = firstLine.match(/version\s+([\d.]+)/);
					resolve({
						ok: true,
						version: versionMatch?.[1] ?? "unknown",
						error: "",
					});
				} else {
					resolve({
						ok: false,
						version: "",
						error: `${binaryName} exited with code ${code}`,
					});
				}
			});

			proc.on("error", (err: Error) => {
				clearTimeout(timeoutId);
				resolve({
					ok: false,
					version: "",
					error: `${binaryName} spawn error: ${err.message}`,
				});
			});
		} catch (err: unknown) {
			resolve({
				ok: false,
				version: "",
				error: `${binaryName} check failed: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	});
}

/**
 * Verifies FFmpeg and FFprobe binaries are executable at runtime.
 */
export async function verifyFFmpegBinary(): Promise<FFmpegHealthResult> {
	const ffmpegPath = getFFmpegPath();
	const ffprobePath = await getFFprobePath();

	debugLog("Health: Checking binary availability...");
	debugLog(`Health: FFmpeg path: ${ffmpegPath}`);
	debugLog(`Health: FFprobe path: ${ffprobePath}`);

	const [ffmpegResult, ffprobeResult] = await Promise.all([
		checkBinaryVersion(ffmpegPath, "FFmpeg"),
		checkBinaryVersion(ffprobePath, "FFprobe"),
	]);

	const errors: string[] = [];
	if (!ffmpegResult.ok) errors.push(ffmpegResult.error);
	if (!ffprobeResult.ok) errors.push(ffprobeResult.error);

	const result: FFmpegHealthResult = {
		ffmpegOk: ffmpegResult.ok,
		ffprobeOk: ffprobeResult.ok,
		ffmpegVersion: ffmpegResult.version,
		ffprobeVersion: ffprobeResult.version,
		ffmpegPath,
		ffprobePath,
		errors,
	};

	if (result.ffmpegOk && result.ffprobeOk) {
		debugLog(
			`Health: OK — FFmpeg ${result.ffmpegVersion}, FFprobe ${result.ffprobeVersion}`
		);
	} else {
		debugError("Health: FAILED:", errors.join("; "));
	}

	return result;
}
