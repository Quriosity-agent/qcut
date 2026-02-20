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
import { getExitCode, formatErrorForCli } from "./errors.js";
import { CLIOutput } from "./cli-output.js";
import { StreamEmitter, NullEmitter } from "./stream-emitter.js";

const VERSION = "1.0.0";

const COMMANDS = [
	"generate-image",
	"create-video",
	"generate-avatar",
	"run-pipeline",
	"list-models",
	"estimate-cost",
	"analyze-video",
	"transcribe",
	"transfer-motion",
	"generate-grid",
	"upscale-image",
	"setup",
	"set-key",
	"get-key",
	"delete-key",
	"check-keys",
	"init-project",
	"organize-project",
	"structure-info",
	"create-examples",
	"vimax:idea2video",
	"vimax:script2video",
	"vimax:novel2movie",
	"vimax:extract-characters",
	"vimax:generate-script",
	"vimax:generate-storyboard",
	"vimax:generate-portraits",
	"vimax:create-registry",
	"vimax:show-registry",
	"vimax:list-models",
	"list-avatar-models",
	"list-video-models",
	"list-motion-models",
	"list-speech-models",
] as const;

type Command = (typeof COMMANDS)[number];

function printHelp(): void {
	console.log(
		`
qcut-pipeline v${VERSION} — AI content generation CLI

Usage: qcut-pipeline <command> [options]

Commands:
  generate-image      Generate an image from text
  create-video        Create a video from text or image
  generate-avatar     Generate a talking avatar video
  run-pipeline        Run a multi-step YAML pipeline
  list-models         List available AI models
  estimate-cost       Estimate generation cost
  analyze-video       Analyze a video with AI vision
  transcribe          Transcribe audio to text
  transfer-motion     Transfer motion from video to image
  generate-grid       Generate an image grid
  upscale-image       Upscale an image
  setup               Create API key template file
  set-key             Set an API key
  get-key             Get an API key (masked)
  delete-key          Delete a stored API key
  check-keys          Check configured API keys
  init-project        Initialize project directory structure
  organize-project    Organize media files into categories
  structure-info      Show project structure and file counts
  create-examples     Create example pipeline configs
  vimax:idea2video    Generate video from an idea
  vimax:script2video  Generate video from a script
  vimax:novel2movie   Generate movie from a novel
  vimax:extract-characters  Extract characters from text
  vimax:generate-script     Generate screenplay from idea
  vimax:generate-storyboard Generate storyboard from script
  vimax:generate-portraits  Generate character portraits
  vimax:create-registry     Create portrait registry from files
  vimax:show-registry       Display registry contents
  vimax:list-models         List ViMax-specific models
  list-avatar-models  List avatar models
  list-video-models   List video models
  list-motion-models  List motion transfer models
  list-speech-models  List speech models

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
  --parallel          Enable parallel step execution
  --max-workers       Max concurrent workers (default: 8)

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
`.trim()
	);
}

