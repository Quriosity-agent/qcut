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
import { parseChainConfig, validateChain } from "./chain-parser.js";
import {
  estimateCost,
  estimatePipelineCost,
  listModels,
} from "./cost-calculator.js";
import { downloadOutput, setApiKeyProvider, envApiKeyProvider } from "./api-caller.js";
import { resolveOutputDir } from "./output-utils.js";
import type { ModelCategory } from "./registry.js";

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
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  category?: string;
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

    const input = options.input || options.text || "";

    const result = await this.executor.executeChain(
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
