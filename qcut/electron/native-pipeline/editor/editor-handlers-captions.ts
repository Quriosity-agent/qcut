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
import { PRESET_NAMES, SUBTITLE_PRESETS } from "../subtitle/style-presets.js";

const BATCH_LIMIT = 50;

export interface Cue {
	text: string;
	/** A bilingual caption's second-language line. */
	secondaryText?: string;
	startTime: number;
	duration: number;
	language: string;
	style?: unknown;
}

type TimedText = Pick<Cue, "text" | "startTime" | "duration">;

function overlapSeconds(left: TimedText, right: TimedText): number {
	return Math.max(
		0,
		Math.min(left.startTime + left.duration, right.startTime + right.duration) -
			Math.max(left.startTime, right.startTime)
	);
}

/**
 * A second-language file's cues as the second lines of `cues`: each goes to
 * the cue it overlaps longest (several in time order join with a line
 * break). Those that overlap none are counted, not placed.
 */
export function pairSecondaryCues({
	cues,
	secondary,
}: {
	cues: Cue[];
	secondary: TimedText[];
}): { cues: Cue[]; unpaired: number } {
	const lines = cues.map((): TimedText[] => []);
	let unpaired = 0;
	for (const candidate of secondary) {
		let best = -1;
		let bestOverlap = 0;
		for (const [index, cue] of cues.entries()) {
			const overlap = overlapSeconds(cue, candidate);
			if (overlap > bestOverlap) {
				best = index;
				bestOverlap = overlap;
			}
		}
		if (best < 0) unpaired++;
		else lines[best].push(candidate);
	}
	return {
		cues: cues.map((cue, index) => {
			const text = lines[index]
				.sort((left, right) => left.startTime - right.startTime)
				.map((line) => line.text.trim())
				.filter(Boolean)
				.join("\n");
			return text ? { ...cue, secondaryText: text } : cue;
		}),
		unpaired,
	};
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

/**
 * `--preset` (a named look, e.g. `film`: no box, thin outline, soft shadow)
 * under `--style` (JSON or @file), whose fields win.
 */
export async function resolveCaptionImportStyle({
	opts,
}: {
	opts: CLIRunOptions;
}): Promise<Record<string, unknown> | undefined> {
	const preset = opts.preset?.trim();
	const presetStyle = preset ? SUBTITLE_PRESETS[preset] : undefined;
	if (preset && !presetStyle) {
		throw new Error(
			`Unknown caption preset "${preset}". Available: ${PRESET_NAMES.join(", ")}`
		);
	}
	const style =
		opts.style !== undefined ? await resolveJsonInput(opts.style) : undefined;
	if (style !== undefined && (typeof style !== "object" || style === null)) {
		throw new Error("--style must be a JSON object (or @file holding one)");
	}
	if (!presetStyle) return style as Record<string, unknown> | undefined;
	return { ...presetStyle, ...(style as Record<string, unknown> | undefined) };
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
	let style: unknown;
	try {
		style = await resolveCaptionImportStyle({ opts });
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	let cues: Cue[] = parsed.clips.map((clip) => ({
		text: clip.text,
		startTime: clip.startTime,
		duration: clip.duration,
		language: opts.language ?? clip.language,
		style: style ?? clip.style,
	}));
	// A second-language file gives each caption its second line.
	const secondaryFile = opts.secondaryFile?.trim();
	let secondaryPath: string | undefined;
	let unpaired = 0;
	if (secondaryFile) {
		secondaryPath = path.resolve(secondaryFile);
		if (!fs.existsSync(secondaryPath)) {
			return {
				success: false,
				error: `Subtitle file not found: ${secondaryPath}`,
			};
		}
		const secondary = parseSubtitleInput(secondaryPath).clips;
		if (secondary.length === 0) {
			return { success: false, error: `No cues found in ${secondaryPath}` };
		}
		({ cues, unpaired } = pairSecondaryCues({ cues, secondary }));
	}
	const imported = await importCaptionCues({ client, opts, cues });
	if (!imported.success) return imported;
	const { warnings, ...summary } = imported.data as Record<string, unknown>;
	const allWarnings = [
		...((warnings as string[] | undefined) ?? []),
		...(unpaired > 0
			? [
					`${unpaired} cue(s) of ${secondaryPath} overlap no cue of ${filePath} and were left out.`,
				]
			: []),
	];
	return {
		success: true,
		data: {
			projectId: opts.projectId,
			file: filePath,
			...(secondaryPath ? { secondaryFile: secondaryPath } : {}),
			...summary,
			...(parsed.resolution ? { resolution: parsed.resolution } : {}),
			...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
		},
	};
}

/**
 * Puts cues onto new captions tracks, the way the captions panel imports a
 * file: cues that overlap get their own lane, lanes sit above the clips, and
 * one timeline transaction covers the `--replace` deletes and every batch,
 * so a failure midway leaves the captions as they were.
 */
export async function importCaptionCues({
	client,
	opts,
	cues,
}: {
	client: EditorApiClient;
	opts: CLIRunOptions;
	cues: Cue[];
}): Promise<CLIResult> {
	const started = await client.post<{ transactionId: string }>(
		"/api/claude/transaction/begin",
		{ label: "Import captions" }
	);
	const transaction = `/api/claude/transaction/${encodeURIComponent(started.transactionId)}`;
	const tracks: Array<{ trackId: string; cues: number }> = [];
	// Every cue shares the style, so each warning is reported once.
	const styleWarnings = new Set<string>();
	let added = 0;
	const lanes = partitionCueLanes({ cues });
	try {
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
		for (const lane of lanes) {
			const created = await client.post<{ trackId: string }>(
				`/api/claude/timeline/${opts.projectId}/tracks`,
				{ type: "captions" }
			);
			const trackId = created.trackId;
			for (let start = 0; start < lane.length; start += BATCH_LIMIT) {
				const chunk = lane.slice(start, start + BATCH_LIMIT);
				const result = await client.post<{
					addedCount?: number;
					added?: Array<{ warnings?: string[] }>;
				}>(`/api/claude/timeline/${opts.projectId}/elements/batch`, {
					elements: chunk.map((cue) => ({
						type: "captions",
						trackId,
						content: cue.text,
						...(cue.secondaryText
							? { secondaryContent: cue.secondaryText }
							: {}),
						startTime: cue.startTime,
						duration: cue.duration,
						language: cue.language,
						...(cue.style ? { style: cue.style } : {}),
					})),
				});
				added += result?.addedCount ?? chunk.length;
				for (const item of result?.added ?? []) {
					for (const warning of item.warnings ?? []) styleWarnings.add(warning);
				}
			}
			tracks.push({ trackId, cues: lane.length });
		}
		await client.post(`${transaction}/commit`, {});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		let rolledBack = false;
		try {
			await client.post(`${transaction}/rollback`, { reason: message });
			rolledBack = true;
		} catch {
			// The import failure below is the error to report.
		}
		return {
			success: false,
			error: `Captions import failed: ${message}. The timeline was ${rolledBack ? "rolled back" : "NOT rolled back"}.`,
		};
	}
	const warnings = [
		...(lanes.length > 1
			? [
					`${cues.length - lanes[0].length} cue(s) overlap in time and went on ${lanes.length - 1} extra lane(s); overlapping captions stack upward on screen (preview and both exports). Stagger the cues or put them on one lane if that is not wanted.`,
				]
			: []),
		...styleWarnings,
	];
	return {
		success: true,
		data: {
			cues: cues.length,
			added,
			tracks,
			...(warnings.length > 0 ? { warnings } : {}),
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
