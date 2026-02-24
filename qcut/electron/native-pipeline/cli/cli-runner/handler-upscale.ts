/**
 * Upscale image handler.
 * @module electron/native-pipeline/cli/cli-runner/handler-upscale
 */

import * as path from "path";
import { ModelRegistry } from "../../infra/registry.js";
import { PipelineExecutor } from "../../execution/executor.js";
import type { PipelineStep } from "../../execution/executor.js";
import { downloadOutput } from "../../infra/api-caller.js";
import { resolveOutputDir } from "../../output/output-utils.js";
import type { CLIRunOptions, CLIResult, ProgressFn } from "./types.js";

export async function handleUpscaleImage(
	options: CLIRunOptions,
	onProgress: ProgressFn,
	executor: PipelineExecutor,
	signal: AbortSignal
): Promise<CLIResult> {
	const imageInput = options.image || options.imageUrl || options.input;
	if (!imageInput) {
		return { success: false, error: "Missing --image or --image-url" };
	}

	const model = options.model || "topaz";
	if (!ModelRegistry.has(model)) {
		return { success: false, error: `Unknown model '${model}'` };
	}

	const startTime = Date.now();
	const sessionId = `cli-${Date.now()}`;
	const outputDir = resolveOutputDir(options.outputDir, sessionId);

	onProgress({
		stage: "upscaling",
		percent: 0,
		message: "Upscaling image...",
		model,
	});

	const params: Record<string, unknown> = {};
	if (options.upscale) {
		const factor = parseInt(options.upscale, 10);
		if (Number.isNaN(factor) || factor <= 0) {
			return { success: false, error: `Invalid --upscale value: ${options.upscale}` };
		}
		params.upscale_factor = factor;
	}

	if (options.target) {
		const targetMap: Record<string, number> = {
			"720p": 1,
			"1080p": 2,
			"1440p": 3,
			"2160p": 4,
		};
		const factor = targetMap[options.target];
		if (factor) {
			params.upscale_factor = factor;
			params.target_resolution = options.target;
		}
	}

	const step: PipelineStep = {
		type: "image_to_image",
		model,
		params,
		enabled: true,
		retryCount: 0,
	};

	const result = await executor.executeStep(
		step,
		{ imageUrl: imageInput },
		{
			outputDir,
			signal,
		}
	);

	const format = options.outputFormat?.toLowerCase();
	if (format && !/^[a-z0-9]+$/.test(format)) {
		return { success: false, error: "Invalid --format value" };
	}
	const outputExt = format ? `.${format}` : ".png";

	if (!result.outputPath && result.outputUrl && outputDir) {
		try {
			result.outputPath = await downloadOutput(
				result.outputUrl,
				path.join(outputDir, `upscaled_${Date.now()}${outputExt}`)
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
