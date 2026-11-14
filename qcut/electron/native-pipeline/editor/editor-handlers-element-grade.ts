/**
 * Clip colour from the CLI, on the colour panel's own paths:
 *
 * - `editor element color` patches the basic grade controls (contrast,
 *   saturation, temperature…) into each clip's grade;
 * - `editor element filter` resolves catalogue filters by resource id into
 *   the clip's filter stack, through the same resolver `compose apply` uses.
 *
 * Both take one clip, several clips, or every video clip on a track, and send
 * one batch so the edit is a single undo step.
 *
 * @module electron/native-pipeline/editor/editor-handlers-element-grade
 */

import {
	independentFilterCatalog,
	resolveIndependentFilterPlan,
} from "../cli/cli-handlers-filter-lab-independent.js";
import type { CLIResult, CLIRunOptions } from "../cli/cli-runner/types.js";
import {
	ComposeFilterStackError,
	type ComposeFilterStackResolverDependencies,
	type ResolvedComposeFilterStack,
	resolveComposeFilterStack,
} from "../compose/compose-filter-stack-resolver.js";
import type { ComposeFilterStep } from "../compose/compose-protocol.js";
import type { EditorApiClient } from "./editor-api-client.js";
import { resolveJsonInput } from "./editor-api-types.js";
import { readLutFile } from "./editor-element-lut-file.js";
import { readElementIds } from "./editor-handlers-timeline-color.js";

const BATCH_LIMIT = 50;
/** Well inside the batch route's 64 MB body limit. */
const BATCH_BYTES = 24 * 1024 * 1024;

const BASIC_CONTROLS = [
	"exposure",
	"brightness",
	"contrast",
	"highlights",
	"shadows",
	"whites",
	"blacks",
	"temperature",
	"tint",
	"saturation",
	"vibrance",
	"fade",
	"vignette",
	"sharpness",
	"grain",
] as const;

type BasicControl = (typeof BASIC_CONTROLS)[number];

interface TimelineSnapshot {
	tracks: Array<{
		id: string;
		elements: Array<{
			id: string;
			type: string;
			filterStack?: { effects?: unknown[] } | null;
		}>;
	}>;
}

interface BatchUpdateResponse {
	updatedCount: number;
	failedCount: number;
	results: Array<{
		index: number;
		success: boolean;
		error?: string;
		ignoredFields?: string[];
	}>;
}

class FlagError extends Error {}

/** The clips a command targets: --element-id, --element-ids, or a track's video clips. */
async function targetElementIds({
	client,
	opts,
	snapshot,
}: {
	client: EditorApiClient;
	opts: CLIRunOptions;
	snapshot?: TimelineSnapshot;
}): Promise<{ elementIds: string[]; snapshot?: TimelineSnapshot }> {
	const listed = await readElementIds(opts.elementIds);
	const single = opts.elementId?.trim();
	const ids = [...(single ? [single] : []), ...(listed ?? [])];
	if (opts.trackId) {
		const timeline =
			snapshot ??
			(await client.get<TimelineSnapshot>(
				`/api/claude/timeline/${opts.projectId}`
			));
		const track = timeline.tracks.find((item) => item.id === opts.trackId);
		if (!track) throw new FlagError(`Track not found: ${opts.trackId}`);
		for (const element of track.elements) {
			if (element.type === "media" || element.type === "video") {
				ids.push(element.id);
			}
		}
		if (ids.length === 0) {
			throw new FlagError(`Track ${opts.trackId} has no video clips`);
		}
		return { elementIds: [...new Set(ids)], snapshot: timeline };
	}
	if (ids.length === 0) {
		throw new FlagError(
			"Give --element-id, --element-ids, or --track-id to pick the clips"
		);
	}
	return { elementIds: [...new Set(ids)], snapshot };
}

/** One PATCH per clip set: a single element directly, several as one batch. */
async function patchElements({
	client,
	projectId,
	elementIds,
	changes,
	forceBatch = false,
}: {
	client: EditorApiClient;
	projectId: string;
	elementIds: string[];
	changes: Record<string, unknown>;
	/**
	 * The batch route takes bodies up to 64 MB; the single-element route only
	 * 1 MB, which a LUT cube exceeds (the server then drops the connection).
	 */
	forceBatch?: boolean;
}): Promise<{
	updated: number;
	failed: Array<{ elementId: string; error: string }>;
	ignoredFields: string[];
}> {
	if (elementIds.length === 1 && !forceBatch) {
		const result = await client.patch<{ ignoredFields?: string[] }>(
			`/api/claude/timeline/${projectId}/elements/${encodeURIComponent(elementIds[0])}`,
			changes
		);
		return {
			updated: 1,
			failed: [],
			ignoredFields: result?.ignoredFields ?? [],
		};
	}
	let updated = 0;
	const failed: Array<{ elementId: string; error: string }> = [];
	const ignored = new Set<string>();
	// Every update carries the whole change, so a change with a 3D LUT in
	// it goes to fewer clips per request.
	const changeBytes = JSON.stringify(changes).length;
	const perBatch = Math.max(
		1,
		Math.min(BATCH_LIMIT, Math.floor(BATCH_BYTES / Math.max(1, changeBytes)))
	);
	for (let start = 0; start < elementIds.length; start += perBatch) {
		const chunk = elementIds.slice(start, start + perBatch);
		const response = await client.patch<BatchUpdateResponse>(
			`/api/claude/timeline/${projectId}/elements/batch`,
			{ updates: chunk.map((elementId) => ({ elementId, changes })) }
		);
		updated += response.updatedCount;
		for (const item of response.results) {
			if (!item.success) {
				failed.push({
					elementId: chunk[item.index] ?? "?",
					error: item.error ?? "update failed",
				});
			}
			for (const field of item.ignoredFields ?? []) ignored.add(field);
		}
	}
	return { updated, failed, ignoredFields: [...ignored] };
}

