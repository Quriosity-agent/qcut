/**
 * CLI Moyin Script Parsing Handler
 *
 * Parses screenplay/story text into structured ScriptData (characters, scenes,
 * episodes) using Claude CLI as the LLM backend. Runs standalone without
 * Electron — no API keys required.
 *
 * Usage:
 *   qcut-pipeline moyin:parse-script --script screenplay.txt --json
 *   cat script.txt | qcut-pipeline moyin:parse-script --input - --json
 *
 * @module electron/native-pipeline/cli/cli-handlers-moyin
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type {
	CLIRunOptions,
	CLIResult,
	ProgressFn,
} from "./cli-runner/types.js";
import { createEditorClient } from "../editor/editor-api-client.js";

const CLAUDE_CLI_TIMEOUT_MS = 300_000;

const PARSE_SYSTEM_PROMPT = `You are a professional screenplay analyst. Analyze the screenplay/story text provided by the user and extract structured information.

Return results strictly in the following JSON format (no other text):
{
  "title": "Story title",
  "genre": "Genre (e.g., romance, thriller, comedy)",
  "logline": "One-sentence summary",
  "characters": [
    {
      "id": "char_1",
      "name": "Character name",
      "gender": "Gender",
      "age": "Age",
      "role": "Detailed identity/background description including occupation, status, backstory",
      "personality": "Detailed personality description including behavior patterns, values",
      "traits": "Core traits description including key abilities and characteristics",
      "skills": "Skills/abilities (martial arts, magic, professional skills, etc.)",
      "keyActions": "Key actions/deeds, important historical events",
      "appearance": "Physical appearance (if mentioned)",
      "relationships": "Relationships with other characters",
      "tags": ["Character tags, e.g.: protagonist, swordsman, villain"],
      "notes": "Character notes (plot context)"
    }
  ],
  "episodes": [
    {
      "id": "ep_1",
      "index": 1,
      "title": "Episode 1 title",
      "description": "Episode summary",
      "sceneIds": ["scene_1", "scene_2"]
    }
  ],
  "scenes": [
    {
      "id": "scene_1",
      "name": "Scene name (specific and identifiable)",
      "location": "Detailed location description including architecture, environment, geography",
      "time": "Time setting (day/night/dawn/dusk/noon/midnight)",
      "atmosphere": "Detailed atmosphere description",
      "visualPrompt": "Detailed visual description in English for concept art generation (lighting, weather, architecture style, special elements)",
      "tags": ["Scene element tags, e.g.: ancient, forest, ruins"],
      "notes": "Location notes (plot context)"
    }
  ],
  "storyParagraphs": [
    {
      "id": 1,
      "text": "Paragraph content",
      "sceneRefId": "scene_1"
    }
  ]
}

Important requirements:
1. Character info must be detailed - preserve all details from the source text
2. Scene design must be detailed - scenes are the foundation for visual generation
3. Identify multi-episode structure if present ("Episode X", "Chapter X", etc.)
4. If no episode markers, create a single episode containing all scenes
5. Character IDs use char_1, char_2 format
6. Scene IDs use scene_1, scene_2 format
7. Episode IDs use ep_1, ep_2 format
8. visualPrompt for scenes must be in English`;

/** Read script text from --script (file), --input (file/stdin), or --text (inline). */
function readScriptInput(options: CLIRunOptions): string | null {
	// --script <file>
	if (options.script) {
		const scriptPath = resolve(options.script);
		if (!existsSync(scriptPath)) {
			return null;
		}
		return readFileSync(scriptPath, "utf-8");
	}

	// --input (already resolved to content by runner.ts if "-")
	if (options.input) {
		const inputPath = resolve(options.input);
		if (existsSync(inputPath)) {
			return readFileSync(inputPath, "utf-8");
		}
		// If not a file path, treat as inline text (stdin content from runner)
		return options.input;
	}

	// --text "inline script"
	if (options.text) {
		return options.text;
	}

	return null;
}

