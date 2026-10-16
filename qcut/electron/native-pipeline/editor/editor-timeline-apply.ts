/**
 * `editor timeline apply`: media, tracks, elements, transitions and the mix
 * of one manifest, applied in order inside a timeline transaction and read
 * back (editor-timeline-apply-verify.ts, editor-timeline-apply-mix.ts).
 *
 * @module electron/native-pipeline/editor/editor-timeline-apply
 */
import { promises as fs } from "node:fs";
import { basename } from "node:path";
import type { CLIRunOptions, CLIResult } from "../cli/cli-runner/types.js";
import type { EditorApiClient } from "./editor-api-client.js";
import { resolveJsonInput } from "./editor-api-types.js";
import { ensureEditorProjectReady } from "./editor-project-readiness.js";
import {
	applyManifestMix,
	applyManifestTrackAudio,
	manifestHasTrackAudio,
	manifestMix,
	readMixSnapshot,
	restoreMix,
	verifyManifestMix,
	type MixSnapshot,
} from "./editor-timeline-apply-mix.js";
import { verifyManifest } from "./editor-timeline-apply-verify.js";
import {
	aliasFor,
	collectElements,
	collectTransitions,
	isRecord,
	mapReference,
	type JsonRecord,
	type ManifestElement,
	type ManifestMedia,
	type ManifestTrack,
	type TimelineManifest,
	type TimelineSnapshot,
} from "./editor-timeline-manifest.js";

/** Elements per editor request: the editor's own batch limit. */
const BATCH_SIZE = 50;

/**
 * A batch's request deadline grows with its size: the editor stores one
 * element at a time, so a full batch on a long programme takes well over the
 * client's 30 s default (the editor's own deadline grows the same way).
 */
function batchRequestTimeoutMs({ count }: { count: number }): number {
	return 60_000 + 1_000 * count;
}

interface MediaFileSummary {
	id: string;
	name?: string;
	size?: number;
}

interface ImportResult {
	index: number;
	success: boolean;
	mediaFile?: MediaFileSummary;
	error?: string;
}

async function resolveActiveProjectId(
	client: EditorApiClient
): Promise<string | undefined> {
	const navigator = await client.get<{ activeProjectId?: string | null }>(
		"/api/claude/navigator/projects"
	);
	return navigator.activeProjectId ?? undefined;
}

async function importManifestMedia({
	client,
	projectId,
	media,
	mediaIds,
	newMediaIds,
}: {
	client: EditorApiClient;
	projectId: string;
	media: ManifestMedia[];
	mediaIds: Map<string, string>;
	newMediaIds: Set<string>;
}): Promise<void> {
	const existing = await client.get<MediaFileSummary[]>(
		`/api/claude/media/${encodeURIComponent(projectId)}`
	);
	const existingIds = new Set(existing.map((item) => item.id));
	const sourceSizes = await Promise.all(
		media.map(async (entry) => {
			if (!entry.path) return undefined;
			try {
				return (await fs.stat(entry.path)).size;
			} catch {
				return undefined;
			}
		})
	);
	const imports: Array<{ path?: string; url?: string; filename?: string }> = [];
	const importEntries: Array<{ entry: ManifestMedia; manifestIndex: number }> =
		[];

	for (const [index, entry] of media.entries()) {
		const alias = aliasFor(entry, `media-${index}`);
		const directId =
			entry.mediaId ?? (!entry.path && !entry.url ? entry.id : undefined);
		if (directId) {
			mediaIds.set(alias, directId);
			mediaIds.set(directId, directId);
			continue;
		}
		const expectedName =
			entry.filename ?? (entry.path ? basename(entry.path) : undefined);
		const sourceSize = sourceSizes[index];
		const reusable =
			expectedName && sourceSize !== undefined
				? existing.filter(
						(item) => item.name === expectedName && item.size === sourceSize
					)
				: [];
		if (reusable.length === 1) {
			const mediaId = reusable[0].id;
			mediaIds.set(alias, mediaId);
			mediaIds.set(mediaId, mediaId);
			if (entry.id) mediaIds.set(entry.id, mediaId);
			continue;
		}
		if (!entry.path && !entry.url) {
			throw new Error(`Media '${alias}' needs path, url, or mediaId`);
		}
		imports.push({
			path: entry.path,
			url: entry.url,
			filename: entry.filename,
		});
		importEntries.push({ entry, manifestIndex: index });
	}

	if (imports.length === 0) return;
	const results = await client.post<ImportResult[]>(
		`/api/claude/media/${encodeURIComponent(projectId)}/batch-import`,
		{ items: imports }
	);
	for (const [index, result] of results.entries()) {
		const { entry, manifestIndex } = importEntries[index];
		const alias = aliasFor(entry, `media-${manifestIndex}`);
		if (!result.success || !result.mediaFile) {
			throw new Error(
				`Media '${alias}' failed: ${result.error || "unknown error"}`
			);
		}
		const mediaId = result.mediaFile.id;
		mediaIds.set(alias, mediaId);
		mediaIds.set(mediaId, mediaId);
		if (entry.id) mediaIds.set(entry.id, mediaId);
		if (!existingIds.has(mediaId)) newMediaIds.add(mediaId);
	}
}

