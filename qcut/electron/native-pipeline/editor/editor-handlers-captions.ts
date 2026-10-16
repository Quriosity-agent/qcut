/**
 * `editor captions import`: a subtitle file (SRT/VTT/ASS) onto captions tracks,
 * the way the captions panel imports one — cues that overlap get their own
 * lane, lanes sit above the clips (the editor's stacking rule), and the cues
 * go in batches of 50.
 *
 * @module electron/native-pipeline/editor/editor-handlers-captions
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseSubtitleInput } from "../cli/cli-handlers-subtitle.js";
import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import type { EditorApiClient } from "./editor-api-client.js";
import { resolveJsonInput } from "./editor-api-types.js";

const BATCH_LIMIT = 50;

interface Cue {
	text: string;
	startTime: number;
	duration: number;
	language: string;
	style?: unknown;
}

/** Greedy lanes: a cue joins the first lane whose last cue ends before it starts. */
export function partitionCueLanes({ cues }: { cues: Cue[] }): Cue[][] {
	const sorted = [...cues].sort(
		(left, right) => left.startTime - right.startTime
	);
	const lanes: Array<{ end: number; cues: Cue[] }> = [];
	for (const cue of sorted) {
		const lane = lanes.find((candidate) => candidate.end <= cue.startTime);
		if (lane) {
			lane.cues.push(cue);
			lane.end = cue.startTime + cue.duration;
		} else {
			lanes.push({ end: cue.startTime + cue.duration, cues: [cue] });
		}
	}
	return lanes.map((lane) => lane.cues);
}

export async function captionsImport(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.projectId) return { success: false, error: "Missing --project-id" };
	const file = opts.file?.trim();
	if (!file)
		return { success: false, error: "Missing --file (SRT, VTT or ASS)" };
	const filePath = path.resolve(file);
	if (!fs.existsSync(filePath)) {
		return { success: false, error: `Subtitle file not found: ${filePath}` };
	}
	const parsed = parseSubtitleInput(filePath);
	if (parsed.clips.length === 0) {
		return { success: false, error: `No cues found in ${filePath}` };
	}
	const style =
		opts.style !== undefined ? await resolveJsonInput(opts.style) : undefined;
	const cues: Cue[] = parsed.clips.map((clip) => ({
		text: clip.text,
		startTime: clip.startTime,
		duration: clip.duration,
		language: opts.language ?? clip.language,
		style: style ?? clip.style,
	}));

	if (opts.replace) {
		const timeline = await client.get<{
			tracks: Array<{ id: string; type: string }>;
		}>(`/api/claude/timeline/${opts.projectId}`);
		for (const track of timeline.tracks) {
			if (track.type !== "captions") continue;
			await client.delete(
				`/api/claude/timeline/${opts.projectId}/tracks/${encodeURIComponent(track.id)}`,
				{ force: true }
			);
		}
	}

	const tracks: Array<{ trackId: string; cues: number }> = [];
	let added = 0;
	for (const lane of partitionCueLanes({ cues })) {
		const created = await client.post<{ trackId: string }>(
			`/api/claude/timeline/${opts.projectId}/tracks`,
			{ type: "captions" }
		);
		const trackId = created.trackId;
		for (let start = 0; start < lane.length; start += BATCH_LIMIT) {
			const chunk = lane.slice(start, start + BATCH_LIMIT);
			const result = await client.post<{ addedCount?: number }>(
				`/api/claude/timeline/${opts.projectId}/elements/batch`,
				{
					elements: chunk.map((cue) => ({
						type: "captions",
						trackId,
						content: cue.text,
						startTime: cue.startTime,
						duration: cue.duration,
						language: cue.language,
						...(cue.style ? { style: cue.style } : {}),
					})),
				}
			);
			added += result?.addedCount ?? chunk.length;
		}
		tracks.push({ trackId, cues: lane.length });
	}
	return {
		success: true,
		data: {
			projectId: opts.projectId,
			file: filePath,
			cues: cues.length,
			added,
			tracks,
			...(parsed.resolution ? { resolution: parsed.resolution } : {}),
		},
	};
}

export async function handleCaptionsCommand(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	const action = opts.command.split(":")[2];
	if (action === "import") return captionsImport(client, opts);
	return {
		success: false,
		error: `Unknown captions action: ${action}. Available: import`,
	};
}
