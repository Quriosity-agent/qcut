/**
 * Grid generation handler.
 * @module electron/native-pipeline/cli/cli-runner/handler-grid
 */

import * as path from "path";
import { ModelRegistry } from "../../infra/registry.js";
import { PipelineExecutor } from "../../execution/executor.js";
import type { PipelineStep } from "../../execution/executor.js";
import { downloadOutput } from "../../infra/api-caller.js";
import { resolveOutputDir } from "../../output/output-utils.js";
import {
	compositeGrid,
	getGridImageCount,
} from "../../output/grid-generator.js";
import type { CLIRunOptions, CLIResult, ProgressFn } from "./types.js";

export async function handleGenerateGrid(
	options: CLIRunOptions,
	onProgress: ProgressFn,
	executor: PipelineExecutor,
	signal: AbortSignal
): Promise<CLIResult> {
	const text = options.text;
	if (!text) {
		return {
			success: false,
			error: "Missing --text/-t (prompt for grid images)",
		};
	}

	const model = options.model || "flux_dev";
	if (!ModelRegistry.has(model)) {
		return { success: false, error: `Unknown model '${model}'` };
	}

	const layout = options.layout || "2x2";
	const count = getGridImageCount(layout);
	const startTime = Date.now();
	const sessionId = `cli-${Date.now()}`;
	const outputDir = resolveOutputDir(options.outputDir, sessionId);

	onProgress({
		stage: "generating",
		percent: 0,
		message: `Generating ${count} images...`,
		model,
	});

	const promptText = options.style ? `${options.style}, ${text}` : text;

	const imagePaths: string[] = [];
	for (let i = 0; i < count; i++) {
		const step: PipelineStep = {
			type: "text_to_image",
			model,
			params: { prompt: promptText },
			enabled: true,
			retryCount: 0,
		};

		const result = await executor.executeStep(
			step,
			{ text: promptText },
			{
				outputDir,
				signal,
			}
		);

		if (!result.success) {
			return {
				success: false,
				error: `Image ${i + 1} failed: ${result.error}`,
			};
		}

		if (result.outputPath) imagePaths.push(result.outputPath);
		else if (result.outputUrl) {
			try {
				const dl = await downloadOutput(
					result.outputUrl,
					path.join(outputDir, `grid_${i}.png`)
				);
				imagePaths.push(dl);
			} catch {
				return {
					success: false,
					error: `Failed to download image ${i + 1}`,
				};
			}
		}

		onProgress({
			stage: "generating",
			percent: Math.round(((i + 1) / count) * 80),
			message: `Generated image ${i + 1}/${count}`,
			model,
		});
	}

	onProgress({
		stage: "compositing",
		percent: 85,
		message: "Creating grid...",
		model,
	});

	const gridResult = await compositeGrid(imagePaths, {
		layout: layout as "2x2" | "3x3" | "2x3" | "3x2" | "1x2" | "2x1",
		gap: 4,
		backgroundColor: "#000000",
		outputPath: path.join(outputDir, `grid_${Date.now()}.png`),
	});

	if (!gridResult.success) {
		return {
			success: false,
			error: gridResult.error,
			duration: (Date.now() - startTime) / 1000,
		};
	}

	let finalOutputPath = gridResult.outputPath;
	if (options.gridUpscale && gridResult.outputPath) {
		onProgress({
			stage: "upscaling",
			percent: 90,
			message: `Upscaling grid ${options.gridUpscale}x...`,
			model,
		});

		const upscaleStep: PipelineStep = {
			type: "image_to_image",
			model: "topaz",
			params: { upscale_factor: options.gridUpscale },
			enabled: true,
			retryCount: 0,
		};

		const upscaleResult = await executor.executeStep(
			upscaleStep,
			{ imageUrl: gridResult.outputPath },
			{ outputDir, signal }
		);

		if (upscaleResult.success && upscaleResult.outputPath) {
			finalOutputPath = upscaleResult.outputPath;
		} else if (upscaleResult.outputUrl) {
			try {
				finalOutputPath = await downloadOutput(
					upscaleResult.outputUrl,
					path.join(outputDir, `grid_upscaled_${Date.now()}.png`)
				);
			} catch {
				/* fallback to original grid */
			}
		}
	}

	onProgress({ stage: "complete", percent: 100, message: "Done", model });

	const resolvedOutputPath =
		finalOutputPath || (imagePaths.length > 0 ? imagePaths[0] : undefined);

	return {
		success: true,
		outputPath: resolvedOutputPath,
		outputPaths: imagePaths,
		duration: (Date.now() - startTime) / 1000,
	};
}
