/**
 * CLI Remotion Component Generation Handler
 *
 * Generates Remotion project folders from text prompts using Claude CLI
 * (`claude -p`) with full tool access. Claude reads the Remotion skills
 * (SKILL.md) and writes a proper folder structure (Root.tsx + components).
 * The folder can then be imported via the existing remotion-folder pipeline.
 *
 * @module electron/native-pipeline/cli-handlers-remotion
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import type { CLIRunOptions, CLIResult } from "../cli/cli-runner.js";
import { createEditorClient } from "../editor/editor-api-client.js";

type ProgressFn = (progress: {
	stage: string;
	percent: number;
	message: string;
	model?: string;
}) => void;

/**
 * Sanitize a string into a valid PascalCase React component name.
 */
function toComponentName(input: string): string {
	const words = input
		.replace(/[^a-zA-Z0-9\s]/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);

	if (words.length === 0) return "GeneratedComponent";

	const pascal = words
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join("");

	if (/^[0-9]/.test(pascal)) return `Component${pascal}`;
	return pascal;
}

/**
 * Locate the Remotion best-practices SKILL.md file.
 * Walks up from the CLI handler's directory to find the project root,
 * then checks `.agents/skills/remotion-best-practices/SKILL.md`.
 */
function findSkillPath(): string | null {
	// Try relative to process.cwd() first
	const candidates = [
		join(process.cwd(), ".agents/skills/remotion-best-practices/SKILL.md"),
		join(
			dirname(dirname(dirname(dirname(__filename)))),
			".agents/skills/remotion-best-practices/SKILL.md",
		),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) return resolve(candidate);
	}
	return null;
}

/**
 * Build the prompt that instructs Claude to read the Remotion skills
 * and generate a proper project folder.
 */
function buildRemotionPrompt({
	userPrompt,
	name,
	durationSeconds,
	fps,
	width,
	height,
	outputDir,
	skillPath,
}: {
	userPrompt: string;
	name: string;
	durationSeconds: number;
	fps: number;
	width: number;
	height: number;
	outputDir: string;
	skillPath: string | null;
}): string {
	const totalFrames = Math.round(durationSeconds * fps);
	const skillInstruction = skillPath
		? `First, read the Remotion skill file at "${skillPath}" to learn Remotion best practices. It references rule files — read whichever rules are relevant to this task (animations, timing, compositions, sequencing, transitions, text-animations, etc.).`
		: "";

	return `You are a Remotion video component generator.

${skillInstruction}

Generate a Remotion project folder at "${outputDir}/src/".

User request: "${userPrompt}"
Component name: "${name}"
Duration: ${durationSeconds}s at ${fps}fps (${totalFrames} frames)
Canvas: ${width}x${height}

Create these files:

1. "${outputDir}/src/Root.tsx" — exports RemotionRoot with <Composition> declaration(s)
2. "${outputDir}/src/${name}.tsx" — the main animation component
3. Any additional component files if needed for complex animations

Requirements:
- ALL animations driven by useCurrentFrame() + interpolate() with { extrapolateRight: "clamp" }
- CSS animations and Tailwind animation classes are FORBIDDEN
- Inline styles only (style={{ ... }}), no external CSS
- No dependencies beyond "remotion" and "react"
- Root.tsx must use <Composition id="..." component={...} durationInFrames={${totalFrames}} fps={${fps}} width={${width}} height={${height}} />
- Make it visually impressive and production-quality

Write the files now.`;
}

/** Invoke `claude -p` with all tools enabled, CWD set to output folder. */
function invokeClaude(
	prompt: string,
	cwd: string,
	signal: AbortSignal,
): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn("claude", ["-p", "--permission-mode", "bypassPermissions"], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, CLAUDECODE: "" },
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

		// Timeout after 5 minutes (folder generation is more complex)
		const timeoutId = setTimeout(() => {
			if (!settled) {
				child.kill("SIGTERM");
				reject(new Error("claude -p timed out after 300s"));
			}
		}, 300_000);

		child.on("close", (code) => {
			settled = true;
			clearTimeout(timeoutId);
			if (code !== 0) {
				reject(
					new Error(`claude -p failed (exit ${code}): ${stderr.trim()}`),
				);
			} else {
				resolvePromise(stdout);
			}
		});

		child.on("error", (err) => {
			settled = true;
			clearTimeout(timeoutId);
			reject(new Error(`claude -p failed: ${err.message}`));
		});

		child.stdin.write(prompt);
		child.stdin.end();

		const onAbort = () => {
			if (!settled) {
				settled = true;
				clearTimeout(timeoutId);
				child.kill("SIGTERM");
				reject(new Error("Aborted"));
			}
		};
		if (signal.aborted) {
			settled = true;
			clearTimeout(timeoutId);
			child.kill("SIGTERM");
			reject(new Error("Aborted"));
		} else {
			signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}

