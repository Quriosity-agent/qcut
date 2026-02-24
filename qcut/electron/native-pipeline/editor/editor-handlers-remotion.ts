/**
 * Editor Handlers — Remotion
 *
 * CLI handlers for `editor:remotion:*` commands.
 * Proxies to the QCut HTTP API to list, inspect, update, and export
 * Remotion elements on the timeline.
 *
 * @module electron/native-pipeline/editor/editor-handlers-remotion
 */

import type { EditorApiClient } from "./editor-api-client.js";
import type { CLIRunOptions, CLIResult } from "../cli/cli-runner.js";
import { resolveJsonInput } from "./editor-api-types.js";

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function handleRemotionCommand(
	client: EditorApiClient,
	options: CLIRunOptions
): Promise<CLIResult> {
	const parts = options.command.split(":");
	const action = parts[2]; // "list", "inspect", "update-props", "export"

	switch (action) {
		case "list":
			return remotionList(client, options);
		case "inspect":
			return remotionInspect(client, options);
		case "update-props":
			return remotionUpdateProps(client, options);
		case "export":
			return remotionExport(client, options);
		default:
			return {
				success: false,
				error: `Unknown remotion action: ${action}. Available: list, inspect, update-props, export`,
			};
	}
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * List all Remotion elements across all timeline tracks.
 * Filters the full timeline for remotion-type tracks and elements.
 */
async function remotionList(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const projectId = opts.projectId;
	if (!projectId) {
		return { success: false, error: "Missing --project-id" };
	}

	const timeline = await client.get(
		`/api/claude/timeline/${encodeURIComponent(projectId)}`
	);

	// Extract remotion elements from all tracks
	const elements = extractRemotionElements(timeline);

	return {
		success: true,
		data: {
			count: elements.length,
			elements,
		},
	};
}

/**
 * Inspect a specific Remotion element by ID.
 * Returns component details, props, duration, and render mode.
 */
async function remotionInspect(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const projectId = opts.projectId;
	if (!projectId) {
		return { success: false, error: "Missing --project-id" };
	}

	const elementId = opts.elementId;
	if (!elementId) {
		return { success: false, error: "Missing --element-id" };
	}

	const timeline = await client.get(
		`/api/claude/timeline/${encodeURIComponent(projectId)}`
	);

	const elements = extractRemotionElements(timeline);
	const element = elements.find(
		(el: RemotionElementInfo) => el.elementId === elementId
	);

	if (!element) {
		return {
			success: false,
			error: `Remotion element not found: ${elementId}`,
		};
	}

	return { success: true, data: element };
}

/**
 * Update props on a Remotion timeline element.
 * Accepts --data (JSON) or --element-id + inline --changes.
 */
async function remotionUpdateProps(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const projectId = opts.projectId;
	if (!projectId) {
		return { success: false, error: "Missing --project-id" };
	}

	const elementId = opts.elementId;
	if (!elementId) {
		return { success: false, error: "Missing --element-id" };
	}

	// Resolve props from --data (JSON file, inline, or stdin)
	const propsInput = opts.data ?? opts.changes;
	if (!propsInput) {
		return {
			success: false,
			error: "Missing --data or --changes (JSON props to update)",
		};
	}

	const props = await resolveJsonInput(propsInput);

	const data = await client.patch(
		`/api/claude/timeline/${encodeURIComponent(projectId)}/elements/${encodeURIComponent(elementId)}`,
		{ props }
	);

	return { success: true, data };
}

/**
 * Trigger export with Remotion engine forced.
 * Uses the standard export endpoint but forces engineType to "remotion".
 */
async function remotionExport(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const projectId = opts.projectId;
	if (!projectId) {
		return { success: false, error: "Missing --project-id" };
	}

	const body: Record<string, unknown> = {
		engineType: "remotion",
	};

	if (opts.filename) body.filename = opts.filename;
	if (opts.preset) body.preset = opts.preset;

	const data = await client.post(
		`/api/claude/export/${encodeURIComponent(projectId)}/start`,
		body
	);

	return { success: true, data };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RemotionElementInfo {
	elementId: string;
	trackId: string;
	componentId: string;
	componentPath?: string;
	props: Record<string, unknown>;
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	renderMode: string;
}

interface TimelineData {
	tracks?: Array<{
		id: string;
		type: string;
		elements: Array<{
			id: string;
			type: string;
			componentId?: string;
			componentPath?: string;
			props?: Record<string, unknown>;
			startTime: number;
			duration: number;
			trimStart: number;
			trimEnd: number;
			renderMode?: string;
		}>;
	}>;
}

/**
 * Extract all Remotion elements from timeline data, including track context.
 */
function extractRemotionElements(timeline: unknown): RemotionElementInfo[] {
	const data = timeline as TimelineData;
	const results: RemotionElementInfo[] = [];

	if (!data?.tracks) return results;

	for (const track of data.tracks) {
		for (const element of track.elements) {
			if (element.type === "remotion") {
				results.push({
					elementId: element.id,
					trackId: track.id,
					componentId: element.componentId ?? "unknown",
					componentPath: element.componentPath,
					props: element.props ?? {},
					startTime: element.startTime,
					duration: element.duration,
					trimStart: element.trimStart,
					trimEnd: element.trimEnd,
					renderMode: element.renderMode ?? "live",
				});
			}
		}
	}

	return results;
}
