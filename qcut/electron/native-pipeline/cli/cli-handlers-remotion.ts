/**
 * CLI Remotion Component Generation Handler
 *
 * Generates Remotion .tsx components from text prompts using Claude CLI
 * (`claude -p`), writes them to the project's remotion/generated/ folder,
 * and optionally registers + adds them to the editor timeline.
 *
 * @module electron/native-pipeline/cli-handlers-remotion
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
 * Strips non-alphanumeric chars, capitalizes word boundaries, ensures
 * it starts with an uppercase letter.
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
 * Build the prompt for Claude CLI that wraps the user's description
 * with Remotion best-practice constraints.
 */
function buildRemotionPrompt({
	userPrompt,
	name,
	durationSeconds,
	fps,
	width,
	height,
}: {
	userPrompt: string;
	name: string;
	durationSeconds: number;
	fps: number;
	width: number;
	height: number;
}): string {
	const totalFrames = Math.round(durationSeconds * fps);

	return `Output ONLY raw TypeScript/TSX code. No markdown, no explanation, no commentary, no questions. Start your response with "import" and end with the export default statement.

Generate a Remotion React component (.tsx file).

Component name: "${name}"
User description: "${userPrompt}"
Duration: ${durationSeconds} seconds at ${fps}fps (${totalFrames} frames total)
Canvas: ${width}x${height}

Rules:
- Import useCurrentFrame, useVideoConfig, interpolate from "remotion"
- ALL animations use useCurrentFrame() + interpolate() with { extrapolateRight: "clamp" }
- CSS animations and Tailwind animation classes are FORBIDDEN
- Export default the component
- Inline styles only (style={{ ... }}), no external CSS
- Fill ${width}x${height} (use width: "100%", height: "100%")
- No dependencies beyond "remotion" and "react"
- Make it visually impressive

Your entire response must be valid TSX code starting with "import" — nothing else.`;
}

/**
 * Extract .tsx source code from Claude CLI response.
 * Strips markdown fences, preamble text, and trailing commentary.
 */
function extractTsxSource(responseText: string): string {
	let source = responseText.trim();

	// Strip ```tsx ... ``` or ```typescript ... ``` fences
	source = source
		.replace(/^```(?:tsx|typescript|jsx|js)?\s*\n?/m, "")
		.replace(/\n?```\s*$/m, "")
		.trim();

	// Strip any preamble text before the first import statement
	const importIndex = source.indexOf("import ");
	if (importIndex > 0) {
		source = source.slice(importIndex);
	}

	// Strip trailing text after the last export default or closing semicolon
	const lastExportDefault = source.lastIndexOf("export default ");
	if (lastExportDefault >= 0) {
		// Find the end of the export default statement (semicolon + newline)
		const afterExport = source.indexOf(";", lastExportDefault);
		if (afterExport >= 0) {
			source = source.slice(0, afterExport + 1);
		}
	}

	return source.trim();
}

/** Invoke `claude -p` with prompt via stdin, return stdout. */
function invokeClaude(
	prompt: string,
	cwd: string,
	signal: AbortSignal,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn("claude", ["-p", "--allowedTools", ""], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, CLAUDECODE: "" },
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`claude -p failed (exit ${code}): ${stderr.trim()}`));
			} else {
				resolve(stdout);
			}
		});

		child.on("error", (err) => {
			reject(new Error(`claude -p failed: ${err.message}`));
		});

		// Write prompt via stdin then close
		child.stdin.write(prompt);
		child.stdin.end();

		// Forward abort signal
		const onAbort = () => {
			child.kill("SIGTERM");
			reject(new Error("Aborted"));
		};
		if (signal.aborted) {
			child.kill("SIGTERM");
			reject(new Error("Aborted"));
		} else {
			signal.addEventListener("abort", onAbort, { once: true });
		}

		// Timeout after 2 minutes
		setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error("claude -p timed out after 120s"));
		}, 120_000);
	});
}