export function parseCliArgs(argv: string[]): CLIRunOptions {
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
		console.error("Run with --help for usage.");
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
			parallel: { type: "boolean", default: false },
			"max-workers": { type: "string" },
			json: { type: "boolean", default: false },
			quiet: { type: "boolean", short: "q", default: false },
			verbose: { type: "boolean", short: "v", default: false },
			help: { type: "boolean", short: "h", default: false },
			category: { type: "string" },
			prompt: { type: "string" },
			layout: { type: "string" },
			upscale: { type: "string" },
			name: { type: "string" },
			value: { type: "string" },
			idea: { type: "string" },
			script: { type: "string" },
			novel: { type: "string" },
			title: { type: "string" },
			"max-scenes": { type: "string" },
			"scripts-only": { type: "boolean", default: false },
			"storyboard-only": { type: "boolean", default: false },
			"no-portraits": { type: "boolean", default: false },
			"llm-model": { type: "string" },
			"image-model": { type: "string" },
			"video-model": { type: "string" },
			image: { type: "string" },
			stream: { type: "boolean", default: false },
			"config-dir": { type: "string" },
			"cache-dir": { type: "string" },
			"state-dir": { type: "string" },
			"negative-prompt": { type: "string" },
			"voice-id": { type: "string" },
			directory: { type: "string" },
			"dry-run": { type: "boolean", default: false },
			recursive: { type: "boolean", default: false },
			"include-output": { type: "boolean", default: false },
			source: { type: "string" },
			reveal: { type: "boolean", default: false },
			"no-confirm": { type: "boolean", default: false },
			"prompt-file": { type: "string" },
			portraits: { type: "string", short: "p" },
			views: { type: "string" },
			"max-characters": { type: "string" },
			"save-registry": { type: "boolean", default: true },
			style: { type: "string" },
			"reference-model": { type: "string" },
			"reference-strength": { type: "string" },
			// transcribe options
			language: { type: "string" },
			"no-diarize": { type: "boolean", default: false },
			"no-tag-events": { type: "boolean", default: false },
			keyterms: { type: "string", multiple: true },
			srt: { type: "boolean", default: false },
			"srt-max-words": { type: "string" },
			"srt-max-duration": { type: "string" },
			"raw-json": { type: "boolean", default: false },
			// transfer-motion options
			orientation: { type: "string" },
			"no-sound": { type: "boolean", default: false },
			// generate-avatar options
			"reference-images": { type: "string", multiple: true },
			// analyze-video options
			"analysis-type": { type: "string" },
			"output-format": { type: "string", short: "f" },
			// upscale-image options
			target: { type: "string" },
			// vimax options
			"no-references": { type: "boolean", default: false },
			"project-id": { type: "string" },
			// grid upscale
			"grid-upscale": { type: "string" },
		},
		strict: false,
	});

	if (values.help) {
		printHelp();
		process.exit(0);
	}

	return {
		command,
		model: values.model as string | undefined,
		text: values.text as string | undefined,
		imageUrl: values["image-url"] as string | undefined,
		videoUrl: values["video-url"] as string | undefined,
		audioUrl: values["audio-url"] as string | undefined,
		outputDir: (values["output-dir"] as string) || "./output",
		duration: values.duration as string | undefined,
		aspectRatio: values["aspect-ratio"] as string | undefined,
		resolution: values.resolution as string | undefined,
		config: values.config as string | undefined,
		input: values.input as string | undefined,
		saveIntermediates: (values["save-intermediates"] as boolean) ?? false,
		parallel: (values.parallel as boolean) ?? false,
		maxWorkers: values["max-workers"]
			? Number.isNaN(parseInt(values["max-workers"] as string, 10))
				? undefined
				: parseInt(values["max-workers"] as string, 10)
			: undefined,
		json: (values.json as boolean) ?? false,
		verbose: (values.verbose as boolean) ?? false,
		quiet: (values.quiet as boolean) ?? false,
		category: values.category as string | undefined,
		prompt: values.prompt as string | undefined,
		layout: values.layout as string | undefined,
		upscale: values.upscale as string | undefined,
		keyName: values.name as string | undefined,
		keyValue: values.value as string | undefined,
		idea: values.idea as string | undefined,
		script: values.script as string | undefined,
		novel: values.novel as string | undefined,
		title: values.title as string | undefined,
		maxScenes: values["max-scenes"]
			? Number.isNaN(parseInt(values["max-scenes"] as string, 10))
				? undefined
				: parseInt(values["max-scenes"] as string, 10)
			: undefined,
		scriptsOnly: (values["scripts-only"] as boolean) ?? false,
		storyboardOnly: (values["storyboard-only"] as boolean) ?? false,
		noPortraits: (values["no-portraits"] as boolean) ?? false,
		llmModel: values["llm-model"] as string | undefined,
		imageModel: values["image-model"] as string | undefined,
		videoModel: values["video-model"] as string | undefined,
		image: values.image as string | undefined,
		stream: (values.stream as boolean) ?? false,
		configDir: values["config-dir"] as string | undefined,
		cacheDir: values["cache-dir"] as string | undefined,
		stateDir: values["state-dir"] as string | undefined,
		negativePrompt: values["negative-prompt"] as string | undefined,
		voiceId: values["voice-id"] as string | undefined,
		directory: values.directory as string | undefined,
		dryRun: (values["dry-run"] as boolean) ?? false,
		recursive: (values.recursive as boolean) ?? false,
		includeOutput: (values["include-output"] as boolean) ?? false,
		source: values.source as string | undefined,
		reveal: (values.reveal as boolean) ?? false,
		noConfirm: (values["no-confirm"] as boolean) ?? false,
		promptFile: values["prompt-file"] as string | undefined,
		portraits: values.portraits as string | undefined,
		views: values.views as string | undefined,
		maxCharacters: values["max-characters"]
			? Number.isNaN(parseInt(values["max-characters"] as string, 10))
				? undefined
				: parseInt(values["max-characters"] as string, 10)
			: undefined,
		saveRegistry: (values["save-registry"] as boolean) ?? true,
		style: values.style as string | undefined,
		referenceModel: values["reference-model"] as string | undefined,
		referenceStrength: values["reference-strength"]
			? Number.isNaN(parseFloat(values["reference-strength"] as string))
				? undefined
				: parseFloat(values["reference-strength"] as string)
			: undefined,
		// transcribe options
		language: values.language as string | undefined,
		noDiarize: (values["no-diarize"] as boolean) ?? false,
		noTagEvents: (values["no-tag-events"] as boolean) ?? false,
		keyterms: values.keyterms as string[] | undefined,
		srt: (values.srt as boolean) ?? false,
		srtMaxWords: values["srt-max-words"]
			? Number.isNaN(parseInt(values["srt-max-words"] as string, 10))
				? undefined
				: parseInt(values["srt-max-words"] as string, 10)
			: undefined,
		srtMaxDuration: values["srt-max-duration"]
			? Number.isNaN(parseFloat(values["srt-max-duration"] as string))
				? undefined
				: parseFloat(values["srt-max-duration"] as string)
			: undefined,
		rawJson: (values["raw-json"] as boolean) ?? false,
		// transfer-motion options
		orientation: values.orientation as string | undefined,
		noSound: (values["no-sound"] as boolean) ?? false,
		// generate-avatar options
		referenceImages: values["reference-images"] as string[] | undefined,
		// analyze-video options
		analysisType: values["analysis-type"] as string | undefined,
		outputFormat: values["output-format"] as string | undefined,
		// upscale-image options
		target: values.target as string | undefined,
		// vimax options
		noReferences: (values["no-references"] as boolean) ?? false,
		projectId: values["project-id"] as string | undefined,
		// grid upscale
		gridUpscale: values["grid-upscale"]
			? Number.isNaN(parseFloat(values["grid-upscale"] as string))
				? undefined
				: parseFloat(values["grid-upscale"] as string)
			: undefined,
	};
}

