/**
 * Generate handler (image/video/avatar).
 * @module electron/native-pipeline/cli/cli-runner/handler-generate
 */

import * as path from "path";
import { ModelRegistry } from "../../infra/registry.js";
import { PipelineExecutor } from "../../execution/executor.js";
import type { PipelineStep } from "../../execution/executor.js";
import { estimateCost } from "../../infra/cost-calculator.js";
import { downloadOutput } from "../../infra/api-caller.js";
import { resolveOutputDir } from "../../output/output-utils.js";
import type { CLIRunOptions, CLIResult, ProgressFn } from "./types.js";
import { guessExtFromCommand } from "./progress.js";

export async function handleGenerate(
	options: CLIRunOptions,
	onProgress: ProgressFn,
	executor: PipelineExecutor,
	signal: AbortSignal
): Promise<CLIResult> {
	if (!options.model) {
		if (options.command === "generate-image") {
			options.model = "nano_banana_pro";
		} else {
			return {
				success: false,
				error: "Missing --model. Run --help for usage.",
			};
		}
	}
	if (!ModelRegistry.has(options.model)) {
		return {
			success: false,
			error: `Unknown model '${options.model}'. Run list-models to see available models.`,
		};
	}

	const hasTextInput = !!options.text;
	const hasImageInput = !!options.imageUrl;
	const hasAudioInput = !!options.audioUrl;

	if (options.command === "generate-image" && !hasTextInput) {
		return {
			success: false,
			error: "Missing --text/-t (prompt for image generation).",
		};
	}
	if (options.command === "create-video" && !hasTextInput && !hasImageInput) {
		return {
			success: false,
			error: "Missing --text/-t or --image-url (need a prompt or image input).",
		};
	}
	if (
		options.command === "generate-avatar" &&
		!hasTextInput &&
		!hasAudioInput
	) {
		return {
			success: false,
			error: "Missing --text/-t or --audio-url (need a script or audio input).",
		};
	}

	const startTime = Date.now();
	const model = ModelRegistry.get(options.model);
	const sessionId = `cli-${Date.now()}`;
	const outputDir = resolveOutputDir(options.outputDir, sessionId);

	const params: Record<string, unknown> = {};
	if (options.duration) params.duration = options.duration;
	if (options.aspectRatio) params.aspect_ratio = options.aspectRatio;
	if (options.resolution) params.resolution = options.resolution;
	if (options.negativePrompt) params.negative_prompt = options.negativePrompt;
	if (options.voiceId) params.voice_id = options.voiceId;

	if (options.command === "generate-avatar") {
		if (options.referenceImages && options.referenceImages.length > 0) {
			params.reference_images = options.referenceImages.slice(0, 4);
		}
	}

	onProgress({
		stage: "starting",
		percent: 0,
		message: `Starting ${model.name}...`,
		model: options.model,
	});

	const step: PipelineStep = {
		type: model.categories[0],
		model: options.model,
		params,
		enabled: true,
		retryCount: 0,
	};

	const input = {
		text: options.text,
		imageUrl: options.imageUrl,
		videoUrl: options.videoUrl,
		audioUrl: options.audioUrl,
	};

	const result = await executor.executeStep(step, input, {
		outputDir,
		onProgress: (percent, message) => {
			onProgress({
				stage: "processing",
				percent,
				message,
				model: options.model,
			});
		},
		signal,
	});

	if (!result.success) {
		return {
			success: false,
			error: result.error,
			duration: (Date.now() - startTime) / 1000,
		};
	}

	if (!result.outputPath && result.outputUrl && outputDir) {
		const ext = guessExtFromCommand(options.command);
		const filename = `output_${Date.now()}${ext}`;
		const destPath = path.join(outputDir, filename);
		try {
			result.outputPath = await downloadOutput(result.outputUrl, destPath);
		} catch {
			// URL still available in result
		}
	}

	onProgress({
		stage: "complete",
		percent: 100,
		message: "Done",
		model: options.model,
	});

	const cost = result.cost ?? estimateCost(options.model!, params).totalCost;

	return {
		success: true,
		outputPath: result.outputPath,
		outputPaths: result.outputPath ? [result.outputPath] : undefined,
		cost,
		duration: (Date.now() - startTime) / 1000,
	};
}
