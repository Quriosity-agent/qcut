/**
 * Editor Command Dispatcher
 *
 * Routes all `editor:*` CLI commands to the appropriate handler module.
 * Performs health check before dispatching (except for editor:health itself).
 *
 * @module electron/native-pipeline/cli-handlers-editor
 */

import type { CLIRunOptions, CLIResult } from "../cli/cli-runner.js";
import { createEditorClient } from "../editor/editor-api-client.js";
import type { EditorApiClient } from "../editor/editor-api-client.js";
import {
	handleEditorHealth,
	handleMediaProjectCommand,
} from "../editor/editor-handlers-media.js";
import { handleTimelineEditingCommand } from "../editor/editor-handlers-timeline.js";
import { handleAnalysisCommand } from "../editor/editor-handlers-analysis.js";
import { handleGenerateExportCommand } from "../editor/editor-handlers-generate.js";

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

			case "navigator":
				return await handleNavigatorCommand(client, options);

			default:
				return {
					success: false,
					error: `Unknown editor module: ${module}. Available: health, media, project, timeline, editing, analyze, transcribe, generate, export, diagnostics, mcp, navigator`,
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
	options: CLIRunOptions,
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
