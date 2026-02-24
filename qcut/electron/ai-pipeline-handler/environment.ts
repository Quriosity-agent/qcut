/**
 * Environment detection for AI Pipeline.
 * @module electron/ai-pipeline-handler/environment
 */

import { exec } from "child_process";
import { promisify } from "util";
import { app } from "electron";
import { BinaryManager } from "../binary-manager.js";
import type { PipelineConfig } from "./types.js";

const execAsync = promisify(exec);

/** Return a safe default config when environment detection fails. */
export function getFallbackConfig(): PipelineConfig {
	return { useBundledBinary: false };
}

/** Check if the bundled AICP binary is available and compatible. */
export function getBundledConfig(
	binaryManager: BinaryManager
): PipelineConfig | null {
	const status = binaryManager.getBinaryStatus("aicp");
	if (status.available && status.compatible) {
		console.log(
			`[AI Pipeline] Using bundled binary v${status.version}:`,
			status.path
		);
		return {
			useBundledBinary: true,
			binaryPath: status.path!,
			version: status.version!,
		};
	}

	if (!status.available) {
		console.log("[AI Pipeline] Bundled binary not found, trying fallbacks...");
	} else if (!status.compatible) {
		console.warn(
			`[AI Pipeline] Bundled binary v${status.version} not compatible with QCut v${app.getVersion()}`
		);
	}

	return null;
}

/** Run a version command and return the output, or null on failure. */
export async function getVersionFromCommand({
	command,
	label,
	timeoutMs,
}: {
	command: string;
	label: string;
	timeoutMs: number;
}): Promise<string | null> {
	try {
		const output = await execCommand({ command, timeoutMs });
		const version = output.trim();
		if (!version) {
			return null;
		}
		console.log(`[AI Pipeline] Using ${label}:`, version);
		return version;
	} catch {
		return null;
	}
}

/** Execute a shell command with timeout and return stdout. */
export async function execCommand({
	command,
	timeoutMs,
}: {
	command: string;
	timeoutMs: number;
}): Promise<string> {
	const result = await execAsync(command, {
		timeout: timeoutMs,
		windowsHide: true,
	});
	const stdout = result.stdout;
	return typeof stdout === "string" ? stdout : String(stdout);
}

/**
 * Detect available AI pipeline binary/module
 * Priority: Bundled binary > System aicp > Python module
 */
export async function detectEnvironment(
	binaryManager: BinaryManager
): Promise<PipelineConfig> {
	try {
		const bundledConfig = getBundledConfig(binaryManager);
		if (bundledConfig) {
			return bundledConfig;
		}

		if (app.isPackaged) {
			console.warn(
				"[AI Pipeline] Packaged mode requires bundled AICP binary; skipping system/Python fallbacks"
			);
			return getFallbackConfig();
		}

		const commandTimeoutMs = 5000;
		const systemVersion = await getVersionFromCommand({
			command: "aicp --version",
			label: "system aicp",
			timeoutMs: commandTimeoutMs,
		});
		if (systemVersion) {
			return {
				useBundledBinary: false,
				binaryPath: "aicp",
				version: systemVersion,
			};
		}

		const pythonVersion = await getVersionFromCommand({
			command: "python -m ai_content_pipeline --version",
			label: "Python module",
			timeoutMs: commandTimeoutMs,
		});
		if (pythonVersion) {
			return {
				useBundledBinary: false,
				pythonPath: "python",
				version: pythonVersion,
			};
		}

		if (process.platform !== "win32") {
			const python3Version = await getVersionFromCommand({
				command: "python3 -m ai_content_pipeline --version",
				label: "Python3 module",
				timeoutMs: commandTimeoutMs,
			});
			if (python3Version) {
				return {
					useBundledBinary: false,
					pythonPath: "python3",
					version: python3Version,
				};
			}
		}
	} catch (error) {
		console.error("[AI Pipeline] Failed to detect environment:", error);
	}

	console.warn("[AI Pipeline] No AI pipeline binary or Python module found");
	return getFallbackConfig();
}