async function createManifestTracks({
	client,
	projectId,
	manifest,
	replace,
	trackIds,
}: {
	client: EditorApiClient;
	projectId: string;
	manifest: TimelineManifest;
	replace: boolean;
	trackIds: Map<string, string>;
}): Promise<{ positional: boolean }> {
	const basePath = `/api/claude/timeline/${encodeURIComponent(projectId)}`;
	const before = await client.get<TimelineSnapshot>(basePath);
	// Array order sets the track order when the manifest is the whole
	// timeline: a replace, or a project that still has only its empty main
	// track. Merging into a timeline that has tracks keeps their order, and a
	// track moves only when it names an `index`, so a manifest applied in
	// parts does not shuffle what is already there.
	const positional =
		replace ||
		before.tracks.every((track) => track.isMain && track.elements.length === 0);
	let preservedMainId: string | undefined;
	let mainManifestIndex = -1;
	if (replace) {
		mainManifestIndex =
			manifest.tracks?.findIndex((track) => track.type === "media") ?? -1;
		if (mainManifestIndex < 0) {
			throw new Error(
				"A replace manifest must contain a media track for QCut's required main track"
			);
		}
		const mainTrack = before.tracks.find((track) => track.isMain);
		if (!mainTrack?.id) {
			throw new Error("QCut did not expose its required main track");
		}
		preservedMainId = mainTrack?.id;
		// A locked track refuses the deletes below, so the old lock is lifted
		// first; the manifest decides which tracks end up locked.
		for (const track of before.tracks) {
			if (!track.id || !track.locked) continue;
			await client.patch(`${basePath}/tracks/${encodeURIComponent(track.id)}`, {
				locked: false,
			});
		}
		if (mainTrack?.id && mainTrack.elements.length > 0) {
			for (
				let offset = 0;
				offset < mainTrack.elements.length;
				offset += BATCH_SIZE
			) {
				const elements = mainTrack.elements
					.slice(offset, offset + BATCH_SIZE)
					.map((element) => ({
						trackId: mainTrack.id!,
						elementId: element.id,
					}));
				const result = await client.delete<{ failedCount: number }>(
					`${basePath}/elements/batch`,
					{ elements, ripple: false }
				);
				if (result.failedCount > 0) {
					throw new Error("Failed to clear the existing main track");
				}
			}
		}
		for (const track of [...before.tracks].reverse()) {
			if (!track.id || track.id === preservedMainId) continue;
			await client.delete(
				`${basePath}/tracks/${encodeURIComponent(track.id)}`,
				{
					force: true,
				}
			);
		}
	}

	for (const [arrayIndex, track] of (manifest.tracks ?? []).entries()) {
		if (!track.type) throw new Error(`Track ${arrayIndex} is missing type`);
		const alias = aliasFor(track, `track-${arrayIndex}`);
		const index = positional
			? arrayIndex
			: typeof track.index === "number"
				? track.index
				: undefined;
		const settings = trackSettingsBody({ track });
		const existingId = replace
			? arrayIndex === mainManifestIndex
				? preservedMainId
				: undefined
			: (track.trackId ??
				before.tracks.find((candidate) => candidate.id === track.id)?.id);
		if (existingId) {
			const body: JsonRecord = {
				...(index !== undefined ? { index } : {}),
				...(track.name !== undefined ? { name: track.name } : {}),
				...settings,
			};
			if (Object.keys(body).length > 0) {
				await client.patch(
					`${basePath}/tracks/${encodeURIComponent(existingId)}`,
					body
				);
			}
			trackIds.set(alias, existingId);
			trackIds.set(existingId, existingId);
			continue;
		}

		const result = await client.post<{ trackId?: string }>(
			`${basePath}/tracks`,
			{
				type: track.type,
				name: track.name,
				...(index !== undefined ? { index } : {}),
				...settings,
			}
		);
		if (!result.trackId)
			throw new Error(`Track '${alias}' did not return an ID`);
		trackIds.set(alias, result.trackId);
		if (track.id) trackIds.set(track.id, result.trackId);
	}
	return { positional };
}

