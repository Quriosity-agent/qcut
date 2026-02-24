/**
 * Command building helpers for AI Pipeline.
 * @module electron/ai-pipeline-handler/command-builder
 */

import { randomUUID } from "crypto";
import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
import { getDecryptedApiKeys } from "../api-key-handler.js";
import type { GenerateOptions } from "./types.js";

/** Generate a unique session ID for pipeline execution tracking. */
export function buildSessionId(): string {
	try {
		return `ai-${randomUUID()}`;
	} catch (error) {
		console.warn(
			"[AI Pipeline] Failed to generate UUID, falling back to timestamp:",
			error
		);
		return `ai-${Date.now()}-${process.pid}`;
	}
}

/** Determine whether to request JSON output from the pipeline binary. */
export function shouldUseJsonOutput({
	command,
	args,
}: {
	command: GenerateOptions["command"];
	args: GenerateOptions["args"];
}): boolean {
	try {
		if (args["no-json"]) {
			return false;
		}
		return command !== "list-models";
	} catch (error) {
		console.warn("[AI Pipeline] Failed to decide JSON output flag:", error);
		return true;
	}
}

/** Check if the given command supports an --output-dir flag. */
export function commandSupportsOutputDir({
	command,
}: {
	command: GenerateOptions["command"];
}): boolean {
	try {
		return (
			command === "generate-image" ||
			command === "create-video" ||
			command === "generate-avatar" ||
			command === "run-pipeline"
		);
	} catch (error) {
		console.warn("[AI Pipeline] Failed to check output-dir support:", error);
		return false;
	}
}

/** Check if the given command requires a FAL API key to run. */
export function commandRequiresFalKey({
	command,
}: {
	command: GenerateOptions["command"];
}): boolean {
	try {
		return (
			command === "generate-image" ||
			command === "create-video" ||
			command === "generate-avatar" ||
			command === "run-pipeline"
		);
	} catch (error) {
		console.warn("[AI Pipeline] Failed to check key requirement:", error);
		return false;
	}
}

/** Resolve and create the output directory for a pipeline run. */
export function resolveOutputDirectory({
	options,
	sessionId,
}: {
	options: GenerateOptions;
	sessionId: string;
}): string | null {
	try {
		if (!commandSupportsOutputDir({ command: options.command })) {
			return null;
		}

		let outputDir = options.outputDir;
		if (!outputDir) {
			outputDir = path.join(
				app.getPath("temp"),
				"qcut",
				"aicp-output",
				sessionId
			);
		}

		fs.mkdirSync(outputDir, { recursive: true });
		return outputDir;
	} catch (error) {
		console.warn("[AI Pipeline] Failed to prepare output directory:", error);
		return options.outputDir || null;
	}
}

/** Build the environment variables for spawning the pipeline process, including decrypted API keys. */
export async function buildSpawnEnvironment(): Promise<NodeJS.ProcessEnv> {
	const spawnEnv: NodeJS.ProcessEnv = { ...process.env };

	try {
		const storedKeys = await getDecryptedApiKeys();
		if (storedKeys.falApiKey) {
			spawnEnv.FAL_KEY = storedKeys.falApiKey;
			spawnEnv.FAL_API_KEY = storedKeys.falApiKey;
		}
		if (storedKeys.geminiApiKey) {
			spawnEnv.GEMINI_API_KEY = storedKeys.geminiApiKey;
		}
	} catch (error) {
		console.warn("[AI Pipeline] Failed to load stored API keys:", error);
	}

	return spawnEnv;
}

/** Get execution timeout from env or default (10 minutes). */
export function getExecutionTimeoutMs(): number {
	const defaultTimeoutMs = 10 * 60 * 1000;
	const rawTimeout = process.env.QCUT_AICP_TIMEOUT_MS;

	if (!rawTimeout) {
		return defaultTimeoutMs;
	}

	try {
		const parsedTimeout = Number(rawTimeout);
		if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
			console.warn(
				`[AI Pipeline] Invalid QCUT_AICP_TIMEOUT_MS value: "${rawTimeout}", using default`
			);
			return defaultTimeoutMs;
		}
		return parsedTimeout;
	} catch (error) {
		console.warn(
			"[AI Pipeline] Failed to parse QCUT_AICP_TIMEOUT_MS, using default:",
			error
		);
		return defaultTimeoutMs;
	}
}

/** Get default features when manifest is not available */
export function getDefaultFeatures(): Record<string, boolean> {
	return {
		textToVideo: true,
		imageToVideo: true,
		avatarGeneration: true,
		videoUpscale: true,
		yamlPipelines: true,
	};
}
