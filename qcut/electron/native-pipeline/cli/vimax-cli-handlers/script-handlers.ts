/**
 * ViMax Script Handlers
 *
 * generate-script, generate-storyboard
 */

import * as fs from "fs";
import * as path from "path";
import type { CLIRunOptions, CLIResult } from "../cli-runner/types.js";
import { resolveOutputDir } from "../../output/output-utils.js";

type ProgressFn = (progress: {
	stage: string;
	percent: number;
	message: string;
	model?: string;
}) => void;

/** vimax:generate-script — Generate screenplay from idea using Screenwriter agent. */
export async function handleVimaxGenerateScript(
	options: CLIRunOptions,
	onProgress: ProgressFn
): Promise<CLIResult> {
	const idea = options.idea || options.text;
	if (!idea) {
		return { success: false, error: "Missing --idea or --text" };
	}

	onProgress({
		stage: "starting",
		percent: 0,
		message: "Generating screenplay...",
	});

	try {
		const { Screenwriter } = await import("../../vimax/agents/screenwriter.js");

		const startTime = Date.now();
		const writer = new Screenwriter({
			model: options.llmModel,
			target_duration: options.duration
				? parseInt(options.duration, 10)
				: undefined,
		});

		const result = await writer.process(idea);

		onProgress({ stage: "complete", percent: 100, message: "Done" });

		if (!result.success) {
			return {
				success: false,
				error: `Script generation failed: ${result.error}`,
			};
		}

		const outputDir = resolveOutputDir(options.outputDir, `cli-${Date.now()}`);
		const outputPath = path.join(outputDir, "script.json");
		fs.writeFileSync(outputPath, JSON.stringify(result.result, null, 2));

		return {
			success: true,
			outputPath,
			duration: (Date.now() - startTime) / 1000,
			data: {
				title: result.result?.title,
				scenes: result.result?.scenes.length ?? 0,
				total_duration: result.result?.total_duration ?? 0,
			},
		};
	} catch (err) {
		return {
			success: false,
			error: `Generate script failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

/** vimax:generate-storyboard — Generate storyboard images from script using StoryboardArtist. */
export async function handleVimaxGenerateStoryboard(
	options: CLIRunOptions,
	onProgress: ProgressFn
): Promise<CLIResult> {
	const scriptPath = options.script || options.input;
	if (!scriptPath) {
		return {
			success: false,
			error: "Missing --script or --input (script JSON path)",
		};
	}

	onProgress({
		stage: "starting",
		percent: 0,
		message: "Generating storyboard...",
	});

	try {
		const { StoryboardArtist } = await import(
			"../../vimax/agents/storyboard-artist.js"
		);

		let scriptData: string;
		try {
			scriptData = fs.readFileSync(scriptPath, "utf-8");
		} catch {
			return { success: false, error: `Cannot read script: ${scriptPath}` };
		}

		const script = JSON.parse(scriptData);
		const startTime = Date.now();
		const sessionId = `cli-${Date.now()}`;
		const outputDir = resolveOutputDir(options.outputDir, sessionId);

		// Load portrait registry if --portraits is specified
		let portraitRegistry:
			| import("../../vimax/types/character.js").CharacterPortraitRegistry
			| undefined;
		if (options.portraits) {
			try {
				const { CharacterPortraitRegistry } = await import(
					"../../vimax/types/character.js"
				);
				const regContent = fs.readFileSync(options.portraits, "utf-8");
				portraitRegistry = CharacterPortraitRegistry.fromJSON(
					JSON.parse(regContent)
				);
			} catch {
				return {
					success: false,
					error: `Cannot read portrait registry: ${options.portraits}`,
				};
			}
		}

		const artist = new StoryboardArtist({
			image_model: options.imageModel,
			output_dir: outputDir,
			...(options.style ? { style_prefix: options.style } : {}),
			...(portraitRegistry ? { use_character_references: true } : {}),
			...(options.referenceModel
				? { reference_model: options.referenceModel }
				: {}),
			...(options.referenceStrength != null
				? { reference_strength: options.referenceStrength }
				: {}),
		});

		// If portrait registry is loaded, inject it into the script context
		if (portraitRegistry) {
			script._portrait_registry = portraitRegistry;
		}

		const result = await artist.process(script);

		onProgress({ stage: "complete", percent: 100, message: "Done" });

		if (!result.success) {
			return {
				success: false,
				error: `Storyboard generation failed: ${result.error}`,
			};
		}

		return {
			success: true,
			outputPath: outputDir,
			cost: result.result?.total_cost ?? 0,
			duration: (Date.now() - startTime) / 1000,
			data: {
				title: result.result?.title,
				images: result.result?.images.length ?? 0,
				total_cost: result.result?.total_cost ?? 0,
			},
		};
	} catch (err) {
		return {
			success: false,
			error: `Generate storyboard failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}
