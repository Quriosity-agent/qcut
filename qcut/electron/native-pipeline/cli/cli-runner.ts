/**
 * CLI Pipeline Runner
 *
 * Bridges parsed CLI arguments to native pipeline modules.
 * No Electron dependencies — runs with plain bun/node.
 *
 * @module electron/native-pipeline/cli-runner
 */

import * as fs from "fs";
import * as path from "path";
import { ModelRegistry } from "../infra/registry.js";
import { PipelineExecutor } from "../execution/executor.js";
import type { PipelineStep } from "../execution/executor.js";
import { ParallelPipelineExecutor } from "../execution/parallel-executor.js";
import { parseChainConfig, validateChain } from "../execution/chain-parser.js";
import {
	estimateCost,
	estimatePipelineCost,
} from "../infra/cost-calculator.js";
import {
	downloadOutput,
	setApiKeyProvider,
	envApiKeyProvider,
} from "../infra/api-caller.js";
import { resolveOutputDir } from "../output/output-utils.js";
import { compositeGrid, getGridImageCount } from "../output/grid-generator.js";
import { loadEnvFile } from "../infra/key-manager.js";
import { isInteractive, confirm, readStdin } from "../cli/interactive.js";
import {
	handleAnalyzeVideo as mediaHandleAnalyzeVideo,
	handleTranscribe as mediaHandleTranscribe,
	handleQueryVideo as mediaHandleQueryVideo,
} from "./cli-handlers-media.js";
import { handleGenerateRemotion } from "./cli-handlers-remotion.js";
import {
	handleSetup as adminHandleSetup,
	handleSetKey as adminHandleSetKey,
	handleGetKey as adminHandleGetKey,
	handleCheckKeys as adminHandleCheckKeys,
	handleDeleteKey as adminHandleDeleteKey,
	handleInitProject as adminHandleInitProject,
	handleOrganizeProject as adminHandleOrganizeProject,
	handleStructureInfo as adminHandleStructureInfo,
	handleCreateExamples as adminHandleCreateExamples,
	handleListModels as adminHandleListModels,
	handleEstimateCost as adminHandleEstimateCost,
} from "./cli-handlers-admin.js";
import { handleEditorCommand } from "./cli-handlers-editor.js";
import {
	handleVimaxExtractCharacters,
	handleVimaxGenerateScript,
	handleVimaxGenerateStoryboard,
	handleVimaxGeneratePortraits,
	handleVimaxCreateRegistry,
	handleVimaxShowRegistry,
	handleVimaxListModels,
	handleVimaxIdea2Video,
	handleVimaxScript2Video,
	handleVimaxNovel2Movie,
} from "./vimax-cli-handlers.js";

export interface CLIRunOptions {
	command: string;
	model?: string;
	text?: string;
	imageUrl?: string;
	videoUrl?: string;
	audioUrl?: string;
	outputDir: string;
	config?: string;
	input?: string;
	duration?: string;
	aspectRatio?: string;
	resolution?: string;
	saveIntermediates: boolean;
	parallel?: boolean;
	maxWorkers?: number;
	json: boolean;
	verbose: boolean;
	quiet: boolean;
	category?: string;
	prompt?: string;
	layout?: string;
	upscale?: string;
	keyName?: string;
	keyValue?: string;
	idea?: string;
	script?: string;
	novel?: string;
	title?: string;
	maxScenes?: number;
	scriptsOnly?: boolean;
	storyboardOnly?: boolean;
	noPortraits?: boolean;
	llmModel?: string;
	imageModel?: string;
	videoModel?: string;
	image?: string;
	stream?: boolean;
	configDir?: string;
	cacheDir?: string;
	stateDir?: string;
	negativePrompt?: string;
	voiceId?: string;
	directory?: string;
	dryRun?: boolean;
	recursive?: boolean;
	includeOutput?: boolean;
	source?: string;
	reveal?: boolean;
	noConfirm?: boolean;
	promptFile?: string;
	portraits?: string;
	views?: string;
	maxCharacters?: number;
	saveRegistry?: boolean;
	style?: string;
	referenceModel?: string;
	referenceStrength?: number;
	// transcribe options
	language?: string;
	noDiarize?: boolean;
	noTagEvents?: boolean;
	keyterms?: string[];
	srt?: boolean;
	srtMaxWords?: number;
	srtMaxDuration?: number;
	rawJson?: boolean;
	// transfer-motion options
	orientation?: string;
	noSound?: boolean;
	// generate-avatar options
	referenceImages?: string[];
	// analyze-video options
	analysisType?: string;
	outputFormat?: string;
	// upscale-image options
	target?: string;
	// vimax options
	noReferences?: boolean;
	projectId?: string;
	// grid upscale
	gridUpscale?: number;
	// editor options
	mediaId?: string;
	elementId?: string;
	jobId?: string;
	trackId?: string;
	toTrack?: string;
	splitTime?: number;
	startTime?: number;
	endTime?: number;
	newName?: string;
	changes?: string;
	updates?: string;
	elements?: string;
	cuts?: string;
	items?: string;
	preset?: string;
	threshold?: number;
	timestamps?: string;
	host?: string;
	port?: string;
	token?: string;
	poll?: boolean;
	pollInterval?: number;
	replace?: boolean;
	ripple?: boolean;
	crossTrackRipple?: boolean;
	removeFillers?: boolean;
	removeSilences?: boolean;
	html?: string;
	message?: string;
	stack?: string;
	addToTimeline?: boolean;
	includeFillers?: boolean;
	includeSilences?: boolean;
	includeScenes?: boolean;
	toolName?: string;
	clearLog?: boolean;
	data?: string;
	url?: string;
	filename?: string;
	mode?: string;
	gap?: number;
	// generate-remotion options
	fps?: number;
	width?: number;
	height?: number;
	timeout?: number;
	provider?: string;
	loadSpeech?: boolean;
	// screen-recording options
	sourceId?: string;
	discard?: boolean;
}

