/**
 * CLI Pipeline Runner
 *
 * Bridges parsed CLI arguments to native pipeline modules.
 * No Electron dependencies — runs with plain bun/node.
 *
 * @module electron/native-pipeline/cli-runner
 */

import * as fs from "fs";
import { ModelRegistry } from "./registry.js";
import { PipelineExecutor } from "./executor.js";
import type { PipelineStep } from "./executor.js";
import { ParallelPipelineExecutor } from "./parallel-executor.js";
import { parseChainConfig, validateChain } from "./chain-parser.js";
import {
  estimateCost,
  estimatePipelineCost,
  listModels,
} from "./cost-calculator.js";
import { downloadOutput, setApiKeyProvider, envApiKeyProvider } from "./api-caller.js";
import { resolveOutputDir } from "./output-utils.js";
import type { ModelCategory } from "./registry.js";
import { compositeGrid, getGridImageCount } from "./grid-generator.js";
import { setKey, getKey, checkKeys, setupEnvTemplate, loadEnvFile } from "./key-manager.js";
import { createExamples } from "./example-pipelines.js";

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

  async run(options: CLIRunOptions, onProgress: ProgressFn): Promise<CLIResult> {
    loadEnvFile();

    switch (options.command) {
      case "list-models":
        return this.handleListModels(options);
      case "estimate-cost":
        return this.handleEstimateCost(options);
      case "generate-image":
      case "create-video":
      case "generate-avatar":
        return this.handleGenerate(options, onProgress);
      case "run-pipeline":
        return this.handleRunPipeline(options, onProgress);
      case "analyze-video":
        return this.handleAnalyzeVideo(options, onProgress);
      case "transcribe":
        return this.handleTranscribe(options, onProgress);
      case "transfer-motion":
        return this.handleTransferMotion(options, onProgress);
      case "generate-grid":
        return this.handleGenerateGrid(options, onProgress);
      case "upscale-image":
        return this.handleUpscaleImage(options, onProgress);
      case "setup":
        return this.handleSetup();
      case "set-key":
        return this.handleSetKey(options);
      case "get-key":
        return this.handleGetKey(options);
      case "check-keys":
        return this.handleCheckKeys();
      case "create-examples":
        return this.handleCreateExamples(options);
      case "vimax:idea2video":
        return this.handleVimaxIdea2Video(options, onProgress);
      case "vimax:script2video":
        return this.handleVimaxScript2Video(options, onProgress);
      case "vimax:novel2movie":
        return this.handleVimaxNovel2Movie(options, onProgress);
      case "list-avatar-models":
        return this.handleListModels({ ...options, category: "avatar" });
      case "list-video-models":
        return this.handleListModels({ ...options, category: "text_to_video" });
      case "list-motion-models":
        return this.handleListModels({ ...options, category: "motion_transfer" });
      case "list-speech-models":
        return this.handleListModels({ ...options, category: "text_to_speech" });
      default:
        return { success: false, error: `Unknown command: ${options.command}` };
    }
  }

  private handleListModels(options: CLIRunOptions): CLIResult {
    const category = options.category as ModelCategory | undefined;
    const models = category ? listModels({ category }) : listModels();

    return {
      success: true,
      data: {
        models: models.map((m) => ({
          key: m.key,
          name: m.name,
          provider: m.provider,
          categories: m.categories,
          costEstimate: m.costEstimate,
          description: m.description,
        })),
        count: models.length,
      },
    };
  }

  private handleEstimateCost(options: CLIRunOptions): CLIResult {
    if (!options.model) {
      return { success: false, error: "Missing --model. Run --help for usage." };
    }
    if (!ModelRegistry.has(options.model)) {
      return {
        success: false,
        error: `Unknown model '${options.model}'. Run list-models to see available models.`,
      };
    }

    const params: Record<string, unknown> = {};
    if (options.duration) params.duration = options.duration;
    if (options.resolution) params.resolution = options.resolution;

    const estimate = estimateCost(options.model, params);
    return { success: true, cost: estimate.totalCost, data: estimate };
  }

  private async handleGenerate(
    options: CLIRunOptions,
    onProgress: ProgressFn
  ): Promise<CLIResult> {
    if (!options.model) {
      return { success: false, error: "Missing --model. Run --help for usage." };
    }
    if (!ModelRegistry.has(options.model)) {
      return {
        success: false,
        error: `Unknown model '${options.model}'. Run list-models to see available models.`,
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
        onProgress({ stage: "processing", percent, message, model: options.model });
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
      const destPath = `${outputDir}/${filename}`;
      try {
        result.outputPath = await downloadOutput(result.outputUrl, destPath);
      } catch {
        // URL still available in result
      }
    }

    onProgress({ stage: "complete", percent: 100, message: "Done", model: options.model });

    return {
      success: true,
      outputPath: result.outputPath,
      outputPaths: result.outputPath ? [result.outputPath] : undefined,
      cost: result.cost,
      duration: (Date.now() - startTime) / 1000,
    };
  }

  private async handleRunPipeline(
    options: CLIRunOptions,
    onProgress: ProgressFn
  ): Promise<CLIResult> {
    if (!options.config) {
      return { success: false, error: "Missing --config. Run --help for usage." };
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

    const input = options.input || options.text || "";

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
      data: { stepsCompleted: result.stepsCompleted, totalSteps: result.totalSteps },
    };
  }

  private async handleAnalyzeVideo(
    options: CLIRunOptions,
    onProgress: ProgressFn
  ): Promise<CLIResult> {
    const videoInput = options.input || options.videoUrl;
    if (!videoInput) {
      return { success: false, error: "Missing --input/-i (video path/URL)" };
    }

    const model = options.model || "gemini_qa";
    if (!ModelRegistry.has(model)) {
      return { success: false, error: `Unknown model '${model}'` };
    }

    const startTime = Date.now();
    onProgress({ stage: "analyzing", percent: 0, message: "Analyzing video...", model });

    const step: PipelineStep = {
      type: "image_understanding",
      model,
      params: { prompt: options.prompt || options.text || "Describe this video in detail" },
      enabled: true,
      retryCount: 0,
    };

    const result = await this.executor.executeStep(step, { videoUrl: videoInput }, {
      outputDir: options.outputDir,
      signal: this.abortController.signal,
    });

    onProgress({ stage: "complete", percent: 100, message: "Done", model });

    return {
      success: result.success,
      error: result.error,
      data: result.text || result.data,
      duration: (Date.now() - startTime) / 1000,
    };
  }

  private async handleTranscribe(
    options: CLIRunOptions,
    onProgress: ProgressFn
  ): Promise<CLIResult> {
    const audioInput = options.input || options.audioUrl;
    if (!audioInput) {
      return { success: false, error: "Missing --input/-i (audio path/URL)" };
    }

    const model = options.model || "scribe_v2";
    if (!ModelRegistry.has(model)) {
      return { success: false, error: `Unknown model '${model}'` };
    }

    const startTime = Date.now();
    onProgress({ stage: "transcribing", percent: 0, message: "Transcribing audio...", model });

    const step: PipelineStep = {
      type: "speech_to_text",
      model,
      params: {},
      enabled: true,
      retryCount: 0,
    };

    const result = await this.executor.executeStep(step, { audioUrl: audioInput }, {
      outputDir: options.outputDir,
      signal: this.abortController.signal,
    });

    onProgress({ stage: "complete", percent: 100, message: "Done", model });

    return {
      success: result.success,
      error: result.error,
      data: result.text || result.data,
      duration: (Date.now() - startTime) / 1000,
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

    onProgress({ stage: "transferring", percent: 0, message: "Transferring motion...", model });

    const step: PipelineStep = {
      type: "avatar",
      model,
      params: {},
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
        result.outputPath = await downloadOutput(result.outputUrl, `${outputDir}/motion_${Date.now()}.mp4`);
      } catch { /* URL still available */ }
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
      return { success: false, error: "Missing --text/-t (prompt for grid images)" };
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

    onProgress({ stage: "generating", percent: 0, message: `Generating ${count} images...`, model });

    const imagePaths: string[] = [];
    for (let i = 0; i < count; i++) {
      const step: PipelineStep = {
        type: "text_to_image",
        model,
        params: { prompt: text },
        enabled: true,
        retryCount: 0,
      };

      const result = await this.executor.executeStep(step, { text }, {
        outputDir,
        signal: this.abortController.signal,
      });

      if (!result.success) {
        return { success: false, error: `Image ${i + 1} failed: ${result.error}` };
      }

      if (result.outputPath) imagePaths.push(result.outputPath);
      else if (result.outputUrl) {
        const dl = await downloadOutput(result.outputUrl, `${outputDir}/grid_${i}.png`);
        imagePaths.push(dl);
      }

      onProgress({
        stage: "generating",
        percent: Math.round(((i + 1) / count) * 80),
        message: `Generated image ${i + 1}/${count}`,
        model,
      });
    }

    onProgress({ stage: "compositing", percent: 85, message: "Creating grid...", model });

    const gridResult = await compositeGrid(imagePaths, {
      layout: layout as "2x2" | "3x3" | "2x3" | "3x2" | "1x2" | "2x1",
      gap: 4,
      backgroundColor: "#000000",
      outputPath: `${outputDir}/grid_${Date.now()}.png`,
    });

    onProgress({ stage: "complete", percent: 100, message: "Done", model });

    return {
      success: gridResult.success,
      outputPath: gridResult.outputPath,
      outputPaths: gridResult.imagePaths,
      error: gridResult.error,
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

    onProgress({ stage: "upscaling", percent: 0, message: "Upscaling image...", model });

    const params: Record<string, unknown> = {};
    if (options.upscale) params.upscale_factor = parseInt(options.upscale, 10);

    const step: PipelineStep = {
      type: "image_to_image",
      model,
      params,
      enabled: true,
      retryCount: 0,
    };

    const result = await this.executor.executeStep(step, { imageUrl: imageInput }, {
      outputDir,
      signal: this.abortController.signal,
    });

    if (!result.outputPath && result.outputUrl && outputDir) {
      try {
        result.outputPath = await downloadOutput(result.outputUrl, `${outputDir}/upscaled_${Date.now()}.png`);
      } catch { /* URL still available */ }
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

  private handleSetup(): CLIResult {
    const envPath = setupEnvTemplate();
    return {
      success: true,
      data: { envPath, message: `API key template created at ${envPath}` },
    };
  }

  private handleSetKey(options: CLIRunOptions): CLIResult {
    if (!options.keyName) {
      return { success: false, error: "Missing --name" };
    }
    if (!options.keyValue) {
      return { success: false, error: "Missing --value" };
    }
    setKey(options.keyName, options.keyValue);
    return { success: true, data: { message: `Key '${options.keyName}' saved` } };
  }

  private handleGetKey(options: CLIRunOptions): CLIResult {
    if (!options.keyName) {
      return { success: false, error: "Missing --name" };
    }
    const value = getKey(options.keyName);
    if (!value) {
      return { success: false, error: `Key '${options.keyName}' not found` };
    }
    const masked = value.length > 8
      ? value.slice(0, 4) + "****" + value.slice(-4)
      : "****";
    return { success: true, data: { name: options.keyName, masked } };
  }

  private handleCheckKeys(): CLIResult {
    const keys = checkKeys();
    return { success: true, data: { keys } };
  }

  private handleCreateExamples(options: CLIRunOptions): CLIResult {
    const outputDir = options.outputDir || "./examples";
    const created = createExamples(outputDir);
    return {
      success: true,
      data: { created, count: created.length },
    };
  }

  private async handleVimaxIdea2Video(
    options: CLIRunOptions,
    onProgress: ProgressFn
  ): Promise<CLIResult> {
    const idea = options.idea || options.text;
    if (!idea) {
      return { success: false, error: "Missing --idea or --text" };
    }

    onProgress({ stage: "starting", percent: 0, message: "Starting idea-to-video pipeline..." });

    try {
      const { Idea2VideoPipeline } = await import("./vimax/pipelines/idea2video.js");
      const sessionId = `cli-${Date.now()}`;
      const outputDir = resolveOutputDir(options.outputDir, sessionId);
      const startTime = Date.now();

      const pipeline = new Idea2VideoPipeline({
        outputDir,
        generatePortraits: !(options.noPortraits ?? false),
        useCharacterReferences: true,
        videoModel: options.videoModel,
        imageModel: options.imageModel,
        llmModel: options.llmModel,
        targetDuration: options.duration ? parseInt(options.duration, 10) : undefined,
      });

      const result = await pipeline.run(idea);

      return {
        success: result.success,
        outputPath: result.output?.finalVideo,
        cost: result.totalCost,
        duration: (Date.now() - startTime) / 1000,
        data: {
          idea: result.idea,
          characters: result.characters.length,
          errors: result.errors,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Idea2Video failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async handleVimaxScript2Video(
    options: CLIRunOptions,
    onProgress: ProgressFn
  ): Promise<CLIResult> {
    const scriptPath = options.script || options.input;
    if (!scriptPath) {
      return { success: false, error: "Missing --script or --input (JSON path)" };
    }

    onProgress({ stage: "starting", percent: 0, message: "Starting script-to-video pipeline..." });

    try {
      const { Script2VideoPipeline } = await import("./vimax/pipelines/script2video.js");
      const sessionId = `cli-${Date.now()}`;
      const outputDir = resolveOutputDir(options.outputDir, sessionId);
      const startTime = Date.now();

      let scriptData: string;
      try {
        scriptData = fs.readFileSync(scriptPath, "utf-8");
      } catch {
        return { success: false, error: `Cannot read script: ${scriptPath}` };
      }

      const pipeline = new Script2VideoPipeline({
        outputDir,
        videoModel: options.videoModel,
        imageModel: options.imageModel,
        useCharacterReferences: true,
      });

      const result = await pipeline.run(JSON.parse(scriptData));

      return {
        success: result.success,
        outputPath: result.output?.finalVideo,
        cost: result.totalCost,
        duration: (Date.now() - startTime) / 1000,
        data: { errors: result.errors },
      };
    } catch (err) {
      return {
        success: false,
        error: `Script2Video failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async handleVimaxNovel2Movie(
    options: CLIRunOptions,
    onProgress: ProgressFn
  ): Promise<CLIResult> {
    const novelPath = options.novel || options.input;
    if (!novelPath) {
      return { success: false, error: "Missing --novel or --input (text file path)" };
    }

    onProgress({ stage: "starting", percent: 0, message: "Starting novel-to-movie pipeline..." });

    try {
      const { Novel2MoviePipeline } = await import("./vimax/pipelines/novel2movie.js");
      const sessionId = `cli-${Date.now()}`;
      const outputDir = resolveOutputDir(options.outputDir, sessionId);
      const startTime = Date.now();

      let novelText: string;
      try {
        novelText = fs.readFileSync(novelPath, "utf-8");
      } catch {
        return { success: false, error: `Cannot read novel: ${novelPath}` };
      }

      const pipeline = new Novel2MoviePipeline({
        outputDir,
        maxScenes: options.maxScenes,
        generatePortraits: !(options.noPortraits ?? false),
        useCharacterReferences: true,
        scriptsOnly: options.scriptsOnly ?? false,
        storyboardOnly: options.storyboardOnly ?? false,
        videoModel: options.videoModel,
        imageModel: options.imageModel,
        llmModel: options.llmModel,
      });

      const result = await pipeline.run(novelText, options.title);

      return {
        success: result.success,
        outputPath: result.output?.finalVideo,
        cost: result.totalCost,
        duration: (Date.now() - startTime) / 1000,
        data: {
          novelTitle: result.novelTitle,
          chapters: result.chapters.length,
          characters: result.characters.length,
          errors: result.errors,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Novel2Movie failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
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

    if (options.json || !isTTY) {
      console.log(JSON.stringify({ type: "progress", ...progress }));
    } else {
      const bar = renderProgressBar(progress.percent, 30);
      process.stdout.write(`\r${bar} ${progress.message}`);
      if (progress.stage === "complete") {
        process.stdout.write("\n");
      }
    }
  };
}

function renderProgressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${"=".repeat(filled)}${" ".repeat(empty)}] ${String(percent).padStart(3)}%`;
}