/**
 * A track's colour, mute and visibility, set as it is made so its clips land
 * on a track that already looks right. A lock waits until the clips are in
 * (`lockManifestTracks`); an explicit unlock goes first so the adds pass.
 */
function trackSettingsBody({ track }: { track: ManifestTrack }): JsonRecord {
	const body: JsonRecord = {};
	if (track.colorLabel !== undefined) body.colorLabel = track.colorLabel;
	if (typeof track.muted === "boolean") body.muted = track.muted;
	if (typeof track.hidden === "boolean") body.hidden = track.hidden;
	if (track.locked === false) body.locked = false;
	return body;
}

/** Locks the tracks the manifest marks `locked`, once their clips are in. */
async function lockManifestTracks({
	client,
	projectId,
	manifest,
	trackIds,
}: {
	client: EditorApiClient;
	projectId: string;
	manifest: TimelineManifest;
	trackIds: Map<string, string>;
}): Promise<void> {
	for (const [index, track] of (manifest.tracks ?? []).entries()) {
		if (track.locked !== true) continue;
		const alias = aliasFor(track, `track-${index}`);
		const trackId = trackIds.get(alias);
		if (!trackId) throw new Error(`Track '${alias}' has no id to lock`);
		await client.patch(
			`/api/claude/timeline/${encodeURIComponent(projectId)}/tracks/${encodeURIComponent(trackId)}`,
			{ locked: true }
		);
	}
}