/**
 * The `lut` part of the grade from `--lut-file` / `--lut-name` /
 * `--lut-intensity` / `--lut-clear`, or undefined when none is given.
 */
async function lutPatch({
	opts,
}: {
	opts: CLIRunOptions;
}): Promise<Record<string, unknown> | undefined> {
	const intensity = opts.lutIntensity;
	if (
		intensity !== undefined &&
		(!Number.isFinite(intensity) || intensity < 0 || intensity > 100)
	) {
		throw new FlagError("--lut-intensity must be between 0 and 100");
	}
	if (opts.lutClear) {
		if (opts.lutFile) {
			throw new FlagError("Give --lut-file or --lut-clear, not both");
		}
		// `cube: null` drops the stored cube; a disabled LUT alone would keep it.
		return { enabled: false, presetId: "none", name: "无", cube: null };
	}
	if (!opts.lutFile) {
		if (opts.lutName !== undefined) {
			throw new FlagError("--lut-name names the LUT of --lut-file");
		}
		return intensity === undefined ? undefined : { intensity };
	}
	let file: Awaited<ReturnType<typeof readLutFile>>;
	try {
		file = await readLutFile({ filePath: opts.lutFile });
	} catch (error) {
		throw new FlagError(error instanceof Error ? error.message : String(error));
	}
	return {
		enabled: true,
		presetId: "custom",
		name: opts.lutName?.trim() || file.name,
		intensity: intensity ?? 100,
		cube: file.cube,
	};
}

/** The grade as sent, with a cube's values counted instead of listed. */
function summarizeColorPatch({
	color,
}: {
	color: Record<string, unknown>;
}): Record<string, unknown> {
	const lut = color.lut as { cube?: { values?: unknown[] } } | undefined;
	if (!lut?.cube || !Array.isArray(lut.cube.values)) return color;
	const { values, ...cube } = lut.cube;
	return {
		...color,
		lut: { ...lut, cube: { ...cube, valueCount: values.length } },
	};
}

/**
 * `editor element color`: the basic grade controls as flags and a 3D LUT
 * from a file, merged into each clip's grade.
 */
export async function elementColor(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	try {
		if (!opts.projectId)
			return { success: false, error: "Missing --project-id" };
		const basic: Record<string, number | boolean> = { enabled: true };
		for (const control of BASIC_CONTROLS) {
			const value = opts[control as BasicControl];
			if (value === undefined) continue;
			if (typeof value !== "number" || !Number.isFinite(value)) {
				throw new FlagError(`--${control} must be a number`);
			}
			basic[control] = value;
		}
		if (opts.reset) {
			for (const control of BASIC_CONTROLS) basic[control] = 0;
		}
		const extra =
			opts.set !== undefined
				? await resolveJsonInput(opts.set as string)
				: undefined;
		if (
			extra !== undefined &&
			(typeof extra !== "object" || extra === null || Array.isArray(extra))
		) {
			throw new FlagError(
				"--set must be a JSON object (a partial colour grade)"
			);
		}
		const lut = await lutPatch({ opts });
		if (Object.keys(basic).length === 1 && !extra && !lut) {
			throw new FlagError(
				`Give at least one control (${BASIC_CONTROLS.map((name) => `--${name}`).join(", ")}), --lut-file, --lut-clear, --reset, or --set`
			);
		}
		const extraLut = (extra as Record<string, unknown> | undefined)?.lut;
		const color: Record<string, unknown> = {
			...((extra as Record<string, unknown>) ?? {}),
			enabled: true,
			basic: {
				...(((extra as Record<string, unknown>)?.basic as
					| Record<string, unknown>
					| undefined) ?? {}),
				...basic,
			},
			...(lut
				? {
						lut: {
							...(typeof extraLut === "object" && extraLut !== null
								? extraLut
								: {}),
							...lut,
						},
					}
				: {}),
		};
		const { elementIds } = await targetElementIds({ client, opts });
		const outcome = await patchElements({
			client,
			projectId: opts.projectId,
			elementIds,
			changes: { color },
			// A cube is far past the single-element route's 1 MB body limit.
			forceBatch: JSON.stringify(color).length > 512 * 1024,
		});
		return {
			success: outcome.failed.length === 0,
			...(outcome.failed.length > 0
				? {
						error: outcome.failed
							.map((f) => `${f.elementId}: ${f.error}`)
							.join("; "),
					}
				: {}),
			data: {
				projectId: opts.projectId,
				elementIds,
				color: summarizeColorPatch({ color }),
				updated: outcome.updated,
				failed: outcome.failed,
				...(outcome.ignoredFields.length
					? { ignoredFields: outcome.ignoredFields }
					: {}),
			},
		};
	} catch (error) {
		if (error instanceof FlagError)
			return { success: false, error: error.message };
		throw error;
	}
}

