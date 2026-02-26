/**
 * Editor Command Dispatcher
 *
 * Routes all `editor:*` CLI commands to the appropriate handler module.
 * Performs health check before dispatching (except for editor:health itself).
 *
 * @module electron/native-pipeline/cli-handlers-editor
 */

import type { CLIRunOptions, CLIResult } from "./cli-runner/types.js";
import { createEditorClient } from "../editor/editor-api-client.js";
import type { EditorApiClient } from "../editor/editor-api-client.js";
import {
	handleEditorHealth,
	handleMediaProjectCommand,
} from "../editor/editor-handlers-media.js";
import { handleTimelineEditingCommand } from "../editor/editor-handlers-timeline.js";
import { handleAnalysisCommand } from "../editor/editor-handlers-analysis.js";
import { handleGenerateExportCommand } from "../editor/editor-handlers-generate.js";
import { handleRemotionCommand } from "../editor/editor-handlers-remotion.js";

type ProgressFn = (progress: {
	stage: string;
	percent: number;
	message: string;
	model?: string;
}) => void;

/**
 * Main entry point for all `editor:*` commands.
 * Called from cli-runner.ts when command starts with "editor:".
 */
export async function handleEditorCommand(
	options: CLIRunOptions,
	onProgress: ProgressFn
): Promise<CLIResult> {
	const client = createEditorClient(options);

	// Health check before any command (skip for editor:health itself)
	if (options.command !== "editor:health") {
		const healthy = await client.checkHealth();
		if (!healthy) {
			const host = options.host ?? process.env.QCUT_API_HOST ?? "127.0.0.1";
			const port = options.port ?? process.env.QCUT_API_PORT ?? "8765";
			return {
				success: false,
				error: `QCut editor not running at http://${host}:${port}\nStart QCut with: bun run electron:dev`,
			};
		}
	}

	// Extract module: "editor:media:list" → "media"
	const parts = options.command.split(":");
	const module = parts[1];

	try {
		switch (module) {
			case "health":
				return await handleEditorHealth(client);

			case "media":
			case "project":
				return await handleMediaProjectCommand(client, options, onProgress);

			case "timeline":
			case "editing":
				return await handleTimelineEditingCommand(client, options, onProgress);

			case "analyze":
			case "transcribe":
				return await handleAnalysisCommand(client, options, onProgress);

			case "generate":
			case "export":
			case "diagnostics":
			case "mcp":
				return await handleGenerateExportCommand(client, options, onProgress);

			case "remotion":
				return await handleRemotionCommand(client, options);

			case "navigator":
				return await handleNavigatorCommand(client, options);

			case "screen-recording":
				return await handleScreenRecordingCommand(client, options);

			case "ui":
				return await handleUiCommand(client, options);

			case "moyin":
				return await handleMoyinCommand(client, options);

			case "screenshot":
				return await handleScreenshotCommand(client, options);

			default:
				return {
					success: false,
					error: `Unknown editor module: ${module}. Available: health, media, project, timeline, editing, analyze, transcribe, generate, export, diagnostics, mcp, remotion, navigator, screen-recording, ui, moyin, screenshot`,
				};
		}
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/**
 * Handle `editor:navigator:*` commands.
 * - `projects` — list all saved projects
 * - `open` — navigate the editor to a specific project
 */
async function handleNavigatorCommand(
	client: EditorApiClient,
	options: CLIRunOptions
): Promise<CLIResult> {
	const parts = options.command.split(":");
	const action = parts[2]; // "projects" or "open"

	switch (action) {
		case "projects": {
			const data = await client.get("/api/claude/navigator/projects");
			return { success: true, data };
		}
		case "open": {
			if (!options.projectId) {
				return {
					success: false,
					error: "Missing --project-id",
				};
			}
			const data = await client.post("/api/claude/navigator/open", {
				projectId: options.projectId,
			});
			return { success: true, data };
		}
		default:
			return {
				success: false,
				error: `Unknown navigator action: ${action}. Available: projects, open`,
			};
	}
}

/**
 * Handle `editor:screen-recording:*` commands.
 * - `sources` — list available capture sources
 * - `start` — start screen recording
 * - `stop` — stop screen recording
 * - `status` — get current recording status
 */
async function handleScreenRecordingCommand(
	client: EditorApiClient,
	options: CLIRunOptions
): Promise<CLIResult> {
	const parts = options.command.split(":");
	const action = parts[2];

	switch (action) {
		case "sources": {
			const data = await client.get("/api/claude/screen-recording/sources");
			return { success: true, data };
		}
		case "start": {
			const body: Record<string, unknown> = {};
			if (options.sourceId) body.sourceId = options.sourceId;
			if (options.filename) body.fileName = options.filename;
			const data = await client.post(
				"/api/claude/screen-recording/start",
				body
			);
			return { success: true, data };
		}
		case "stop": {
			const body: Record<string, unknown> = {};
			if (options.discard) body.discard = true;
			const data = await client.post("/api/claude/screen-recording/stop", body);
			return { success: true, data };
		}
		case "status": {
			const data = await client.get("/api/claude/screen-recording/status");
			return { success: true, data };
		}
		default:
			return {
				success: false,
				error: `Unknown screen-recording action: ${action}. Available: sources, start, stop, status`,
			};
	}
}

/**
 * Handle `editor:ui:*` commands.
 * - `switch-panel` — switch to a specific editor panel
 */
async function handleUiCommand(
	client: EditorApiClient,
	options: CLIRunOptions
): Promise<CLIResult> {
	const parts = options.command.split(":");
	const action = parts[2]; // "switch-panel"

	switch (action) {
		case "switch-panel": {
			const panel = options.panel;
			if (!panel) {
				return {
					success: false,
					error:
						"Missing --panel. Available: media, text, stickers, video-edit, effects, transitions, filters, text2image, nano-edit, ai, sounds, segmentation, remotion, pty, word-timeline, project-folder, upscale, moyin. Aliases: terminal, skills, library, ai-video, ai-images, audio-studio, smart-speech, project. Use --tab for moyin inner tabs: overview (structure), characters, scenes, shots, generate",
				};
			}
			const body: Record<string, string> = { panel };
			if (options.tab) {
				body.tab = options.tab;
			}
			const data = await client.post("/api/claude/ui/switch-panel", body);
			return { success: true, data };
		}
		default:
			return {
				success: false,
				error: `Unknown ui action: ${action}. Available: switch-panel`,
			};
	}
}

/**
 * Handle `editor:moyin:*` commands.
 * - `set-script` — push script text into the moyin textarea
 * - `parse` — trigger the "Parse Script" button
 * - `status` — poll pipeline progress
 */
async function handleMoyinCommand(
	client: EditorApiClient,
	options: CLIRunOptions
): Promise<CLIResult> {
	const parts = options.command.split(":");
	const action = parts[2]; // "set-script", "parse", "status"

	switch (action) {
		case "set-script": {
			if (options.text && options.script) {
				return {
					success: false,
					error:
						"--text and --script are mutually exclusive. Use --text for inline text or --script for a file path.",
				};
			}
			if (!options.text && !options.script) {
				return {
					success: false,
					error:
						"Missing --text or --script. Provide script text inline or as a file path.",
				};
			}
			// If --script is a file path, read it
			let scriptText = options.text ?? "";
			if (options.script) {
				try {
					const fs = await import("node:fs/promises");
					scriptText = await fs.readFile(options.script, "utf-8");
				} catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					return {
						success: false,
						error: `Failed to read script file: ${options.script}. ${reason}`,
					};
				}
			}
			const data = await client.post("/api/claude/moyin/set-script", {
				text: scriptText,
			});
			return { success: true, data };
		}
		case "parse": {
			const data = await client.post("/api/claude/moyin/parse", {});
			return { success: true, data };
		}
		case "status": {
			const data = await client.get("/api/claude/moyin/status");
			return { success: true, data };
		}
		default:
			return {
				success: false,
				error: `Unknown moyin action: ${action}. Available: set-script, parse, status`,
			};
	}
}

/**
 * Handle `editor:screenshot:*` commands.
 * - `capture` — take a screenshot of the QCut window
 */
async function handleScreenshotCommand(
	client: EditorApiClient,
	options: CLIRunOptions
): Promise<CLIResult> {
	const parts = options.command.split(":");
	const action = parts[2]; // "capture"

	switch (action) {
		case "capture": {
			const body: Record<string, unknown> = {};
			if (options.filename) body.fileName = options.filename;
			const data = await client.post("/api/claude/screenshot/capture", body);
			return { success: true, data };
		}
		default:
			return {
				success: false,
				error: `Unknown screenshot action: ${action}. Available: capture`,
			};
	}
}
