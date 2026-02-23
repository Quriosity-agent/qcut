/**
 * Editor Handlers — Media + Project
 *
 * CLI handlers for editor:health, editor:media:*, and editor:project:*
 * commands. Each handler proxies to the QCut HTTP API via EditorApiClient.
 *
 * @module electron/native-pipeline/editor-handlers-media
 */

import * as fs from "fs";
import type { EditorApiClient } from "../editor/editor-api-client.js";
import type { CLIRunOptions, CLIResult } from "../cli/cli-runner.js";
import { resolveJsonInput } from "./editor-api-types.js";

type ProgressFn = (progress: {
	stage: string;
	percent: number;
	message: string;
}) => void;

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function handleMediaProjectCommand(
	client: EditorApiClient,
	options: CLIRunOptions,
	_onProgress: ProgressFn
): Promise<CLIResult> {
	const parts = options.command.split(":");
	const module = parts[1]; // "media" or "project"
	const action = parts[2]; // e.g. "list", "import", "settings"

	try {
		if (module === "media") {
			return await dispatchMedia(client, action, options);
		}
		if (module === "project") {
			return await dispatchProject(client, action, options);
		}
		return { success: false, error: `Unknown module: ${module}` };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function handleEditorHealth(
	client: EditorApiClient
): Promise<CLIResult> {
	try {
		const data = await client.get("/api/claude/health");
		return { success: true, data };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

// ---------------------------------------------------------------------------
// Media handlers
// ---------------------------------------------------------------------------

async function dispatchMedia(
	client: EditorApiClient,
	action: string,
	opts: CLIRunOptions
): Promise<CLIResult> {
	switch (action) {
		case "list":
			return mediaList(client, opts);
		case "info":
			return mediaInfo(client, opts);
		case "import":
			return mediaImport(client, opts);
		case "import-url":
			return mediaImportUrl(client, opts);
		case "batch-import":
			return mediaBatchImport(client, opts);
		case "extract-frame":
			return mediaExtractFrame(client, opts);
		case "rename":
			return mediaRename(client, opts);
		case "delete":
			return mediaDelete(client, opts);
		default:
			return { success: false, error: `Unknown media action: ${action}` };
	}
}

async function mediaList(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	const data = await client.get(`/api/claude/media/${opts.projectId}`);
	return { success: true, data };
}

async function mediaInfo(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const o = opts as CLIRunOptions & { mediaId?: string };
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	if (!o.mediaId) return { success: false, error: "Missing --media-id" };
	const data = await client.get(
		`/api/claude/media/${opts.projectId}/${o.mediaId}`
	);
	return { success: true, data };
}

async function mediaImport(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	if (!opts.source) return { success: false, error: "Missing --source" };

	if (!fs.existsSync(opts.source)) {
		return { success: false, error: `File not found: ${opts.source}` };
	}

	const data = await client.post(`/api/claude/media/${opts.projectId}/import`, {
		source: opts.source,
	});
	return { success: true, data };
}

async function mediaImportUrl(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const o = opts as CLIRunOptions & { url?: string; filename?: string };
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	// Check both the dedicated url field and the imageUrl field for flexibility
	const url = o.url ?? opts.imageUrl;
	if (!url) return { success: false, error: "Missing --url" };

	const body: Record<string, string> = { url };
	if (o.filename) body.filename = o.filename;

	const data = await client.post(
		`/api/claude/media/${opts.projectId}/import-from-url`,
		body
	);
	return { success: true, data };
}

async function mediaBatchImport(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const o = opts as CLIRunOptions & { items?: string };
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	if (!o.items)
		return {
			success: false,
			error: "Missing --items (JSON array or @file.json)",
		};

	const parsed = await resolveJsonInput(o.items);
	const items = Array.isArray(parsed)
		? parsed
		: (parsed as { items?: unknown[] }).items;
	if (!Array.isArray(items)) {
		return { success: false, error: "--items must be a JSON array" };
	}
	if (items.length > 20) {
		return {
			success: false,
			error: `Batch limit exceeded: ${items.length} items (max 20)`,
		};
	}

	// Normalize: accept "source" field as alias for "path"
	const normalizedItems = items.map((item: Record<string, unknown>) => {
		if (item.source && !item.path && !item.url) {
			const { source, ...rest } = item;
			return { ...rest, path: source };
		}
		return item;
	});

	const data = await client.post(
		`/api/claude/media/${opts.projectId}/batch-import`,
		{ items: normalizedItems }
	);
	return { success: true, data };
}

async function mediaExtractFrame(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const o = opts as CLIRunOptions & {
		mediaId?: string;
		timestamp?: string;
	};
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	if (!o.mediaId) return { success: false, error: "Missing --media-id" };
	// Accept timestamp from the dedicated field or from startTime
	const tsStr =
		o.timestamp ??
		String((opts as CLIRunOptions & { startTime?: string }).startTime ?? "");
	const timestamp = parseFloat(tsStr);
	if (Number.isNaN(timestamp)) {
		return { success: false, error: "Missing or invalid --timestamp" };
	}

	const body: Record<string, unknown> = { timestamp };
	if (opts.outputFormat) body.format = opts.outputFormat;

	const data = await client.post(
		`/api/claude/media/${opts.projectId}/${o.mediaId}/extract-frame`,
		body
	);
	return { success: true, data };
}

async function mediaRename(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const o = opts as CLIRunOptions & {
		mediaId?: string;
		newName?: string;
	};
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	if (!o.mediaId) return { success: false, error: "Missing --media-id" };
	if (!o.newName) return { success: false, error: "Missing --new-name" };

	const data = await client.patch(
		`/api/claude/media/${opts.projectId}/${o.mediaId}/rename`,
		{ newName: o.newName }
	);
	return { success: true, data };
}

async function mediaDelete(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const o = opts as CLIRunOptions & { mediaId?: string };
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	if (!o.mediaId) return { success: false, error: "Missing --media-id" };

	const data = await client.delete(
		`/api/claude/media/${opts.projectId}/${o.mediaId}`
	);
	return { success: true, data };
}

// ---------------------------------------------------------------------------
// Project handlers
// ---------------------------------------------------------------------------

async function dispatchProject(
	client: EditorApiClient,
	action: string,
	opts: CLIRunOptions
): Promise<CLIResult> {
	switch (action) {
		case "settings":
			return projectSettings(client, opts);
		case "update-settings":
			return projectUpdateSettings(client, opts);
		case "stats":
			return projectStats(client, opts);
		case "summary":
			return projectSummary(client, opts);
		case "report":
			return projectReport(client, opts);
		default:
			return {
				success: false,
				error: `Unknown project action: ${action}`,
			};
	}
}

async function projectSettings(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	const data = await client.get(
		`/api/claude/project/${opts.projectId}/settings`
	);
	return { success: true, data };
}

async function projectUpdateSettings(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const o = opts as CLIRunOptions & { data?: string };
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	// Accept --data as the JSON settings
	const dataStr = o.data ?? opts.input;
	if (!dataStr)
		return {
			success: false,
			error: "Missing --data (JSON settings object)",
		};

	const settings = await resolveJsonInput(dataStr);
	const data = await client.patch(
		`/api/claude/project/${opts.projectId}/settings`,
		settings
	);
	return { success: true, data };
}

async function projectStats(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	const data = await client.get(`/api/claude/project/${opts.projectId}/stats`);
	return { success: true, data };
}

async function projectSummary(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	const data = await client.get(
		`/api/claude/project/${opts.projectId}/summary`
	);
	return { success: true, data };
}

async function projectReport(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const o = opts as CLIRunOptions & { clearLog?: boolean };
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };

	const body: Record<string, unknown> = {};
	if (opts.outputDir && opts.outputDir !== "./output") {
		body.outputDir = opts.outputDir;
	}
	if (o.clearLog) body.clearLog = true;

	const data = await client.post(
		`/api/claude/project/${opts.projectId}/report`,
		body
	);
	return { success: true, data };
}