export type ResolveFilterStack = (input: {
	steps: readonly ComposeFilterStep[];
	dependencies?: ComposeFilterStackResolverDependencies;
}) => Promise<ResolvedComposeFilterStack>;

/**
 * Resolves resource ids with the Jianying catalogue first and QCut's own
 * (Metal) catalogue for ids the first does not know.
 */
async function resolveFilters({
	resourceIds,
	intensity,
	resolve,
}: {
	resourceIds: string[];
	intensity: number;
	resolve: ResolveFilterStack;
}): Promise<ResolvedComposeFilterStack> {
	const stamp = Date.now().toString(36);
	const steps: ComposeFilterStep[] = resourceIds.map((resourceId, index) => ({
		id: `filter-${stamp}-${index + 1}`,
		asset: { provider: "qcut", assetType: "filter", assetId: resourceId },
		intensity,
		enabled: true,
	}));
	try {
		return await resolve({ steps });
	} catch (error) {
		if (
			!(error instanceof ComposeFilterStackError) ||
			error.code !== "filter-not-catalogued"
		) {
			throw error;
		}
		return await resolve({
			steps,
			dependencies: {
				exportCatalog: independentFilterCatalog,
				resolvePlan: resolveIndependentFilterPlan,
			},
		});
	}
}

/** `editor element filter`: catalogue filters by resource id onto clips. */
export async function elementFilter(
	client: EditorApiClient,
	opts: CLIRunOptions,
	deps: { resolve?: ResolveFilterStack } = {}
): Promise<CLIResult> {
	try {
		if (!opts.projectId)
			return { success: false, error: "Missing --project-id" };
		const resourceIds = (
			opts.resourceIds ?? (opts.resourceId ? [opts.resourceId] : [])
		)
			.map((id) => id.trim())
			.filter(Boolean);
		if (resourceIds.length === 0 && !opts.clear) {
			throw new FlagError(
				"Give --resource-id (repeat to stack filters) or --clear"
			);
		}
		const intensity = opts.intensity ?? opts.filterIntensity ?? 100;
		if (
			typeof intensity !== "number" ||
			!Number.isFinite(intensity) ||
			intensity < 0 ||
			intensity > 100
		) {
			throw new FlagError("--intensity must be between 0 and 100");
		}
		const resolve = deps.resolve ?? resolveComposeFilterStack;
		const resolved = opts.clear
			? { effects: [], warnings: [] }
			: await resolveFilters({ resourceIds, intensity, resolve });
		const { elementIds, snapshot } = await targetElementIds({
			client,
			opts,
		});
		let updated = 0;
		const failed: Array<{ elementId: string; error: string }> = [];
		if (opts.append && !opts.clear) {
			// Each clip keeps its own stack, so the patch differs per clip.
			const timeline =
				snapshot ??
				(await client.get<TimelineSnapshot>(
					`/api/claude/timeline/${opts.projectId}`
				));
			for (const elementId of elementIds) {
				const current = timeline.tracks
					.flatMap((track) => track.elements)
					.find((element) => element.id === elementId);
				const existing = Array.isArray(current?.filterStack?.effects)
					? (current?.filterStack?.effects as unknown[])
					: [];
				const outcome = await patchElements({
					client,
					projectId: opts.projectId,
					elementIds: [elementId],
					changes: {
						filterStack: {
							enabled: true,
							effects: [...existing, ...resolved.effects],
						},
					},
					forceBatch: true,
				});
				updated += outcome.updated;
				failed.push(...outcome.failed);
			}
		} else {
			const outcome = await patchElements({
				client,
				projectId: opts.projectId,
				elementIds,
				changes: {
					filterStack: {
						enabled: resolved.effects.length > 0,
						effects: resolved.effects,
					},
				},
				forceBatch: true,
			});
			updated = outcome.updated;
			failed.push(...outcome.failed);
		}
		return {
			success: failed.length === 0,
			...(failed.length > 0
				? { error: failed.map((f) => `${f.elementId}: ${f.error}`).join("; ") }
				: {}),
			data: {
				projectId: opts.projectId,
				elementIds,
				effects: resolved.effects.map((effect) => ({
					id: effect.id,
					resourceId: effect.resourceId,
					version: effect.version,
					implementation: effect.implementation,
					fidelity: effect.fidelity,
					intensity: effect.intensity,
				})),
				warnings: resolved.warnings,
				updated,
				failed,
			},
		};
	} catch (error) {
		if (error instanceof FlagError)
			return { success: false, error: error.message };
		throw error;
	}
}