async function addManifestElements({
	client,
	projectId,
	manifest,
	trackIds,
	mediaIds,
	elementIds,
	expectedElements,
}: {
	client: EditorApiClient;
	projectId: string;
	manifest: TimelineManifest;
	trackIds: Map<string, string>;
	mediaIds: Map<string, string>;
	elementIds: Map<string, string>;
	expectedElements: Map<string, ManifestElement>;
}): Promise<void> {
	const collected = collectElements(manifest);
	for (let offset = 0; offset < collected.length; offset += BATCH_SIZE) {
		const chunk = collected.slice(offset, offset + BATCH_SIZE);
		const payload = chunk.map(({ element, trackRef }, localIndex) => {
			const alias = aliasFor(element, `element-${offset + localIndex}`);
			const resolvedTrackId = mapReference(
				trackIds,
				element.track ?? element.trackId ?? trackRef
			);
			if (!resolvedTrackId) throw new Error(`Element '${alias}' has no track`);
			if (!element.type) throw new Error(`Element '${alias}' is missing type`);
			if (typeof element.startTime !== "number") {
				throw new Error(`Element '${alias}' is missing startTime`);
			}
			const duration =
				typeof element.duration === "number"
					? element.duration
					: typeof element.endTime === "number"
						? element.endTime - element.startTime
						: undefined;
			if (typeof duration !== "number" || duration <= 0) {
				throw new Error(`Element '${alias}' needs duration > 0`);
			}

			// `id` stays in the body: the bridge honors requested element ids,
			// which is what lets an idempotent replay detect already-applied
			// operations instead of duplicating them.
			const body: JsonRecord = {
				...element,
				trackId: resolvedTrackId,
				duration,
			};
			delete body.alias;
			delete body.track;
			delete body.media;
			delete body.source;
			const mediaRef = element.media ?? element.source;
			if (mediaRef) body.sourceId = mapReference(mediaIds, mediaRef);
			if (typeof element.mediaId === "string") {
				body.mediaId = mapReference(mediaIds, element.mediaId);
			}
			if (typeof element.sourceId === "string") {
				body.sourceId = mapReference(mediaIds, element.sourceId);
			}
			expectedElements.set(alias, {
				...element,
				duration,
				...(typeof body.mediaId === "string" ? { mediaId: body.mediaId } : {}),
			});
			return body;
		});

		const result = await client.post<{
			added: Array<{
				index: number;
				success: boolean;
				elementId?: string;
				error?: string;
			}>;
			failedCount: number;
		}>(
			`/api/claude/timeline/${encodeURIComponent(projectId)}/elements/batch`,
			{ elements: payload },
			{ timeout: batchRequestTimeoutMs({ count: payload.length }) }
		);
		if (result.failedCount > 0) {
			const failures = result.added
				.filter((item) => !item.success)
				.map((item) => {
					const source = chunk[item.index]?.element;
					const alias = source
						? aliasFor(source, `element-${offset + item.index}`)
						: `element-${offset + item.index}`;
					return `Element '${alias}' failed: ${item.error || "unknown error"}`;
				})
				.join("; ");
			throw new Error(`Element batch failed: ${failures}`);
		}
		for (const added of result.added) {
			const source = chunk[added.index]?.element;
			if (!source || !added.elementId) continue;
			const alias = aliasFor(source, `element-${offset + added.index}`);
			elementIds.set(alias, added.elementId);
			if (source.id) elementIds.set(source.id, added.elementId);
		}
	}
}

async function updateManifestElements({
	client,
	projectId,
	manifest,
	elementIds,
	expectedElements,
}: {
	client: EditorApiClient;
	projectId: string;
	manifest: TimelineManifest;
	elementIds: Map<string, string>;
	expectedElements: Map<string, ManifestElement>;
}): Promise<void> {
	const updates = manifest.updates ?? [];
	if (updates.length === 0) return;
	const payload = updates.map((update, index) => {
		const elementId = update.elementId;
		if (!elementId) throw new Error(`Update ${index} is missing elementId`);
		const alias = aliasFor(update, `update-${index}`);
		const body: JsonRecord = { ...update };
		delete body.alias;
		delete body.id;
		delete body.elementId;
		delete body.track;
		delete body.trackId;
		elementIds.set(alias, elementId);
		expectedElements.set(alias, body);
		return { elementId, ...body };
	});
	for (let offset = 0; offset < payload.length; offset += BATCH_SIZE) {
		const chunk = payload.slice(offset, offset + BATCH_SIZE);
		const result = await client.patch<{
			results: Array<{ index: number; success: boolean; error?: string }>;
			failedCount: number;
		}>(
			`/api/claude/timeline/${encodeURIComponent(projectId)}/elements/batch`,
			{ updates: chunk },
			{ timeout: batchRequestTimeoutMs({ count: chunk.length }) }
		);
		if (result.failedCount > 0) {
			const failures = result.results
				.filter((item) => !item.success)
				.map((item) => item.error)
				.join("; ");
			throw new Error(`Element update batch failed: ${failures}`);
		}
	}
}

