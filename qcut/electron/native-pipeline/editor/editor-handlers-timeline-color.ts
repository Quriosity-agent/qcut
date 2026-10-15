/**
 * Clip colour commands:
 *
 * - `editor:timeline:color-label` colours a whole track's clips, or listed
 *   clips, in one editor call (`--color <name>` or `--clear`);
 * - `editor:timeline:select --color <name>` selects every clip showing a
 *   colour, its own or its track's.
 *
 * Both go through the editor's own colour actions, the ones the clip menu
 * uses, and report what actually changed.
 *
 * @module electron/native-pipeline/editor/editor-handlers-timeline-color
 */

import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import {
	CLAUDE_TIMELINE_COLOR_LABELS,
	isClaudeTimelineColorLabel,
} from "../../types/claude-api.js";
import type { EditorApiClient } from "./editor-api-client.js";
import { resolveJsonInput } from "./editor-api-types.js";

const COLOR_CHOICES = CLAUDE_TIMELINE_COLOR_LABELS.join(", ");

/** `--color` as a label, or an error naming the valid ones. */
export function readColorOption(color: string | undefined): {
	colorLabel?: string;
	error?: string;
} {
	if (color === undefined) return {};
	const value = color.trim().toLowerCase();
	if (isClaudeTimelineColorLabel(value)) return { colorLabel: value };
	return { error: `--color must be one of: ${COLOR_CHOICES}` };
}

/**
 * `--element-ids` values: each may be a JSON array, an @file.json, or a
 * comma-separated list, and the flag may repeat.
 */
async function readElementIds(
	values: string[] | undefined
): Promise<string[] | undefined> {
	if (!values?.length) return undefined;
	const ids: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (trimmed.startsWith("[") || trimmed.startsWith("@")) {
			const parsed = await resolveJsonInput(trimmed);
			if (
				!Array.isArray(parsed) ||
				parsed.some((id) => typeof id !== "string")
			) {
				throw new Error("--element-ids must list element ids");
			}
			ids.push(...(parsed as string[]));
		} else {
			ids.push(
				...trimmed
					.split(",")
					.map((id) => id.trim())
					.filter(Boolean)
			);
		}
	}
	return ids;
}

/** Handle `editor:timeline:color-label`. */
export async function timelineColorLabel(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	const { colorLabel, error } = readColorOption(opts.color);
	if (error) return { success: false, error };
	if (!colorLabel && !opts.clear) {
		return { success: false, error: "Give --color <name> or --clear" };
	}
	if (colorLabel && opts.clear) {
		return { success: false, error: "Give --color or --clear, not both" };
	}
	const elementIds = await readElementIds(opts.elementIds);
	if (!opts.trackId && !elementIds?.length) {
		return {
			success: false,
			error: "Give --track-id (every clip on it) or --element-ids",
		};
	}

	const data = await client.post<{
		updatedCount: number;
		skipped: Array<{ elementId: string; reason: string }>;
	}>(`/api/claude/timeline/${encodeURIComponent(opts.projectId)}/color-label`, {
		...(opts.trackId ? { trackId: opts.trackId } : {}),
		...(elementIds ? { elementIds } : {}),
		colorLabel: colorLabel ?? null,
	});
	return { success: true, data };
}

/** Handle `editor:timeline:select --color <name>`. */
export async function timelineSelectByColor(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	const { colorLabel, error } = readColorOption(opts.color);
	if (error || !colorLabel) {
		return { success: false, error: error ?? "Missing --color" };
	}
	const data = await client.post(
		`/api/claude/timeline/${encodeURIComponent(opts.projectId)}/selection`,
		{ colorLabel }
	);
	return { success: true, data };
}