export async function handleGenerateRemotion(
	options: CLIRunOptions,
	onProgress: ProgressFn,
	_executor: unknown,
	signal: AbortSignal,
): Promise<CLIResult> {
	// 1. Validate
	const userPrompt = options.prompt || options.text;
	if (!userPrompt) {
		return {
			success: false,
			error:
				"Missing --prompt or --text/-t (description of the Remotion animation)",
		};
	}

	// 2. Derive component name
	const componentName = options.filename
		? toComponentName(options.filename)
		: toComponentName(userPrompt.slice(0, 60));

	// 3. Parse options
	const durationSeconds = options.duration ? Number(options.duration) : 5;
	const fps = options.fps ? Number(options.fps) : 30;
	const width = options.width ? Number(options.width) : 1920;
	const height = options.height ? Number(options.height) : 1080;

	if (Number.isNaN(durationSeconds) || durationSeconds <= 0) {
		return {
			success: false,
			error: "--duration must be a positive number (seconds)",
		};
	}

	const startTime = Date.now();
	onProgress({
		stage: "generating",
		percent: 0,
		message: `Generating Remotion project "${componentName}" via Claude...`,
	});

	// 4. Find Remotion skill
	const skillPath = findSkillPath();
	if (skillPath) {
		process.stderr.write(`[generate-remotion] Using skill: ${skillPath}\n`);
	} else {
		process.stderr.write("[generate-remotion] Remotion skill not found, proceeding without it\n");
	}

	// 5. Output directory — project folder per generation
	const baseOutputDir =
		options.outputDir || join(process.cwd(), "output");
	const projectDir = resolve(join(baseOutputDir, componentName));
	mkdirSync(join(projectDir, "src"), { recursive: true });

	// 6. Build prompt
	const prompt = buildRemotionPrompt({
		userPrompt,
		name: componentName,
		durationSeconds,
		fps,
		width,
		height,
		outputDir: projectDir,
		skillPath,
	});

	// 7. Call Claude CLI with all tools
	let responseText: string;
	try {
		responseText = await invokeClaude(prompt, projectDir, signal);
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
			duration: (Date.now() - startTime) / 1000,
		};
	}

	onProgress({
		stage: "processing",
		percent: 70,
		message: "Verifying generated project...",
	});

	// 8. Ensure package.json exists for folder import validation
	const pkgJsonPath = join(projectDir, "src", "package.json");
	if (!existsSync(pkgJsonPath)) {
		writeFileSync(
			pkgJsonPath,
			JSON.stringify(
				{
					name: componentName.toLowerCase(),
					version: "1.0.0",
					dependencies: { remotion: "*", react: "*" },
				},
				null,
				2,
			),
		);
	}

	// Verify Root.tsx was created
	const rootPath = join(projectDir, "src", "Root.tsx");
	if (!existsSync(rootPath)) {
		return {
			success: false,
			error: `Claude did not create Root.tsx at ${rootPath}. Response: ${responseText.slice(0, 200)}`,
			duration: (Date.now() - startTime) / 1000,
		};
	}

	// 9. Save metadata JSON
	const srcDir = resolve(join(projectDir, "src"));
	const output = {
		type: "remotion",
		name: componentName,
		prompt: userPrompt,
		folderPath: srcDir,
		duration: durationSeconds,
		width,
		height,
		fps,
		totalFrames: Math.round(durationSeconds * fps),
		generationDuration: (Date.now() - startTime) / 1000,
	};

	const jsonPath = join(projectDir, `${componentName}.json`);
	try {
		writeFileSync(jsonPath, JSON.stringify(output, null, 2));
	} catch {
		process.stderr.write(
			`[generate-remotion] Could not write metadata to ${jsonPath}\n`,
		);
	}

	// 10. Timeline integration
	if (options.addToTimeline && options.projectId) {
		try {
			const timelineResult = await addRemotionToTimeline(
				options,
				componentName,
				srcDir,
				durationSeconds,
				onProgress,
			);
			if (!timelineResult.success) {
				process.stderr.write(
					`[generate-remotion] Timeline integration failed: ${timelineResult.error}\n`,
				);
			}
		} catch (err) {
			process.stderr.write(
				`[generate-remotion] Timeline integration failed: ${err instanceof Error ? err.message : String(err)}\n`,
			);
		}
	}

	onProgress({
		stage: "complete",
		percent: 100,
		message: `Generated Remotion project: ${componentName}/src/`,
	});

	return {
		success: true,
		outputPath: srcDir,
		data: output,
		duration: output.generationDuration,
	};
}

/** Add generated Remotion folder to editor timeline via folder import. */
async function addRemotionToTimeline(
	options: CLIRunOptions,
	componentName: string,
	folderPath: string,
	durationSeconds: number,
	onProgress: ProgressFn,
): Promise<{ success: boolean; error?: string }> {
	const projectId = options.projectId!;
	const client = createEditorClient(options);

	const healthy = await client.checkHealth();
	if (!healthy) {
		return { success: false, error: "QCut editor not reachable" };
	}

	onProgress({
		stage: "timeline",
		percent: 85,
		message: "Importing Remotion project to timeline...",
	});

	try {
		await client.post(`/api/claude/timeline/${projectId}/elements`, {
			type: "remotion",
			sourceId: `generated-${componentName}`,
			sourceName: componentName,
			folderPath,
			startTime: 0,
			duration: durationSeconds,
		});
	} catch (err) {
		return {
			success: false,
			error: `Failed to add remotion element: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	onProgress({
		stage: "timeline",
		percent: 100,
		message: `Added "${componentName}" to timeline`,
	});

	return { success: true };
}