async function addManifestTransitions({
	client,
	projectId,
	manifest,
	trackIds,
	elementIds,
}: {
	client: EditorApiClient;
	projectId: string;
	manifest: TimelineManifest;
	trackIds: Map<string, string>;
	elementIds: Map<string, string>;
}): Promise<string[]> {
	const transitionIds: string[] = [];
	for (const [index, transition] of collectTransitions(manifest).entries()) {
		const trackId = mapReference(
			trackIds,
			transition.track ?? transition.trackId
		);
		const fromElementId = mapReference(
			elementIds,
			transition.from ?? transition.fromElementId
		);
		const toElementId = mapReference(
			elementIds,
			transition.to ?? transition.toElementId
		);
		if (!trackId || !fromElementId || !toElementId) {
			throw new Error(`Transition ${index} has unresolved track/from/to refs`);
		}
		if (!transition.type || typeof transition.duration !== "number") {
			throw new Error(`Transition ${index} needs type and duration`);
		}
		const body: JsonRecord = {
			...transition,
			fromElementId,
			toElementId,
			presetId: transition.presetId ?? transition.type,
		};
		delete body.track;
		delete body.trackId;
		delete body.from;
		delete body.to;
		const result = await client.post<{ transitionId?: string }>(
			`/api/claude/timeline/${encodeURIComponent(projectId)}/tracks/${encodeURIComponent(trackId)}/transitions`,
			body
		);
		if (!result.transitionId) throw new Error(`Transition ${index} failed`);
		transitionIds.push(result.transitionId);
	}
	return transitionIds;
}

