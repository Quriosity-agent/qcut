/**
 * ViMax Character Handlers
 *
 * extract-characters, generate-portraits
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

/** vimax:extract-characters — Extract characters from text using CharacterExtractor agent. */
export async function handleVimaxExtractCharacters(
	options: CLIRunOptions,
	onProgress: ProgressFn
): Promise<CLIResult> {
	const text = options.text || options.input;
	if (!text) {
		return {
			success: false,
			error: "Missing --text or --input (text or file path)",
		};
	}

	onProgress({
		stage: "starting",
		percent: 0,
		message: "Extracting characters...",
	});

	try {
		const { CharacterExtractor } = await import(
			"../../vimax/agents/character-extractor.js"
		);

		let inputText = text;
		if (fs.existsSync(text)) {
			inputText = fs.readFileSync(text, "utf-8");
		}

		const startTime = Date.now();
		const extractor = new CharacterExtractor({
			model: options.llmModel,
		});

		const result = await extractor.process(inputText);

		onProgress({ stage: "complete", percent: 100, message: "Done" });

		if (!result.success) {
			return {
				success: false,
				error: `Character extraction failed: ${result.error}`,
			};
		}

		const outputDir = resolveOutputDir(options.outputDir, `cli-${Date.now()}`);
		const outputPath = path.join(outputDir, "characters.json");
		fs.writeFileSync(outputPath, JSON.stringify(result.result, null, 2));

		return {
			success: true,
			outputPath,
			duration: (Date.now() - startTime) / 1000,
			data: {
				characters: result.result,
				count: result.result?.length ?? 0,
			},
		};
	} catch (err) {
		return {
			success: false,
			error: `Extract characters failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

/** vimax:generate-portraits — Generate character portraits using CharacterPortraitsGenerator. */
export async function handleVimaxGeneratePortraits(
	options: CLIRunOptions,
	onProgress: ProgressFn
): Promise<CLIResult> {
	const text = options.text || options.input;
	if (!text) {
		return {
			success: false,
			error:
				"Missing --text or --input (text with characters, or character JSON path)",
		};
	}

	onProgress({
		stage: "starting",
		percent: 0,
		message: "Generating character portraits...",
	});

	try {
		const { CharacterExtractor } = await import(
			"../../vimax/agents/character-extractor.js"
		);
		const { CharacterPortraitsGenerator } = await import(
			"../../vimax/agents/character-portraits.js"
		);

		const startTime = Date.now();
		const sessionId = `cli-${Date.now()}`;
		const outputDir = resolveOutputDir(options.outputDir, sessionId);

		let characters;

		// Check if input is a JSON file with pre-extracted characters
		if (fs.existsSync(text) && text.endsWith(".json")) {
			const content = fs.readFileSync(text, "utf-8");
			const parsed = JSON.parse(content);
			characters = Array.isArray(parsed) ? parsed : parsed.characters;
		} else {
			// Extract characters from text first
			let inputText = text;
			if (fs.existsSync(text)) {
				inputText = fs.readFileSync(text, "utf-8");
			}

			onProgress({
				stage: "extracting",
				percent: 10,
				message: "Extracting characters from text...",
			});
			const extractor = new CharacterExtractor({ model: options.llmModel });
			const extractResult = await extractor.process(inputText);

			if (!extractResult.success || !extractResult.result) {
				return {
					success: false,
					error: `Character extraction failed: ${extractResult.error}`,
				};
			}
			characters = extractResult.result;
		}

		// Apply --max-characters limit (guard against NaN from bad CLI input)
		const rawMaxChars = options.maxCharacters ?? 5;
		const maxChars = Number.isNaN(rawMaxChars) ? 5 : rawMaxChars;
		if (characters.length > maxChars) {
			characters = characters.slice(0, maxChars);
		}

		// Parse --views (comma-separated: front,side,back,three_quarter)
		const views = options.views
			? options.views.split(",").map((v: string) => v.trim())
			: undefined;

		onProgress({
			stage: "generating",
			percent: 30,
			message: `Generating portraits for ${characters.length} characters...`,
		});

		const generator = new CharacterPortraitsGenerator({
			image_model: options.imageModel,
			llm_model: options.llmModel,
			output_dir: path.join(outputDir, "portraits"),
			...(views ? { views } : {}),
		});

		const batchResult = await generator.generateBatch(characters);

		onProgress({ stage: "complete", percent: 100, message: "Done" });

		if (!batchResult.success) {
			return {
				success: false,
				error: `Portrait generation failed: ${batchResult.error}`,
			};
		}

		const portraitCount = Object.keys(batchResult.result ?? {}).length;

		// Save portrait registry JSON (default: true, disable with --save-registry=false)
		const shouldSaveRegistry = options.saveRegistry !== false;
		let registryPath: string | undefined;
		if (shouldSaveRegistry && batchResult.result) {
			try {
				const { CharacterPortraitRegistry } = await import(
					"../../vimax/types/character.js"
				);
				const registry = new CharacterPortraitRegistry(
					options.projectId || "cli-project"
				);
				for (const portrait of Object.values(
					batchResult.result as Record<
						string,
						import("../../vimax/types/character.js").CharacterPortrait
					>
				)) {
					registry.addPortrait(portrait);
				}
				registryPath = path.join(outputDir, "portraits", "registry.json");
				fs.writeFileSync(
					registryPath,
					JSON.stringify(registry.toJSON(), null, 2)
				);
			} catch {
				// Non-fatal: registry save is optional
			}
		}

		return {
			success: true,
			outputPath: path.join(outputDir, "portraits"),
			cost: (batchResult.metadata.cost as number) ?? 0,
			duration: (Date.now() - startTime) / 1000,
			data: {
				characters: portraitCount,
				portraits_generated: portraitCount,
				registry_path: registryPath,
			},
		};
	} catch (err) {
		return {
			success: false,
			error: `Generate portraits failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}