/** Spawn claude -p with system prompt and user prompt via stdin. */
function callClaudeCLI(
	systemPrompt: string,
	userPrompt: string
): Promise<string> {
	return new Promise((resolveP, reject) => {
		const args = ["-p", "--model", "sonnet", "--system-prompt", systemPrompt];

		const env = { ...process.env };
		delete env.CLAUDECODE;
		delete env.CLAUDE_CODE_ENTRYPOINT;
		delete env.CLAUDE_CODE_SSE_PORT;

		const child = spawn("claude", args, {
			stdio: ["pipe", "pipe", "pipe"],
			env,
		});

		let stdout = "";
		let stderr = "";
		let settled = false;

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		const timeoutId = setTimeout(() => {
			if (!settled) {
				settled = true;
				child.kill("SIGTERM");
				reject(new Error("Claude CLI timed out after 300s"));
			}
		}, CLAUDE_CLI_TIMEOUT_MS);

		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			if (code !== 0) {
				reject(
					new Error(
						`Claude CLI failed (exit ${code}): ${stderr.trim().slice(0, 200)}`
					)
				);
			} else {
				const text = stdout.trim();
				if (!text) {
					reject(new Error("Empty response from Claude CLI"));
				} else {
					resolveP(text);
				}
			}
		});

		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			reject(
				new Error(
					`Claude CLI not found: ${err.message}. Install with: npm install -g @anthropic-ai/claude-code`
				)
			);
		});

		child.stdin.write(userPrompt);
		child.stdin.end();
	});
}

/** Extract the outermost JSON object from an LLM response. */
function extractJSON(response: string): Record<string, unknown> {
	// Strip markdown code fences
	const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
	let cleaned = jsonMatch ? jsonMatch[1].trim() : response.trim();

	// Find outermost JSON object via brace matching
	const firstBrace = cleaned.indexOf("{");
	if (firstBrace === -1) {
		throw new Error("No JSON found in LLM response");
	}

	let depth = 0;
	let endIdx = firstBrace;
	for (let i = firstBrace; i < cleaned.length; i++) {
		if (cleaned[i] === "{") depth++;
		if (cleaned[i] === "}") depth--;
		if (depth === 0) {
			endIdx = i;
			break;
		}
	}
	cleaned = cleaned.substring(firstBrace, endIdx + 1);

	return JSON.parse(cleaned);
}

export async function handleMoyinParseScript(
	options: CLIRunOptions,
	onProgress: ProgressFn
): Promise<CLIResult> {
	const startTime = Date.now();

	// 1. Read script input
	const rawScript = readScriptInput(options);
	if (!rawScript || !rawScript.trim()) {
		return {
			success: false,
			error:
				"Missing script input. Use --script <file>, --input <file>, --text <text>, or pipe via --input -",
		};
	}

	onProgress({
		stage: "parsing",
		percent: 10,
		message: `Parsing script (${rawScript.length} chars) via Claude CLI...`,
	});

	// 2. Build user prompt with optional language/scene hints
	let userPrompt = rawScript;
	if (options.language && options.language !== "auto") {
		userPrompt = `[Language: ${options.language}]\n\n${userPrompt}`;
	}
	if (options.maxScenes) {
		userPrompt = `[Max scenes: ${options.maxScenes}]\n\n${userPrompt}`;
	}

	// 3. Call Claude CLI
	let response: string;
	try {
		response = await callClaudeCLI(PARSE_SYSTEM_PROMPT, userPrompt);
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
			duration: (Date.now() - startTime) / 1000,
		};
	}

	onProgress({
		stage: "extracting",
		percent: 80,
		message: "Extracting structured data from response...",
	});

	// 4. Extract JSON
	let parsed: Record<string, unknown>;
	try {
		parsed = extractJSON(response);
	} catch (err) {
		return {
			success: false,
			error: `Failed to extract JSON from response: ${err instanceof Error ? err.message : String(err)}`,
			duration: (Date.now() - startTime) / 1000,
		};
	}

	// 5. Write output
	const outputDir = resolve(options.outputDir || "./output");
	mkdirSync(outputDir, { recursive: true });
	const outputPath = join(outputDir, "parsed-script.json");
	writeFileSync(outputPath, JSON.stringify(parsed, null, 2));

	const characters = (parsed.characters as unknown[])?.length || 0;
	const scenes = (parsed.scenes as unknown[])?.length || 0;
	const episodes = (parsed.episodes as unknown[])?.length || 0;
	const duration = (Date.now() - startTime) / 1000;

	// 6. Push parsed data to running QCut editor UI (if reachable)
	try {
		const client = createEditorClient(options);
		const healthy = await client.checkHealth();
		if (healthy) {
			await client.post("/api/claude/moyin/parse-result", {
				scriptData: parsed,
			});
			onProgress({
				stage: "ui-update",
				percent: 95,
				message: "Pushed parsed data to Director panel",
			});
		}
	} catch {
		// Editor not running — skip UI update silently
	}

	onProgress({
		stage: "complete",
		percent: 100,
		message: `Parsed: ${characters} characters, ${scenes} scenes, ${episodes} episodes (${duration.toFixed(1)}s)`,
	});

	return {
		success: true,
		outputPath,
		duration,
		data: {
			title: parsed.title,
			genre: parsed.genre,
			logline: parsed.logline,
			characters,
			scenes,
			episodes,
		},
	};
}