export async function main(
	argv: string[] = process.argv.slice(2)
): Promise<void> {
	initRegistry();

	const options = parseCliArgs(argv);
	const output = new CLIOutput({
		jsonMode: options.json,
		quiet: options.quiet,
		debug: options.verbose,
	});
	const emitter = options.stream
		? new StreamEmitter({ enabled: true })
		: new NullEmitter();
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

	emitter.pipelineStart(options.command, 1);
	const result = await runner.run(options, reporter);

	if (options.json) {
		console.log(
			JSON.stringify(
				{
					schema_version: "1",
					command: options.command,
					...result,
				},
				null,
				2
			)
		);
	} else if (result.success) {
		if (result.outputPath) {
			output.success(`Output: ${result.outputPath}`);
		}
		if (result.cost !== undefined) {
			output.cost(result.cost);
		}
		if (result.duration !== undefined) {
			output.info(`Duration: ${result.duration.toFixed(1)}s`);
		}
		if (
			result.data &&
			(options.command === "list-models" ||
				options.command === "vimax:list-models")
		) {
			const data = result.data as {
				models: {
					key: string;
					name: string;
					provider: string;
					categories: string[];
				}[];
				count: number;
			};
			console.log(`\nAvailable models (${data.count}):\n`);
			for (const m of data.models) {
				console.log(
					`  ${m.key.padEnd(35)} ${m.provider.padEnd(15)} ${m.categories.join(", ")}`
				);
			}
		}
		if (result.data && options.command === "estimate-cost") {
			const data = result.data as {
				model: string;
				totalCost: number;
				breakdown: { item: string; cost: number }[];
			};
			console.log(
				`\nCost estimate for ${data.model}: $${data.totalCost.toFixed(3)}`
			);
			for (const b of data.breakdown) {
				console.log(`  ${b.item}: $${b.cost.toFixed(4)}`);
			}
		}
		if (
			result.data &&
			(options.command === "analyze-video" || options.command === "transcribe")
		) {
			console.log(
				`\n${typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2)}`
			);
		}
		if (result.data && options.command === "check-keys") {
			const data = result.data as {
				keys: {
					name: string;
					configured: boolean;
					source: string;
					masked?: string;
				}[];
			};
			console.log("\nAPI Key Status:\n");
			for (const k of data.keys) {
				const status = k.configured
					? `configured (${k.source}) ${k.masked || ""}`
					: "not set";
				console.log(`  ${k.name.padEnd(25)} ${status}`);
			}
		}
		if (result.data && options.command === "create-examples") {
			const data = result.data as { created: string[]; count: number };
			console.log(`\nCreated ${data.count} example pipelines:`);
			for (const p of data.created) {
				console.log(`  ${p}`);
			}
		}
		if (result.data && options.command === "setup") {
			const data = result.data as { message: string };
			console.log(`\n${data.message}`);
		}
		if (
			result.data &&
			(options.command === "set-key" ||
				options.command === "get-key" ||
				options.command === "delete-key")
		) {
			const data = result.data as {
				message?: string;
				name?: string;
				masked?: string;
				value?: string;
			};
			if (data.message) console.log(data.message);
			if (data.value) console.log(`${data.name}: ${data.value}`);
			else if (data.masked) console.log(`${data.name}: ${data.masked}`);
		}
		if (result.data && options.command === "init-project") {
			const data = result.data as {
				projectDir: string;
				created: string[];
				message: string;
			};
			console.log(`\n${data.message}`);
			if (data.created.length > 0) {
				console.log(`  Project: ${data.projectDir}`);
				for (const dir of data.created) {
					console.log(`  + ${dir}`);
				}
			}
		}
		if (result.data && options.command === "organize-project") {
			const data = result.data as { moved: number; message: string };
			console.log(`\n${data.message}`);
		}
		if (result.data && options.command === "structure-info") {
			const data = result.data as {
				projectDir: string;
				directories: { path: string; fileCount: number; exists: boolean }[];
				totalFiles: number;
			};
			console.log(`\nProject: ${data.projectDir}`);
			console.log(`Total files: ${data.totalFiles}\n`);
			for (const dir of data.directories) {
				const status = dir.exists
					? `${String(dir.fileCount).padStart(4)} files`
					: "  (missing)";
				console.log(`  ${dir.path.padEnd(25)} ${status}`);
			}
		}
		if (result.data && options.command === "vimax:extract-characters") {
			const data = result.data as { characters: unknown[]; count: number };
			console.log(`\nExtracted ${data.count} characters`);
		}
		if (result.data && options.command === "vimax:generate-script") {
			const data = result.data as {
				title: string;
				scenes: number;
				total_duration: number;
			};
			console.log(
				`\nGenerated script: "${data.title}" (${data.scenes} scenes, ${data.total_duration.toFixed(1)}s)`
			);
		}
		if (result.data && options.command === "vimax:show-registry") {
			const data = result.data as {
				project_id: string;
				characters: unknown[];
				total_characters: number;
			};
			console.log(
				`\nRegistry (${data.project_id}): ${data.total_characters} characters`
			);
			console.log(JSON.stringify(data.characters, null, 2));
		}
		emitter.pipelineComplete({ ...result, success: true });
	} else {
		output.error(result.error || "Unknown error");
		emitter.pipelineComplete({ success: false, error: result.error });
		const { exitCode } = formatErrorForCli(new Error(result.error));
		process.exit(exitCode);
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
