#!/usr/bin/env node
/**
 * CLI entry point for the native video agent pipeline.
 *
 * Run AI content generation pipelines from the command line
 * without the Electron GUI. Uses the same native TypeScript
 * pipeline modules as the QCut editor.
 *
 * Usage: bun run electron/native-pipeline/cli.ts <command> [options]
 *
 * @module electron/native-pipeline/cli
 */

import { parseArgs } from "node:util";
import { initRegistry } from "./init.js";
import { CLIPipelineRunner, createProgressReporter } from "./cli-runner.js";
import type { CLIRunOptions } from "./cli-runner.js";

const VERSION = "1.0.0";

const COMMANDS = [
  "generate-image",
  "create-video",
  "generate-avatar",
  "run-pipeline",
  "list-models",
  "estimate-cost",
] as const;

type Command = (typeof COMMANDS)[number];

function printHelp(): void {
  console.log(`
qcut-pipeline v${VERSION} — AI content generation CLI

Usage: qcut-pipeline <command> [options]

Commands:
  generate-image      Generate an image from text
  create-video        Create a video from text or image
  generate-avatar     Generate a talking avatar video
  run-pipeline        Run a multi-step YAML pipeline
  list-models         List available AI models
  estimate-cost       Estimate generation cost

Global Options:
  --output-dir, -o    Output directory (default: ./output)
  --model, -m         Model key (e.g. kling_2_6_pro, flux_dev)
  --json              Output results as JSON
  --quiet, -q         Suppress progress output
  --help, -h          Show help
  --version           Show version

Generation Options:
  --text, -t          Text prompt for generation
  --image-url         Input image URL
  --video-url         Input video URL
  --audio-url         Input audio URL
  --duration, -d      Duration (e.g. "5s", "10")
  --aspect-ratio      Aspect ratio (e.g. "16:9", "9:16")
  --resolution        Resolution (e.g. "1080p", "720p")

Pipeline Options:
  --config, -c        Path to YAML pipeline config
  --input, -i         Pipeline input text or file path
  --save-intermediates Save intermediate step outputs

Environment Variables:
  FAL_KEY             FAL.ai API key
  GEMINI_API_KEY      Google Gemini API key
  OPENROUTER_API_KEY  OpenRouter API key
  ELEVENLABS_API_KEY  ElevenLabs API key

Examples:
  qcut-pipeline generate-image -m flux_dev -t "A cat in space"
  qcut-pipeline create-video -m kling_2_6_pro -t "Ocean waves" -d 5s
  qcut-pipeline list-models --category text_to_video
  qcut-pipeline estimate-cost -m veo3 -d 8s
  qcut-pipeline run-pipeline -c pipeline.yaml -i "A sunset"
`.trim());
}

function parseCliArgs(argv: string[]): CLIRunOptions {
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (command === "--version") {
    console.log(VERSION);
    process.exit(0);
  }

  if (!COMMANDS.includes(command as Command)) {
    console.error(`Unknown command: ${command}`);
    console.error(`Run with --help for usage.`);
    process.exit(2);
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      model: { type: "string", short: "m" },
      text: { type: "string", short: "t" },
      "image-url": { type: "string" },
      "video-url": { type: "string" },
      "audio-url": { type: "string" },
      "output-dir": { type: "string", short: "o" },
      duration: { type: "string", short: "d" },
      "aspect-ratio": { type: "string" },
      resolution: { type: "string" },
      config: { type: "string", short: "c" },
      input: { type: "string", short: "i" },
      "save-intermediates": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
      category: { type: "string" },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  return {
    command,
    model: values.model,
    text: values.text,
    imageUrl: values["image-url"],
    videoUrl: values["video-url"],
    audioUrl: values["audio-url"],
    outputDir: values["output-dir"] || "./output",
    duration: values.duration,
    aspectRatio: values["aspect-ratio"],
    resolution: values.resolution,
    config: values.config,
    input: values.input,
    saveIntermediates: values["save-intermediates"] ?? false,
    json: values.json ?? false,
    verbose: values.verbose ?? false,
    quiet: values.quiet ?? false,
    category: values.category,
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  initRegistry();

  const options = parseCliArgs(argv);
  const runner = new CLIPipelineRunner();
  const reporter = createProgressReporter({
    json: options.json,
    quiet: options.quiet,
  });

  process.on("SIGINT", () => {
    if (!options.quiet) console.error("\nCancelling...");
    runner.abort();
  });
  process.on("SIGTERM", () => {
    runner.abort();
  });

  const result = await runner.run(options, reporter);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.success) {
    if (result.outputPath) {
      console.log(`Output: ${result.outputPath}`);
    }
    if (result.cost !== undefined) {
      console.log(`Cost: $${result.cost.toFixed(3)}`);
    }
    if (result.duration !== undefined) {
      console.log(`Duration: ${result.duration.toFixed(1)}s`);
    }
    if (result.data && options.command === "list-models") {
      const data = result.data as { models: { key: string; name: string; provider: string; categories: string[] }[]; count: number };
      console.log(`\nAvailable models (${data.count}):\n`);
      for (const m of data.models) {
        console.log(`  ${m.key.padEnd(35)} ${m.provider.padEnd(15)} ${m.categories.join(", ")}`);
      }
    }
    if (result.data && options.command === "estimate-cost") {
      const data = result.data as { model: string; totalCost: number; breakdown: { item: string; cost: number }[] };
      console.log(`\nCost estimate for ${data.model}: $${data.totalCost.toFixed(3)}`);
      for (const b of data.breakdown) {
        console.log(`  ${b.item}: $${b.cost.toFixed(4)}`);
      }
    }
  } else {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

// Direct execution check
const scriptPath = process.argv[1];
if (
  scriptPath &&
  (scriptPath.endsWith("cli.ts") ||
    scriptPath.endsWith("cli.js") ||
    scriptPath.endsWith("qcut-pipeline"))
) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