export async function timelineApplyManifest(
	client: EditorApiClient,
	opts: CLIRunOptions
): Promise<CLIResult> {
	if (!opts.manifest) return { success: false, error: "Missing --manifest" };
	const parsed = await resolveJsonInput(opts.manifest);
	if (!isRecord(parsed))
		return { success: false, error: "Manifest must be a JSON object" };
	const manifest = parsed as TimelineManifest;
	if (!Array.isArray(manifest.tracks)) {
		return { success: false, error: "Manifest must contain a tracks array" };
	}
	const projectId =
		opts.projectId ??
		manifest.projectId ??
		(await resolveActiveProjectId(client));
	if (!projectId)
		return { success: false, error: "No active project; pass --project-id" };

	const atomic = opts.atomic !== false;
	const shouldVerify = opts.verify !== false;
	const replace = opts.replace || manifest.replace === true;
	const mix = manifestMix(manifest);
	const touchesMix = mix !== undefined || manifestHasTrackAudio(manifest);
	let previousMix: MixSnapshot | undefined;
	const mediaIds = new Map<string, string>();
	const trackIds = new Map<string, string>();
	const elementIds = new Map<string, string>();
	const expectedElements = new Map<string, ManifestElement>();
	const newMediaIds = new Set<string>();
	let transactionId: string | undefined;
	let previousSettings: JsonRecord | undefined;
	let settingsChanged = false;
	let timelineMutationStarted = false;

	try {
		const readiness = await ensureEditorProjectReady({
			client,
			projectId,
			open: true,
			timeoutMs: opts.timeoutMs,
		});
		await importManifestMedia({
			client,
			projectId,
			media: Array.isArray(manifest.media) ? manifest.media : [],
			mediaIds,
			newMediaIds,
		});

		if (atomic) {
			const started = await client.post<{ transactionId: string }>(
				"/api/claude/transaction/begin",
				{ label: "Apply timeline manifest" }
			);
			transactionId = started.transactionId;
		}

		const settings = manifest.project ?? manifest.settings;
		if (settings && Object.keys(settings).length > 0) {
			timelineMutationStarted = true;
			previousSettings = await client.get<JsonRecord>(
				`/api/claude/project/${encodeURIComponent(projectId)}/settings`
			);
			await client.patch(
				`/api/claude/project/${encodeURIComponent(projectId)}/settings`,
				settings
			);
			settingsChanged = true;
		}

		timelineMutationStarted = true;
		const { positional } = await createManifestTracks({
			client,
			projectId,
			manifest,
			replace,
			trackIds,
		});
		await addManifestElements({
			client,
			projectId,
			manifest,
			trackIds,
			mediaIds,
			elementIds,
			expectedElements,
		});
		await updateManifestElements({
			client,
			projectId,
			manifest,
			elementIds,
			expectedElements,
		});
		const transitionIds = await addManifestTransitions({
			client,
			projectId,
			manifest,
			trackIds,
			elementIds,
		});
		// The mix lives in the project, outside the timeline transaction, so
		// the state before is kept to put back by hand if anything fails.
		if (touchesMix) {
			previousMix = await readMixSnapshot({ client, projectId });
			if (mix) await applyManifestMix({ client, projectId, mix, replace });
			await applyManifestTrackAudio({ client, projectId, manifest, trackIds });
		}
		await lockManifestTracks({ client, projectId, manifest, trackIds });

		const timeline = await client.get<TimelineSnapshot>(
			`/api/claude/timeline/${encodeURIComponent(projectId)}`
		);
		const verificationIssues = shouldVerify
			? [
					...verifyManifest({
						timeline,
						manifest,
						trackIds,
						elementIds,
						expectedElements,
						transitionIds,
						positional,
					}),
					...(touchesMix
						? verifyManifestMix({
								actual: await client.get<MixSnapshot>(
									`/api/claude/mix/${encodeURIComponent(projectId)}`
								),
								manifest,
								mix,
								trackIds,
							})
						: []),
				]
			: [];
		if (verificationIssues.length > 0) {
			throw new Error(
				`Manifest verification failed: ${verificationIssues.join("; ")}`
			);
		}

		if (transactionId) {
			await client.post(
				`/api/claude/transaction/${encodeURIComponent(transactionId)}/commit`,
				{}
			);
			transactionId = undefined;
		}

		let exportJob: unknown;
		if (manifest.export?.start === true) {
			const exportRequest = { ...manifest.export };
			delete exportRequest.start;
			exportJob = await client.post(
				`/api/claude/export/${encodeURIComponent(projectId)}/start`,
				exportRequest
			);
		}

		return {
			success: true,
			data: {
				projectId,
				readiness,
				atomic,
				replaced: replace,
				verified: shouldVerify,
				/** Array order set the track order (whole-timeline manifest). */
				positionalTracks: positional,
				mixApplied: touchesMix,
				media: Object.fromEntries(mediaIds),
				tracks: Object.fromEntries(trackIds),
				elements: Object.fromEntries(elementIds),
				transitionIds,
				exportConfig: manifest.export,
				exportJob,
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		let rolledBack = false;
		if (transactionId) {
			try {
				await client.post(
					`/api/claude/transaction/${encodeURIComponent(transactionId)}/rollback`,
					{ reason: message }
				);
				rolledBack = true;
			} catch {
				rolledBack = false;
			}
		}
		if (settingsChanged && previousSettings) {
			try {
				await client.patch(
					`/api/claude/project/${encodeURIComponent(projectId)}/settings`,
					previousSettings
				);
			} catch {
				// Best effort; timeline rollback remains authoritative.
			}
		}
		if (previousMix) {
			try {
				await restoreMix({ client, projectId, previous: previousMix });
			} catch {
				// Best effort; the error below names the step that failed.
			}
		}
		const cleanedMedia: string[] = [];
		if (!timelineMutationStarted || rolledBack) {
			for (const mediaId of newMediaIds) {
				try {
					await client.delete(
						`/api/claude/media/${encodeURIComponent(projectId)}/${encodeURIComponent(mediaId)}`
					);
					cleanedMedia.push(mediaId);
				} catch {
					// Keep the original failure as the command error.
				}
			}
		}
		return {
			success: false,
			error: message,
			data: { projectId, rolledBack, cleanedMedia },
		};
	}
}