export async function handleGenerateRemotion(
	options: CLIRunOptions,
	onProgress: ProgressFn,
	_executor: unknown,
	signal: AbortSignal,
): Promise<CLIResult> {
	// 1. Validate: prompt is required
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

	// 3. Parse dimension/duration options
	const durationSeconds = options.duration ? Number(options.duration) : 5;
	const fps = 30;
	const width = 1920;
	const height = 1080;

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
		message: `Generating Remotion component "${componentName}" via Claude...`,
	});

	// 4. Build prompt with Remotion constraints
	const wrappedPrompt = buildRemotionPrompt({
		userPrompt,
		name: componentName,
		durationSeconds,
		fps,
		width,
		height,
	});

	// 5. Output directory
	const outputDir =
		options.outputDir || join(process.cwd(), "remotion", "generated");
	mkdirSync(outputDir, { recursive: true });

	// 6. Call Claude CLI
	let responseText: string;
	try {
		responseText = await invokeClaude(wrappedPrompt, outputDir, signal);
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
			duration: (Date.now() - startTime) / 1000,
		};
	}

	onProgress({
		stage: "processing",
		percent: 60,
		message: "Parsing generated component...",
	});

	if (!responseText.trim()) {
		return {
			success: false,
			error: "Claude returned empty response",
			duration: (Date.now() - startTime) / 1000,
		};
	}

	const tsxSource = extractTsxSource(responseText);

	// Validate that we got actual code, not a description
	if (!tsxSource.includes("import ") || !tsxSource.includes("remotion")) {
		return {
			success: false,
			error:
				"Claude did not return valid Remotion code. Try running again.",
			duration: (Date.now() - startTime) / 1000,
		};
	}

	// 7. Write component file
	const tsxFilename = `${componentName}.tsx`;
	const tsxPath = join(outputDir, tsxFilename);

	onProgress({
		stage: "writing",
		percent: 70,
		message: `Writing ${tsxFilename}...`,
	});

	try {
		writeFileSync(tsxPath, tsxSource, "utf-8");
	} catch (err) {
		return {
			success: false,
			error: `Failed to write ${tsxPath}: ${err instanceof Error ? err.message : String(err)}`,
			duration: (Date.now() - startTime) / 1000,
		};
	}

	// 8. Save metadata JSON
	const output = {
		type: "remotion",
		name: componentName,
		prompt: userPrompt,
		componentPath: tsxPath,
		duration: durationSeconds,
		width,
		height,
		fps,
		totalFrames: Math.round(durationSeconds * fps),
		generationDuration: (Date.now() - startTime) / 1000,
	};

	const jsonPath = join(outputDir, `${componentName}.json`);
	try {
		writeFileSync(jsonPath, JSON.stringify(output, null, 2));
	} catch {
		console.warn(`[generate-remotion] Could not write metadata to ${jsonPath}`);
	}

	// 9. Timeline integration
	if (options.addToTimeline && options.projectId) {
		const timelineResult = await addRemotionToTimeline(
			options,
			componentName,
			tsxPath,
			durationSeconds,
			onProgress,
		);
		if (!timelineResult.success) {
			console.error(
				`[generate-remotion] Timeline integration failed: ${timelineResult.error}`,
			);
		}
	}

	onProgress({
		stage: "complete",
		percent: 100,
		message: `Generated ${tsxFilename}`,
	});

	return {
		success: true,
		outputPath: tsxPath,
		data: output,
		duration: output.generationDuration,
	};
}

/** Add generated Remotion component to editor timeline. */
async function addRemotionToTimeline(
	options: CLIRunOptions,
	componentName: string,
	componentPath: string,
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
		message: "Adding Remotion component to timeline...",
	});

	try {
		await client.post(`/api/claude/timeline/${projectId}/elements`, {
			type: "remotion",
			sourceId: `generated-${componentName}`,
			sourceName: componentName,
			componentPath,
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
