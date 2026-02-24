/**
 * ViMax Registry Handlers
 *
 * create-registry, show-registry
 */

import * as fs from "fs";
import * as path from "path";
import type { CLIRunOptions, CLIResult } from "../cli-runner.js";

/** vimax:create-registry — Create portrait registry from directory of portrait files. */
export async function handleVimaxCreateRegistry(
	options: CLIRunOptions
): Promise<CLIResult> {
	const portraitsDir = options.input;
	if (!portraitsDir) {
		return {
			success: false,
			error: "Missing --input (portraits directory path)",
		};
	}

	try {
		const { CharacterPortraitRegistry } = await import(
			"../../vimax/types/character.js"
		);

		if (!fs.existsSync(portraitsDir)) {
			return {
				success: false,
				error: `Portraits directory not found: ${portraitsDir}`,
			};
		}

		const registry = new CharacterPortraitRegistry(
			options.projectId || "cli-project"
		);
		const entries = fs.readdirSync(portraitsDir, { withFileTypes: true });
		let characterCount = 0;

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const charDir = path.join(portraitsDir, entry.name);
			const portrait: Record<string, unknown> = {
				character_name: entry.name,
				description: "",
			};

			for (const viewFile of fs.readdirSync(charDir)) {
				const viewName = path
					.basename(viewFile, path.extname(viewFile))
					.toLowerCase();
				const viewPath = path.join(charDir, viewFile);

				if (!fs.statSync(viewPath).isFile()) continue;

				if (viewName === "front") portrait.front_view = viewPath;
				else if (viewName === "side") portrait.side_view = viewPath;
				else if (viewName === "back") portrait.back_view = viewPath;
				else if (viewName === "three_quarter")
					portrait.three_quarter_view = viewPath;
			}

			registry.addPortrait(
				portrait as unknown as import("../../vimax/types/character.js").CharacterPortrait
			);
			characterCount++;
		}

		const registryData = registry.toJSON();
		const outputPath = path.join(portraitsDir, "registry.json");
		fs.writeFileSync(outputPath, JSON.stringify(registryData, null, 2));

		return {
			success: true,
			outputPath,
			data: {
				characters: characterCount,
				registry_path: outputPath,
				message: `Registry created with ${characterCount} characters`,
			},
		};
	} catch (err) {
		return {
			success: false,
			error: `Create registry failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

/** vimax:show-registry — Display contents of a portrait registry file. */
export async function handleVimaxShowRegistry(
	options: CLIRunOptions
): Promise<CLIResult> {
	const registryPath = options.input;
	if (!registryPath) {
		return {
			success: false,
			error: "Missing --input (registry JSON file path)",
		};
	}

	try {
		const { CharacterPortraitRegistry, getPortraitViews } = await import(
			"../../vimax/types/character.js"
		);

		if (!fs.existsSync(registryPath)) {
			return {
				success: false,
				error: `Registry file not found: ${registryPath}`,
			};
		}

		const content = fs.readFileSync(registryPath, "utf-8");
		const data = JSON.parse(content);
		const registry = CharacterPortraitRegistry.fromJSON(data);

		const characters = registry.listCharacters();
		const details: Record<string, unknown>[] = [];

		for (const name of characters) {
			const portrait = registry.getPortrait(name);
			if (!portrait) continue;

			const views = getPortraitViews(portrait);
			details.push({
				name,
				description: portrait.description || "(none)",
				views: Object.keys(views).join(", ") || "(none)",
				view_count: Object.keys(views).length,
			});
		}

		return {
			success: true,
			data: {
				project_id: registry.project_id,
				characters: details,
				total_characters: characters.length,
			},
		};
	} catch (err) {
		return {
			success: false,
			error: `Show registry failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}
