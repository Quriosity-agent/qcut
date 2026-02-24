/**
 * Transfer motion handler.
 * @module electron/native-pipeline/cli/cli-runner/handler-transfer
 */

import * as path from "path";
import { ModelRegistry } from "../../infra/registry.js";
import { PipelineExecutor } from "../../execution/executor.js";
import type { PipelineStep } from "../../execution/executor.js";
import { downloadOutput } from "../../infra/api-caller.js";
import { resolveOutputDir } from "../../output/output-utils.js";
import type { CLIRunOptions, CLIResult, ProgressFn } from "./types.js";

export async function handleTransferMotion(
	options: CLIRunOptions,
	onProgress: ProgressFn,
	executor: PipelineExecutor,
	signal: AbortSignal
): Promise<CLIResult> {
	if (!options.imageUrl) {
		return { success: false, error: "Missing --image-url" };
	}
	if (!options.videoUrl) {
		return { success: false, error: "Missing --video-url" };
	}

	const model = options.model || "kling_motion_control";
	if (!ModelRegistry.has(model)) {
		return { success: false, error: `Unknown model '${model}'` };
	}

	const startTime = Date.now();
	const sessionId = `cli-${Date.now()}`;
	const outputDir = resolveOutputDir(options.outputDir, sessionId);

	onProgress({
		stage: "transferring",
		percent: 0,
		message: "Transferring motion...",
		model,
	});

	const params: Record<string, unknown> = {};
	if (options.orientation) params.orientation = options.orientation;
	if (options.noSound) params.no_sound = true;
	if (options.prompt || options.text) {
		params.prompt = options.prompt || options.text;
	}

	const step: PipelineStep = {
		type: "avatar",
		model,
		params,
		enabled: true,
		retryCount: 0,
	};

	const result = await executor.executeStep(
		step,
		{ imageUrl: options.imageUrl, videoUrl: options.videoUrl },
		{ outputDir, signal }
	);

	if (!result.outputPath && result.outputUrl && outputDir) {
		try {
			result.outputPath = await downloadOutput(
				result.outputUrl,
				path.join(outputDir, `motion_${Date.now()}.mp4`)
			);
		} catch {
			/* URL still available */
		}
	}

	onProgress({ stage: "complete", percent: 100, message: "Done", model });

	return {
		success: result.success,
		outputPath: result.outputPath,
		error: result.error,
		cost: result.cost,
		duration: (Date.now() - startTime) / 1000,
	};
}