export interface CLIResult {
	success: boolean;
	outputPath?: string;
	outputPaths?: string[];
	error?: string;
	cost?: number;
	duration?: number;
	data?: unknown;
}

type ProgressFn = (progress: {
	stage: string;
	percent: number;
	message: string;
	model?: string;
}) => void;

export class CLIPipelineRunner {
	private executor = new PipelineExecutor();
	private abortController = new AbortController();

	constructor() {
		setApiKeyProvider(envApiKeyProvider);
	}

	get signal(): AbortSignal {
		return this.abortController.signal;
	}

	abort(): void {
		this.abortController.abort();
	}

	async run(
		options: CLIRunOptions,
		onProgress: ProgressFn
	): Promise<CLIResult> {
		loadEnvFile(options.configDir);

		// Stdin pipe support: when --input is "-", read from stdin
		if (options.input === "-") {
			try {
				options.input = await readStdin();
			} catch (err) {
				return {
					success: false,
					error: `Failed to read stdin: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
		}

		switch (options.command) {
			case "list-models":
				return adminHandleListModels(options);
			case "estimate-cost":
				return adminHandleEstimateCost(options);
			case "generate-image":
			case "create-video":
			case "generate-avatar":
				return this.handleGenerate(options, onProgress);
			case "run-pipeline":
				return this.handleRunPipeline(options, onProgress);
			case "analyze-video":
				return mediaHandleAnalyzeVideo(
					options,
					onProgress,
					this.executor,
					this.signal
				);
			case "query-video":
				return mediaHandleQueryVideo(
					options,
					onProgress,
					this.executor,
					this.signal
				);
			case "transcribe":
				return mediaHandleTranscribe(
					options,
					onProgress,
					this.executor,
					this.signal
				);
			case "generate-remotion":
				return handleGenerateRemotion(options, onProgress, null, this.signal);
			case "transfer-motion":
				return this.handleTransferMotion(options, onProgress);
			case "generate-grid":
				return this.handleGenerateGrid(options, onProgress);
			case "upscale-image":
				return this.handleUpscaleImage(options, onProgress);
			case "setup":
				return adminHandleSetup();
			case "set-key":
				return adminHandleSetKey(options);
			case "get-key":
				return adminHandleGetKey(options);
			case "check-keys":
				return adminHandleCheckKeys();
			case "delete-key":
				return adminHandleDeleteKey(options);
			case "init-project":
				return adminHandleInitProject(options);
			case "organize-project":
				return adminHandleOrganizeProject(options);
			case "structure-info":
				return adminHandleStructureInfo(options);
			case "create-examples":
				return adminHandleCreateExamples(options);
			case "vimax:idea2video":
				return handleVimaxIdea2Video(options, onProgress);
			case "vimax:script2video":
				return handleVimaxScript2Video(options, onProgress);
			case "vimax:novel2movie":
				return handleVimaxNovel2Movie(options, onProgress);
			case "vimax:extract-characters":
				return handleVimaxExtractCharacters(options, onProgress);
			case "vimax:generate-script":
				return handleVimaxGenerateScript(options, onProgress);
			case "vimax:generate-storyboard":
				return handleVimaxGenerateStoryboard(options, onProgress);
			case "vimax:generate-portraits":
				return handleVimaxGeneratePortraits(options, onProgress);
			case "vimax:create-registry":
				return handleVimaxCreateRegistry(options);
			case "vimax:show-registry":
				return handleVimaxShowRegistry(options);
			case "vimax:list-models":
				return handleVimaxListModels();
			case "list-avatar-models":
				return adminHandleListModels({ ...options, category: "avatar" });
			case "list-video-models":
				return adminHandleListModels({
					...options,
					category: "text_to_video",
				});
			case "list-motion-models":
				return adminHandleListModels({
					...options,
					category: "motion_transfer",
				});
			case "list-speech-models":
				return adminHandleListModels({
					...options,
					category: "text_to_speech",
				});
			default:
				if (options.command.startsWith("editor:")) {
					return handleEditorCommand(options, onProgress);
				}
				return { success: false, error: `Unknown command: ${options.command}` };
		}
	}

	private async handleGenerate(
		options: CLIRunOptions,
		onProgress: ProgressFn
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

		// Validate required input before attempting API calls
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
				error:
					"Missing --text/-t or --image-url (need a prompt or image input).",
			};
		}
		if (
			options.command === "generate-avatar" &&
			!hasTextInput &&
			!hasAudioInput
		) {
			return {
				success: false,
				error:
					"Missing --text/-t or --audio-url (need a script or audio input).",
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

		// Smart mode detection for generate-avatar (matches Python logic)
		if (options.command === "generate-avatar") {
			if (options.referenceImages && options.referenceImages.length > 0) {
				// Reference-image-based video generation
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

		const result = await this.executor.executeStep(step, input, {
			outputDir,
			onProgress: (percent, message) => {
				onProgress({
					stage: "processing",
					percent,
					message,
					model: options.model,
				});
			},
			signal: this.abortController.signal,
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

		// Use executor cost if available, otherwise estimate from model registry
		const cost = result.cost ?? estimateCost(options.model!, params).totalCost;

		return {
			success: true,
			outputPath: result.outputPath,
			outputPaths: result.outputPath ? [result.outputPath] : undefined,
			cost,
			duration: (Date.now() - startTime) / 1000,
		};
	}

	private async handleRunPipeline(
		options: CLIRunOptions,
		onProgress: ProgressFn
	): Promise<CLIResult> {
		if (!options.config) {
			return {
				success: false,
				error: "Missing --config. Run --help for usage.",
			};
		}

		let yamlContent: string;
		try {
			yamlContent = fs.readFileSync(options.config, "utf-8");
		} catch {
			return { success: false, error: `Cannot read config: ${options.config}` };
		}

		const chain = parseChainConfig(yamlContent);
		const validation = validateChain(chain);
		if (!validation.valid) {
			return {
				success: false,
				error: `Pipeline validation failed:\n  ${validation.errors.join("\n  ")}`,
			};
		}

		const startTime = Date.now();
		const sessionId = `cli-${Date.now()}`;
		const outputDir = resolveOutputDir(options.outputDir, sessionId);
		chain.config.outputDir = outputDir;
		chain.config.saveIntermediates = options.saveIntermediates;

		if (options.parallel) {
			chain.config.parallel = true;
			if (options.maxWorkers) chain.config.maxWorkers = options.maxWorkers;
		}

		// Read input from --prompt-file if specified
		let input = options.input || options.text || "";
		if (options.promptFile) {
			try {
				input = fs.readFileSync(options.promptFile, "utf-8").trim();
			} catch {
				return {
					success: false,
					error: `Cannot read prompt file: ${options.promptFile}`,
				};
			}
		}

		// Cost preview
		const enabledSteps = chain.steps.filter((s) => s.enabled);
		const costEstimate = estimatePipelineCost(chain);
		if (!options.quiet) {
			console.error(
				`Pipeline: ${enabledSteps.length} steps, estimated cost: $${costEstimate.totalCost.toFixed(3)}`
			);
		}

		// Interactive confirmation (skip in CI or with --no-confirm)
		const skipConfirm = options.noConfirm || !isInteractive();
		if (!skipConfirm) {
			const proceed = await confirm("Proceed with execution?");
			if (!proceed) {
				return { success: false, error: "Execution cancelled by user" };
			}
		}

		const executor = chain.config.parallel
			? new ParallelPipelineExecutor({
					enabled: true,
					maxWorkers: chain.config.maxWorkers ?? 8,
				})
			: this.executor;

		const result = await executor.executeChain(
			chain,
			input,
			(progress) => {
				onProgress({
					stage: progress.stage,
					percent: progress.percent,
					message: progress.message,
					model: progress.model,
				});
				// Stream JSONL events to stderr when --stream is enabled
				if (options.stream) {
					const event = {
						type: "progress",
						stage: progress.stage,
						percent: progress.percent,
						message: progress.message,
						model: progress.model,
						timestamp: new Date().toISOString(),
					};
					process.stderr.write(JSON.stringify(event) + "\n");
				}
			},
			this.abortController.signal
		);

		return {
			success: result.success,
			outputPath: result.outputPath,
			outputPaths: result.outputPaths,
			error: result.error,
			cost: result.totalCost,
			duration: (Date.now() - startTime) / 1000,
			data: {
				stepsCompleted: result.stepsCompleted,
				totalSteps: result.totalSteps,
			},
		};
	}

	private async handleTransferMotion(
		options: CLIRunOptions,
		onProgress: ProgressFn
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

		// Build transfer-motion params
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

		const result = await this.executor.executeStep(
			step,
			{ imageUrl: options.imageUrl, videoUrl: options.videoUrl },
			{ outputDir, signal: this.abortController.signal }
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

	private async handleGenerateGrid(
		options: CLIRunOptions,
		onProgress: ProgressFn
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

		// Prepend style to prompt if specified
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

			const result = await this.executor.executeStep(
				step,
				{ text: promptText },
				{
					outputDir,
					signal: this.abortController.signal,
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
				const dl = await downloadOutput(
					result.outputUrl,
					path.join(outputDir, `grid_${i}.png`)
				);
				imagePaths.push(dl);
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

		// Post-generation upscale if --grid-upscale is specified
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

			const upscaleResult = await this.executor.executeStep(
				upscaleStep,
				{ imageUrl: gridResult.outputPath },
				{ outputDir, signal: this.abortController.signal }
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

		// If no grid composite path (e.g. sharp not available), use first individual image
		const resolvedOutputPath =
			finalOutputPath || (imagePaths.length > 0 ? imagePaths[0] : undefined);

		return {
			success: true,
			outputPath: resolvedOutputPath,
			outputPaths: imagePaths,
			duration: (Date.now() - startTime) / 1000,
		};
	}

	private async handleUpscaleImage(
		options: CLIRunOptions,
		onProgress: ProgressFn
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
		if (options.upscale) params.upscale_factor = parseInt(options.upscale, 10);

		// --target maps resolution name to upscale parameters
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

		const result = await this.executor.executeStep(
			step,
			{ imageUrl: imageInput },
			{
				outputDir,
				signal: this.abortController.signal,
			}
		);

		// Determine output extension from --format option
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
}

function guessExtFromCommand(command: string): string {
	switch (command) {
		case "generate-image":
			return ".png";
		case "create-video":
		case "generate-avatar":
			return ".mp4";
		default:
			return ".bin";
	}
}

export function createProgressReporter(options: {
	json: boolean;
	quiet: boolean;
}): ProgressFn {
	const isTTY = process.stdout.isTTY;

	return (progress) => {
		if (options.quiet) return;
		// In --json mode, only the final result should go to stdout.
		// Progress events are suppressed (use --stream for JSONL events).
		if (options.json) return;

		if (isTTY) {
			const bar = renderProgressBar(progress.percent, 30);
			process.stdout.write(`\r${bar} ${progress.message}`);
			if (progress.stage === "complete") {
				process.stdout.write("\n");
			}
		} else {
			console.error(JSON.stringify({ type: "progress", ...progress }));
		}
	};
}

function renderProgressBar(percent: number, width: number): string {
	const filled = Math.round((percent / 100) * width);
	const empty = width - filled;
	return `[${"=".repeat(filled)}${" ".repeat(empty)}] ${String(percent).padStart(3)}%`;
}
