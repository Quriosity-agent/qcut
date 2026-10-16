/**
 * Shared HTTP Route Definitions
 *
 * Extracts common route registration logic used by both:
 * - claude-http-server.ts (main process, direct BrowserWindow access)
 * - utility-http-server.ts (utility process, proxied BrowserWindow access)
 *
 * The only difference is how each server provides:
 * - getWindow(): returns a BrowserWindow (or proxy with webContents.send)
 * - requestTimeline(): fetches timeline from renderer
 * - requestSelection(): fetches selection from renderer
 * - requestSplit(): splits an element via renderer
 * - getProjectStatsImpl(): gets project stats
 * - getAppVersion(): returns app version string
 */

import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import type { Router } from "../utils/http-router.js";
import { timelineRequiresRendererFilterStackExport } from "../../types/filter-stack-export-policy.js";
import { timelineRequiresRendererShaderTransitionExport } from "../../types/shader-transition-export-policy.js";
import { timelineRequiresRendererAdjustmentLayerExport } from "../../types/adjustment-layer-export-policy.js";
import { assertProjectIsOpen } from "./claude-http-project-scope.js";
import { HttpError } from "../utils/http-router.js";
import { getProjectPath, isValidSourcePath } from "../utils/helpers.js";
import type {
	Transaction,
	TransactionRequest,
	MediaFile,
	ClaudeTimeline,
	ClaudeElement,
	ClaudeSelectionItem,
	ClaudeSplitResponse,
	ProjectStats,
	ClaudeBatchAddElementRequest,
	ClaudeBatchAddResponse,
	ClaudeBatchUpdateItemRequest,
	ClaudeBatchUpdateResponse,
	ClaudeBatchDeleteItemRequest,
	ClaudeBatchDeleteResponse,
	ClaudeArrangeRequest,
	ClaudeArrangeResponse,
	BatchCutRequest,
	BatchCutResponse,
	ClaudeRangeDeleteRequest,
	ClaudeRangeDeleteResponse,
	AutoEditRequest,
	AutoEditJob,
	ClaudeTrackOperationRequest,
	ClaudeTrackOperationResponse,
	ClaudeShotSplitRequest,
	ClaudeShotSplitResponse,
	ClaudeBeatsMarkRequest,
	ClaudeBeatsMarkResponse,
	ClaudeSnapToBeatsRequest,
	ClaudeSnapToBeatsResponse,
} from "../../types/claude-api.js";
import type {
	EditorStateRequest,
	EditorStateSnapshot,
} from "../../types/claude-state-api.js";
import type {
	ClaudeMediaDeletedEvent,
	ClaudeMediaImportedEvent,
} from "../../types/claude-media-bridge-api.js";
import {
	parseStickerLabMediaImportMetadata,
	type StickerLabMediaImportMetadata,
} from "./claude-media-import-metadata.js";

import {
	listMediaFiles,
	getMediaInfo,
	importMediaFile,
	deleteMediaFile,
	renameMediaFile,
	importMediaFromUrl,
	batchImportMedia,
	extractFrame,
} from "../handlers/claude-media-handler.js";
import { persistMediaRestrictedMetadata } from "../handlers/claude-media-restricted-metadata.js";
import {
	timelineToMarkdown,
	markdownToTimeline,
	validateTimeline,
} from "../handlers/claude-timeline-handler.js";
import {
	getProjectSettings,
	updateProjectSettings,
	getEmptyStats,
} from "../handlers/claude-project-handler.js";
import {
	getExportPresets,
	getExportRecommendation,
	startExportJob,
	startRendererExportJob,
	getExportJobStatus,
	cancelExportJob,
	listExportJobs,
} from "../handlers/claude-export-handler.js";
import { hasStickerRuntimeForExport } from "../../types/sticker-runtime-export-policy.js";
import type { ClaudeLocalVideoExportRequest } from "../../types/claude-local-video-export-api.js";
import {
	analyzeError,
	getSystemInfo,
} from "../handlers/claude-diagnostics-handler.js";
import {
	generateProjectSummary,
	generatePipelineReport,
} from "../handlers/claude-summary-handler.js";
import {
	logOperation,
	getOperationLog,
	clearOperationLog,
} from "../claude-operation-log.js";
import { generatePersonaPlex } from "../handlers/claude-personaplex-handler.js";
import { findTimelineOverlaps } from "./timeline-overlap-diagnostic.js";
import { describeRefusedMove } from "./timeline-move-refusal.js";
import { readColorLabelField } from "./timeline-color-request.js";
import { withMediaProbes } from "../handlers/claude-media-probe.js";
import { withDefaultMediaDurations } from "../handlers/claude-media-default-duration.js";
import { registerAnalysisRoutes } from "./claude-http-analysis-routes.js";
import {
	type MutateAudioMix,
	registerAudioMixRoutes,
} from "./claude-http-audio-mix-routes.js";
import {
	getBackgroundJob,
	listBackgroundJobs,
	startBackgroundJob,
} from "./claude-http-background-jobs.js";
import { SCENE_DETECTION_ENGINE_CHOICES } from "../../types/claude-api.js";
import { measureNativeExportLoudness } from "../handlers/claude-export-handler/export-loudness.js";
import { registerSearchRoutes } from "./claude-http-search-routes.js";
import { registerGenerateRoutes } from "./claude-http-generate-routes.js";
import {
	getRequestCorrelationId,
	registerMetaRoutes,
	wrapRouterWithCorrelationTracking,
} from "./claude-http-meta-routes.js";
import type { DeepHealthReport } from "../handlers/claude-health-handler.js";
import {
	registerTransactionRoutes,
	type ClaudeHistorySummary,
	type ClaudeUndoRedoResponse,
} from "./claude-http-transaction-routes.js";
import { EditorApiClient } from "../../native-pipeline/editor/editor-api-client.js";
import { resolveQCutRuntimeEndpoint } from "../runtime-endpoint.js";
import { buildProjectJSON } from "../../native-pipeline/cli/project-json-builder.js";
import { claudeLog } from "../utils/logger.js";
import {
	findRestrictedMediaForExport,
	isRestrictedStickerLabMetadata,
	RestrictedMediaExportError,
} from "../../types/restricted-media-export-policy.js";
import { parseStickerLabMediaMetadata } from "../../types/sticker-lab-media-metadata.js";

export interface WindowProxy {
	webContents: {
		send(channel: string, ...args: unknown[]): void;
	};
}

/** Abstraction over how the server accesses renderer-dependent features */
export interface WindowAccessor {
	/** Get a BrowserWindow or proxy with webContents.send capability */
	getWindow(): WindowProxy;
	/** Request full timeline data from renderer */
	requestTimeline(): Promise<ClaudeTimeline>;
	/** Render a local MP4 through the live editor canvas and MP4 muxer. */
	requestLocalVideoExport?(
		request: ClaudeLocalVideoExportRequest
	): Promise<void>;
	/** Request current selection from renderer */
	requestSelection(correlationId?: string): Promise<ClaudeSelectionItem[]>;
	/** Add one timeline element and wait for the renderer acknowledgement. */
	requestAddElement?(
		projectId: string,
		element: Partial<ClaudeElement>,
		correlationId?: string
	): Promise<void>;
	/** Request an element split from renderer */
	requestSplit(
		elementId: string,
		splitTime: number,
		mode: string,
		correlationId?: string
	): Promise<ClaudeSplitResponse>;
	/** Split clips by their shots in the renderer (detection included). */
	requestShotSplit?(
		request: ClaudeShotSplitRequest,
		correlationId?: string
	): Promise<ClaudeShotSplitResponse>;
	/** Store a clip's beats in the editor's beat store (and bookmark them). */
	requestBeatsMark?(
		request: ClaudeBeatsMarkRequest,
		correlationId?: string
	): Promise<ClaudeBeatsMarkResponse>;
	/** Move clips onto marked beats through the editor's own move. */
	requestSnapToBeats?(
		request: ClaudeSnapToBeatsRequest,
		correlationId?: string
	): Promise<ClaudeSnapToBeatsResponse>;
	/** Get project stats (may need renderer) */
	getProjectStats(projectId: string): Promise<ProjectStats>;
	/** Get the app version string */
	getAppVersion(): string;
	/** Enable operation notifications to a PTY session */
	enableNotifications(
		sessionId: string
	): Promise<{ enabled: boolean; sessionId: string | null }>;
	/** Disable operation notifications */
	disableNotifications(): Promise<{
		enabled: boolean;
		sessionId: string | null;
	}>;
	/** Read operation notification bridge status */
	getNotificationsStatus(): Promise<{
		enabled: boolean;
		sessionId: string | null;
	}>;
	/** Read operation notification history */
	getNotificationsHistory(limit?: number): Promise<string[]>;
	/** Batch add elements (may need BrowserWindow or proxy) */
	batchAddElements(
		projectId: string,
		elements: ClaudeBatchAddElementRequest[],
		correlationId?: string
	): Promise<ClaudeBatchAddResponse>;
	/** Batch update elements */
	batchUpdateElements(
		updates: ClaudeBatchUpdateItemRequest[],
		correlationId?: string
	): Promise<ClaudeBatchUpdateResponse>;
	/** Batch delete elements */
	batchDeleteElements(
		elements: ClaudeBatchDeleteItemRequest[],
		ripple: boolean,
		correlationId?: string
	): Promise<ClaudeBatchDeleteResponse>;
	/** Arrange timeline */
	arrangeTimeline(
		data: ClaudeArrangeRequest,
		correlationId?: string
	): Promise<ClaudeArrangeResponse>;
	/** Create, reorder, or delete a timeline track. */
	mutateTrack(
		request: ClaudeTrackOperationRequest,
		correlationId?: string
	): Promise<ClaudeTrackOperationResponse>;
	/** Read or change the mixer: tracks' mix settings, buses, master. */
	mutateAudioMix?: MutateAudioMix;
	/** Begin a grouped transaction */
	beginTransaction(request?: TransactionRequest): Promise<Transaction>;
	/** Commit a grouped transaction */
	commitTransaction(
		transactionId: string
	): Promise<{ transaction: Transaction; historyEntryAdded: boolean }>;
	/** Rollback a grouped transaction */
	rollbackTransaction(
		transactionId: string,
		reason?: string
	): Promise<{ transaction: Transaction }>;
	/** Get transaction status */
	getTransactionStatus(transactionId: string): Promise<Transaction | null>;
	/** Trigger undo */
	undoTimeline(): Promise<ClaudeUndoRedoResponse>;
	/** Trigger redo */
	redoTimeline(): Promise<ClaudeUndoRedoResponse>;
	/** Read renderer history summary */
	getHistorySummary(): Promise<ClaudeHistorySummary>;
	/** Request editor state snapshot (optional, for media-path fallback) */
	requestStateSnapshot?(
		request?: EditorStateRequest
	): Promise<EditorStateSnapshot>;
	/** Import media into the renderer and wait for persistent storage. */
	requestMediaImport?(
		payload: Omit<ClaudeMediaImportedEvent, "requestId">
	): Promise<void>;
	/** Remove media from the renderer store and persistent storage. */
	requestMediaDelete?(
		payload: Omit<ClaudeMediaDeletedEvent, "requestId">
	): Promise<void>;
	/** Execute batch timeline cuts (optional utility-process bridge hook) */
	executeBatchCuts?(request: BatchCutRequest): Promise<BatchCutResponse>;
	/** Execute range delete (optional utility-process bridge hook) */
	executeDeleteRange?(
		request: ClaudeRangeDeleteRequest
	): Promise<ClaudeRangeDeleteResponse>;
	/** Start an auto-edit async job (optional utility-process bridge hook) */
	startAutoEditJob?(
		projectId: string,
		request: AutoEditRequest
	): Promise<{ jobId: string }>;
	/** Read async auto-edit job status (optional utility-process bridge hook) */
	getAutoEditJobStatus?(jobId: string): Promise<AutoEditJob | null>;
	/** List async auto-edit jobs (optional utility-process bridge hook) */
	listAutoEditJobs?(): Promise<AutoEditJob[]>;
	/** Cancel async auto-edit job (optional utility-process bridge hook) */
	cancelAutoEditJob?(jobId: string): Promise<boolean>;
}

export interface SharedRouteOptions {
	runDeepHealthChecks?: () => Promise<DeepHealthReport>;
	getWindowState?: () => Promise<{ hasWindow: boolean; count: number }>;
}

/**
 * Fail closed: without a renderer media snapshot, restricted Sticker Lab
 * media cannot be verified, so the export is refused with a capability error.
 */
function buildSnapshotUnavailableError({
	reason,
}: {
	reason: string;
}): HttpError {
	return new HttpError(
		503,
		`Renderer state snapshot ${reason}; export blocked because ` +
			"restricted media cannot be verified."
	);
}

function metadataRecord({
	metadata,
}: {
	metadata: unknown;
}): Record<string, unknown> {
	if (
		typeof metadata !== "object" ||
		metadata === null ||
		Array.isArray(metadata)
	) {
		throw new Error("Restricted renderer metadata must be an object.");
	}
	return metadata as Record<string, unknown>;
}

function parseRendererRestrictedMetadata({
	mediaId,
	metadata,
}: {
	mediaId: string;
	metadata: unknown;
}): NonNullable<MediaFile["metadata"]> {
	const record = metadataRecord({ metadata });
	const isPrimary = record.source === "sticker-lab";
	const isRuntimeResource = record.source === "sticker-runtime-resource";
	if (!(isPrimary || isRuntimeResource)) {
		throw new Error("Restricted renderer metadata has an invalid source.");
	}
	const provenance = parseStickerLabMediaMetadata({
		candidate: {
			animatedSticker: isPrimary ? record.animatedSticker : true,
			batchId: record.batchId,
			checksumSha256: record.checksumSha256,
			itemId: record.itemId,
			redistribution: record.redistribution,
			referenceOnly: record.referenceOnly,
			source: "sticker-lab",
			usage: record.usage,
		},
		label: `Renderer media ${mediaId} restricted provenance`,
	});
	if (isPrimary) return { ...record, ...provenance };

	if (
		record.stickerAssetId !==
			`sticker-lab:${provenance.batchId}:${provenance.itemId}` ||
		record.stickerAssetVersion !== 1 ||
		typeof record.stickerRuntimeResourceName !== "string" ||
		record.stickerRuntimeResourceName.length === 0 ||
		record.stickerRuntimeResourceName.length > 256
	) {
		throw new Error(
			"Restricted renderer runtime resource metadata is invalid."
		);
	}
	return {
		...record,
		batchId: provenance.batchId,
		checksumSha256: provenance.checksumSha256,
		itemId: provenance.itemId,
		redistribution: provenance.redistribution,
		referenceOnly: provenance.referenceOnly,
		source: "sticker-runtime-resource",
		usage: provenance.usage,
	};
}

/** Handle list media files with renderer fallback. */
async function listMediaFilesWithRendererFallback({
	projectId,
	accessor,
}: {
	projectId: string;
	accessor: WindowAccessor;
}): Promise<MediaFile[]> {
	const diskMedia = await listMediaFiles(projectId);
	if (!accessor.requestStateSnapshot) {
		throw buildSnapshotUnavailableError({
			reason: "capability is unavailable",
		});
	}

	let snapshot: EditorStateSnapshot | null = null;
	try {
		snapshot = await accessor.requestStateSnapshot({ include: ["media"] });
	} catch {
		throw buildSnapshotUnavailableError({ reason: "request failed" });
	}

	const mediaItems = snapshot?.state?.media?.items;
	if (!Array.isArray(mediaItems)) {
		throw buildSnapshotUnavailableError({
			reason: "did not include a media list",
		});
	}
	if (mediaItems.length === 0) return diskMedia;

	const merged = new Map<string, MediaFile>();
	const diskMediaByName = new Map<string, MediaFile>();
	for (const media of diskMedia) {
		merged.set(media.id, media);
		diskMediaByName.set(media.name, media);
	}

	for (const item of mediaItems) {
		if (
			!(item.type === "video" || item.type === "image" || item.type === "audio")
		) {
			continue;
		}
		let restrictedMetadata: MediaFile["metadata"];
		if (isRestrictedStickerLabMetadata({ metadata: item.metadata })) {
			try {
				restrictedMetadata = parseRendererRestrictedMetadata({
					mediaId: item.id,
					metadata: item.metadata,
				});
			} catch {
				throw new RestrictedMediaExportError({
					mediaIds: [item.id],
					operation: "video",
				});
			}
		}
		if (restrictedMetadata) {
			const existing = merged.get(item.id) ?? diskMediaByName.get(item.name);
			const restrictedRecord: MediaFile = {
				createdAt: existing?.createdAt ?? 0,
				duration: item.duration ?? existing?.duration,
				id: item.id,
				metadata: restrictedMetadata,
				modifiedAt: existing?.modifiedAt ?? 0,
				name: item.name,
				path: existing?.path ?? "",
				size: existing?.size ?? 0,
				type: item.type,
				...(typeof item.width === "number" && typeof item.height === "number"
					? { dimensions: { width: item.width, height: item.height } }
					: existing?.dimensions
						? { dimensions: existing.dimensions }
						: {}),
			};
			if (existing && existing.id !== item.id) {
				merged.set(existing.id, {
					...existing,
					metadata: restrictedMetadata,
				});
			}
			merged.set(item.id, restrictedRecord);
		}
		if (typeof item.localPath !== "string" || !item.localPath.trim()) {
			continue;
		}

		const localPath = item.localPath.trim();
		if (!isValidSourcePath(localPath)) {
			continue;
		}
		try {
			const stat = await fsPromises.stat(localPath);
			const existing = merged.get(item.id);
			merged.set(item.id, {
				id: item.id,
				name: item.name,
				type: item.type,
				path: localPath,
				size: stat.size,
				duration: item.duration,
				dimensions:
					typeof item.width === "number" && typeof item.height === "number"
						? { width: item.width, height: item.height }
						: undefined,
				createdAt: stat.birthtimeMs,
				modifiedAt: stat.mtimeMs,
				...((restrictedMetadata ?? existing?.metadata)
					? { metadata: restrictedMetadata ?? existing?.metadata }
					: {}),
			});
		} catch {
			// Ignore stale localPath entries
		}
	}

	return [...merged.values()];
}

const PROJECT_JSON_SYNC_DEBOUNCE_MS = 1000;
const TIMELINE_SYNC_BARRIER_TIMEOUT_MS = 5000;

/**
 * How far the read-back position may sit from the requested one before the move
 * counts as refused. One frame at 30fps, so a snap or rounding is not reported
 * as a rejection.
 */
const MOVE_START_TIME_TOLERANCE_SECONDS = 1 / 30;
const projectJsonSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const projectJsonSyncInFlight = new Map<string, Promise<void>>();

/** Rebuild project.json from the live editor API and persist it beside the project. */
async function writeProjectJsonSnapshot({
	projectId,
}: {
	projectId: string;
}): Promise<void> {
	try {
		const client = new EditorApiClient({
			baseUrl: resolveQCutRuntimeEndpoint().baseUrl,
			timeout: 5000,
			skipCapabilityCheck: true,
		});
		const snapshot = await buildProjectJSON(client, projectId);
		const projectDir = getProjectPath(projectId);
		await fsPromises.mkdir(projectDir, { recursive: true });
		await fsPromises.writeFile(
			path.join(projectDir, "project.json"),
			JSON.stringify(snapshot, null, 2),
			"utf-8"
		);
		claudeLog.info(
			"HTTP",
			`[ProjectJSON] Auto-synced project.json for ${projectId}`
		);
	} catch (error) {
		claudeLog.warn(
			"HTTP",
			`[ProjectJSON] Auto-sync failed for ${projectId}: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}
}

/** Debounce best-effort project.json regeneration after timeline mutations. */
function scheduleProjectJsonAutoSync({
	projectId,
}: {
	projectId: string;
}): void {
	try {
		const normalizedProjectId = projectId.trim();
		if (!normalizedProjectId) return;

		const existingTimer = projectJsonSyncTimers.get(normalizedProjectId);
		if (existingTimer) clearTimeout(existingTimer);

		const timer = setTimeout(() => {
			projectJsonSyncTimers.delete(normalizedProjectId);
			const previousWrite =
				projectJsonSyncInFlight.get(normalizedProjectId) ?? Promise.resolve();
			const nextWrite = previousWrite
				.catch(() => undefined)
				.then(() =>
					writeProjectJsonSnapshot({ projectId: normalizedProjectId })
				)
				.finally(() => {
					if (projectJsonSyncInFlight.get(normalizedProjectId) === nextWrite) {
						projectJsonSyncInFlight.delete(normalizedProjectId);
					}
				});
			projectJsonSyncInFlight.set(normalizedProjectId, nextWrite);
		}, PROJECT_JSON_SYNC_DEBOUNCE_MS);

		projectJsonSyncTimers.set(normalizedProjectId, timer);
	} catch {
		// Best-effort sync scheduling only.
	}
}

/** Wait for a renderer roundtrip so timeline writes settle before reading project state. */
/**
 * The renderer holds exactly one open project, and every timeline accessor
 * operates on it. The `:projectId` in these routes was therefore decorative:
 * asking for another project silently returned the open project's timeline, or
 * applied a mutation to it. Refuse instead of answering about, or editing, a
 * project the caller did not name.
 *
 * Accessors predating state snapshots are left compatible. Once an accessor
 * advertises snapshot support, mutations fail closed if the renderer cannot
 * prove which project is open.
 */
// Generous on purpose: right after a media batch-import the renderer can
// be busy generating thumbnails/waveforms for seconds, and a too-tight
// window makes every mutation guard flake with 503s. The guard still
// fails closed when the snapshot never arrives.

/**
 * Orders a fire-and-forget mutation against the next read, and hands back the
 * timeline it read so callers can confirm what actually happened. Returns null
 * when the renderer could not be reached — ordering is best-effort, so a failed
 * read must not turn a successful mutation into an error.
 */
async function waitForTimelineMutationBarrier({
	accessor,
}: {
	accessor: WindowAccessor;
}): Promise<ClaudeTimeline | null> {
	try {
		return await Promise.race([
			accessor.requestTimeline(),
			new Promise<never>((_, reject) => {
				setTimeout(() => {
					reject(new Error("Timeline mutation barrier timed out"));
				}, TIMELINE_SYNC_BARRIER_TIMEOUT_MS);
			}),
		]);
	} catch {
		// Best-effort ordering only.
		return null;
	}
}

function hasActivePortraitAdjustments({
	candidate,
}: {
	candidate: unknown;
}): boolean {
	if (
		typeof candidate !== "object" ||
		candidate === null ||
		Array.isArray(candidate)
	) {
		return false;
	}
	const adjustments = candidate as Record<string, unknown>;
	if (adjustments.enabled !== true) return false;
	if (
		typeof adjustments.values !== "object" ||
		adjustments.values === null ||
		Array.isArray(adjustments.values)
	) {
		return false;
	}
	return Object.values(adjustments.values).some(
		(value) =>
			typeof value === "number" && Number.isFinite(value) && value !== 0
	);
}

/**
 * A track's switches from a request body: `muted`, `hidden` and `locked`,
 * each true or false when given.
 */
function readTrackSwitches({
	body,
}: {
	body: Record<string, unknown> | undefined;
}): Pick<ClaudeTrackOperationRequest, "muted" | "hidden" | "locked"> {
	const switches: Pick<
		ClaudeTrackOperationRequest,
		"muted" | "hidden" | "locked"
	> = {};
	for (const key of ["muted", "hidden", "locked"] as const) {
		const value = body?.[key];
		if (value === undefined) continue;
		if (typeof value !== "boolean") {
			throw new HttpError(400, `'${key}' must be true or false`);
		}
		switches[key] = value;
	}
	return switches;
}

export function timelineRequiresRendererPortraitExport({
	timeline,
}: {
	timeline: ClaudeTimeline;
}): boolean {
	for (const track of timeline.tracks) {
		for (const element of track.elements) {
			if (element.type !== "media" && element.type !== "video") continue;
			const enhancements =
				typeof element.enhancements === "object" &&
				element.enhancements !== null &&
				!Array.isArray(element.enhancements)
					? (element.enhancements as Record<string, unknown>)
					: null;
			const eyeCorrection = enhancements?.labEyeCorrection;
			if (
				typeof eyeCorrection === "number" &&
				Number.isFinite(eyeCorrection) &&
				eyeCorrection > 0
			) {
				return true;
			}
			if (
				hasActivePortraitAdjustments({
					candidate: element.portraitAdjustments,
				})
			) {
				return true;
			}
		}
	}
	return false;
}

async function requireRendererMutation({
	operation,
	request,
}: {
	operation: string;
	request: () => Promise<void>;
}): Promise<void> {
	try {
		await request();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/timed out|timeout/i.test(message)) {
			throw new HttpError(504, `${operation} timed out: ${message}`);
		}
		if (/unavailable|destroyed|no active window/i.test(message)) {
			throw new HttpError(503, `${operation} is unavailable: ${message}`);
		}
		throw new HttpError(409, `${operation} was rejected: ${message}`);
	}
}

/** Where an element currently sits, or null when it is not on the timeline. */
function locateElement({
	timeline,
	elementId,
}: {
	timeline: ClaudeTimeline;
	elementId: string;
}): { trackId: string | undefined; startTime: number } | null {
	for (const track of timeline.tracks ?? []) {
		for (const element of track.elements ?? []) {
			if (element.id === elementId) {
				return { trackId: track.id, startTime: element.startTime };
			}
		}
	}
	return null;
}

/**
 * Register all shared API routes onto the given router.
 * The WindowAccessor abstracts over direct vs proxied BrowserWindow access.
 */
const SHOT_SPLIT_ENGINE_CHOICES = SCENE_DETECTION_ENGINE_CHOICES;

/** The shot-split body, checked field by field; refusals name the field. */
export { assertProjectIsOpen };

export function readShotSplitRequest({
	projectId,
	body,
}: {
	projectId: string;
	body: unknown;
}): ClaudeShotSplitRequest {
	const input = (body ?? {}) as Record<string, unknown>;
	const elementId =
		typeof input.elementId === "string" && input.elementId.trim()
			? input.elementId.trim()
			: undefined;
	const trackId =
		typeof input.trackId === "string" && input.trackId.trim()
			? input.trackId.trim()
			: undefined;
	if ((elementId === undefined) === (trackId === undefined)) {
		throw new HttpError(400, "Give exactly one of elementId or trackId");
	}
	const request: ClaudeShotSplitRequest = { projectId, elementId, trackId };
	if (input.engine !== undefined) {
		if (!SHOT_SPLIT_ENGINE_CHOICES.some((choice) => choice === input.engine)) {
			throw new HttpError(
				400,
				`engine must be one of ${SHOT_SPLIT_ENGINE_CHOICES.join(", ")}`
			);
		}
		request.engine = input.engine as ClaudeShotSplitRequest["engine"];
	}
	if (input.cuts !== undefined) {
		if (
			!Array.isArray(input.cuts) ||
			input.cuts.some(
				(value) =>
					typeof value !== "number" || !Number.isFinite(value) || value < 0
			)
		) {
			throw new HttpError(400, "cuts must be an array of non-negative seconds");
		}
		request.cuts = input.cuts as number[];
	}
	for (const field of ["threshold", "minShotSeconds"] as const) {
		const value = input[field];
		if (value === undefined) continue;
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
			throw new HttpError(400, `${field} must be a non-negative number`);
		}
		request[field] = value;
	}
	if (input.dryRun !== undefined) {
		if (typeof input.dryRun !== "boolean") {
			throw new HttpError(400, "dryRun must be true or false");
		}
		request.dryRun = input.dryRun;
	}
	// Same rule as analyze scenes: a threshold with an engine that ignores it
	// (or with given cuts) is a mistake, not something to accept silently.
	if (
		request.threshold !== undefined &&
		(request.cuts !== undefined ||
			(request.engine !== undefined &&
				request.engine !== "ffmpeg" &&
				request.engine !== "auto"))
	) {
		throw new HttpError(
			400,
			"threshold is only supported by the FFmpeg scene engine"
		);
	}
	return request;
}

export function registerSharedRoutes(
	router: Router,
	accessor: WindowAccessor,
	options?: SharedRouteOptions
): void {
	wrapRouterWithCorrelationTracking({ router });
	registerMetaRoutes({
		router,
		/** Returns the current application version for metadata routes. */
		getAppVersion: () => accessor.getAppVersion(),
		runDeepHealthChecks: options?.runDeepHealthChecks,
		getWindowState: options?.getWindowState,
	});

	// ==========================================================================
	// Notifications bridge routes
	// ==========================================================================
	router.post("/api/claude/notifications/enable", async (req) => {
		const sessionId =
			typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
		if (!sessionId.trim()) {
			throw new HttpError(400, "Missing 'sessionId' in request body");
		}
		return await accessor.enableNotifications(sessionId.trim());
	});

	router.post("/api/claude/notifications/disable", async () => {
		return await accessor.disableNotifications();
	});

	router.get("/api/claude/notifications/status", async () => {
		return await accessor.getNotificationsStatus();
	});

	router.get("/api/claude/notifications/history", async (req) => {
		const limit = Number.parseInt(req.query.limit ?? "", 10);
		const resolvedLimit =
			Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : undefined;
		return await accessor.getNotificationsHistory(resolvedLimit);
	});

	router.post("/api/claude/notifications/toggle", async (req) => {
		const enabled = req.body?.enabled;
		if (enabled === true) {
			const sessionId =
				typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
			if (!sessionId.trim()) {
				throw new HttpError(
					400,
					"Missing 'sessionId' in request body when enabled=true"
				);
			}
			return await accessor.enableNotifications(sessionId.trim());
		}
		if (enabled === false) {
			return await accessor.disableNotifications();
		}
		throw new HttpError(400, "Missing 'enabled' boolean in request body");
	});

	// ==========================================================================
	// Media routes (file-system based -- no renderer needed)
	// ==========================================================================
	// Listings carry duration, size and frame rate so a caller can place clips
	// without probing the files itself.
	router.get("/api/claude/media/:projectId", async (req) =>
		withMediaProbes(await listMediaFiles(req.params.projectId))
	);

	router.get("/api/claude/media/:projectId/:mediaId", async (req) => {
		const media = await getMediaInfo(req.params.projectId, req.params.mediaId);
		return media ? (await withMediaProbes([media]))[0] : media;
	});

	router.post("/api/claude/media/:projectId/import", async (req) => {
		if (!req.body?.source)
			throw new HttpError(400, "Missing 'source' in request body");
		let metadata: StickerLabMediaImportMetadata | undefined;
		try {
			metadata = parseStickerLabMediaImportMetadata({
				candidate: req.body.metadata,
			});
		} catch (error) {
			throw new HttpError(
				400,
				error instanceof Error ? error.message : "Invalid media import metadata"
			);
		}
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		const media = await importMediaFile(req.params.projectId, req.body.source);
		if (media) {
			const importedEvent = {
				projectId: req.params.projectId,
				path: media.path,
				name: media.name,
				id: media.id,
				...(metadata ? { metadata } : {}),
				type: media.type,
				size: media.size,
			};
			if (metadata) {
				let rendererImportAttempted = false;
				try {
					await persistMediaRestrictedMetadata({
						mediaId: media.id,
						metadata,
						projectId: req.params.projectId,
					});
					if (!accessor.requestMediaImport) {
						throw new HttpError(
							503,
							"Renderer media acknowledgement is unavailable"
						);
					}
					rendererImportAttempted = true;
					await accessor.requestMediaImport(importedEvent);
				} catch (error) {
					if (rendererImportAttempted) {
						await accessor
							.requestMediaDelete?.({
								mediaId: media.id,
								projectId: req.params.projectId,
							})
							.catch(() => undefined);
					}
					await deleteMediaFile(req.params.projectId, media.id).catch(
						() => false
					);
					throw error;
				}
			} else {
				try {
					accessor
						.getWindow()
						.webContents.send("claude:media:imported", importedEvent);
				} catch {
					/* legacy imports do not require renderer acknowledgement */
				}
			}
			logOperation({
				stage: 1,
				action: "import",
				details: `Imported media from path: ${req.body.source}`,
				timestamp: Date.now(),
				projectId: req.params.projectId,
			});
		}
		scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
		return media;
	});

	router.delete("/api/claude/media/:projectId/:mediaId", async (req) => {
		await assertProjectIsOpen({
			accessor,
			projectId: req.params.projectId,
		});
		const media = await getMediaInfo(req.params.projectId, req.params.mediaId);
		if (!media) return false;
		const requestMediaDelete = accessor.requestMediaDelete;
		if (!requestMediaDelete) {
			throw new HttpError(
				503,
				"Renderer media deletion acknowledgement is unavailable"
			);
		}
		await requireRendererMutation({
			operation: "Renderer media deletion",
			request: () =>
				requestMediaDelete({
					mediaId: media.id,
					projectId: req.params.projectId,
				}),
		});
		const result = await deleteMediaFile(req.params.projectId, media.id);
		if (!result) {
			throw new HttpError(
				500,
				"The renderer removed the media, but its project file remains on disk. Retry the delete to reconcile the project."
			);
		}
		scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
		return true;
	});

	router.patch("/api/claude/media/:projectId/:mediaId/rename", async (req) => {
		if (!req.body?.newName)
			throw new HttpError(400, "Missing 'newName' in request body");
		await assertProjectIsOpen({
			accessor,
			projectId: req.params.projectId,
		});
		const result = await renameMediaFile(
			req.params.projectId,
			req.params.mediaId,
			req.body.newName
		);
		scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
		return result;
	});

	router.post("/api/claude/media/:projectId/import-from-url", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		if (!req.body?.url)
			throw new HttpError(400, "Missing 'url' in request body");
		const result = await importMediaFromUrl(
			req.params.projectId,
			req.body.url,
			req.body.filename
		);
		logOperation({
			stage: 1,
			action: "import",
			details: `Imported media from URL: ${req.body.url}`,
			timestamp: Date.now(),
			projectId: req.params.projectId,
		});
		scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
		return result;
	});

	router.post("/api/claude/media/:projectId/batch-import", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		if (!Array.isArray(req.body?.items))
			throw new HttpError(400, "Missing 'items' array in request body");
		const result = await batchImportMedia(req.params.projectId, req.body.items);
		logOperation({
			stage: 1,
			action: "import",
			details: `Batch import processed ${req.body.items.length} item(s)`,
			timestamp: Date.now(),
			projectId: req.params.projectId,
		});
		scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
		return result;
	});

	router.post(
		"/api/claude/media/:projectId/:mediaId/extract-frame",
		async (req) => {
			if (typeof req.body?.timestamp !== "number")
				throw new HttpError(
					400,
					"Missing 'timestamp' (number) in request body"
				);
			const result = await extractFrame(
				req.params.projectId,
				req.params.mediaId,
				req.body.timestamp,
				req.body.format
			);
			scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
			return result;
		}
	);

	// ==========================================================================
	// Generate routes
	// ==========================================================================
	registerGenerateRoutes(router);

	// ==========================================================================
	// Timeline routes
	// ==========================================================================
	router.get("/api/claude/timeline/:projectId", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		const timeline = await Promise.race([
			accessor.requestTimeline(),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)
			),
		]);
		const format = req.query.format || "json";
		if (format === "md") return timelineToMarkdown(timeline);

		// Projects saved before a track became a single lane can still hold
		// stacked elements. Report them rather than repairing them silently: the
		// fix is editor:timeline:arrange, which the caller chooses to run.
		const overlaps = findTimelineOverlaps({ timeline });
		if (overlaps.length === 0) return timeline;
		return { ...timeline, overlaps };
	});

	router.post("/api/claude/timeline/:projectId/tracks", async (req) => {
		if (typeof req.body?.type !== "string") {
			throw new HttpError(400, "Missing 'type' in request body");
		}
		const colorLabel = readColorLabelField({
			value: req.body.colorLabel,
			field: "colorLabel",
		});
		const switches = readTrackSwitches({ body: req.body });
		// Input first (400), then the project (409), then the editor.
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		const result = await accessor.mutateTrack(
			{
				action: "create",
				type: req.body.type as ClaudeTrackOperationRequest["type"],
				name: typeof req.body.name === "string" ? req.body.name : undefined,
				index: req.body.index,
				...(colorLabel !== undefined ? { colorLabel } : {}),
				...switches,
			},
			getRequestCorrelationId({ req })
		);
		if (!result.success)
			throw new HttpError(400, result.error || "Create failed");
		scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
		return result;
	});

	router.patch(
		"/api/claude/timeline/:projectId/tracks/:trackId",
		async (req) => {
			const colorLabel = readColorLabelField({
				value: req.body?.colorLabel,
				field: "colorLabel",
			});
			const switches = readTrackSwitches({ body: req.body });
			if (
				typeof req.body?.index !== "number" &&
				typeof req.body?.name !== "string" &&
				colorLabel === undefined &&
				Object.keys(switches).length === 0
			) {
				throw new HttpError(
					400,
					"Track update needs 'index', 'name', 'colorLabel', 'muted', 'hidden' or 'locked'"
				);
			}
			// Input first (400), then the project (409), then the editor.
			await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
			const result = await accessor.mutateTrack(
				{
					action: "update",
					trackId: req.params.trackId,
					index: req.body.index,
					name: typeof req.body.name === "string" ? req.body.name : undefined,
					...(colorLabel !== undefined ? { colorLabel } : {}),
					...switches,
				},
				getRequestCorrelationId({ req })
			);
			if (!result.success)
				throw new HttpError(400, result.error || "Update failed");
			scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
			return result;
		}
	);

	router.post(
		"/api/claude/timeline/:projectId/tracks/:trackId/transitions",
		async (req) => {
			await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
			if (!req.body || typeof req.body !== "object") {
				throw new HttpError(400, "Missing transition data");
			}
			const duration = (req.body as { duration?: unknown }).duration;
			if (typeof duration !== "number" || !Number.isFinite(duration)) {
				throw new HttpError(
					400,
					"Transition 'duration' must be a number of seconds"
				);
			}
			const result = await accessor.mutateTrack(
				{
					action: "add-transition",
					trackId: req.params.trackId,
					transition: req.body,
				},
				getRequestCorrelationId({ req })
			);
			if (!result.success) {
				throw new HttpError(400, result.error || "Transition failed");
			}
			scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
			return result;
		}
	);

	router.delete(
		"/api/claude/timeline/:projectId/tracks/:trackId",
		async (req) => {
			await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
			const result = await accessor.mutateTrack(
				{
					action: "delete",
					trackId: req.params.trackId,
					ripple: req.body?.ripple === true,
					force: req.body?.force === true,
				},
				getRequestCorrelationId({ req })
			);
			if (!result.success)
				throw new HttpError(400, result.error || "Delete failed");
			scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
			return result;
		}
	);

	router.post("/api/claude/timeline/:projectId/import", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		if (!req.body?.data)
			throw new HttpError(400, "Missing 'data' in request body");
		const format = req.body.format || "json";
		let timeline;
		if (format === "md") {
			try {
				timeline = markdownToTimeline(req.body.data);
			} catch (e) {
				throw new HttpError(
					400,
					e instanceof Error ? e.message : "Invalid markdown"
				);
			}
		} else {
			if (typeof req.body.data === "string") {
				try {
					timeline = JSON.parse(req.body.data);
				} catch {
					throw new HttpError(400, "Invalid JSON in 'data'");
				}
			} else {
				timeline = req.body.data;
			}
		}
		validateTimeline(timeline);
		const win = accessor.getWindow();
		const correlationId = getRequestCorrelationId({ req });
		win.webContents.send("claude:timeline:apply", {
			correlationId,
			timeline,
			replace: req.body.replace === true,
		});
		await waitForTimelineMutationBarrier({ accessor });
		scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
		return { imported: true };
	});

	router.post("/api/claude/timeline/:projectId/elements", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		if (!req.body)
			throw new HttpError(400, "Missing element data in request body");
		const correlationId = getRequestCorrelationId({ req });
		const elementId =
			req.body.id ||
			`element_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
		const requestAddElement = accessor.requestAddElement;
		if (!requestAddElement) {
			throw new HttpError(
				503,
				"Renderer timeline element acknowledgement is unavailable"
			);
		}
		// Media named without a length gets its file's length, so the clip is
		// not placed at whatever the editor guessed before the file loaded.
		const [element] = await withDefaultMediaDurations({
			projectId: req.params.projectId,
			elements: [{ ...req.body, id: elementId }],
		});
		await requireRendererMutation({
			operation: "Timeline element placement",
			request: () =>
				requestAddElement(req.params.projectId, element, correlationId),
		});
		scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
		return { elementId };
	});

	router.post("/api/claude/timeline/:projectId/elements/batch", async (req) => {
		await assertProjectIsOpen({
			accessor,
			projectId: req.params.projectId,
		});
		if (!Array.isArray(req.body?.elements))
			throw new HttpError(400, "Missing 'elements' array in request body");
		try {
			const result = await accessor.batchAddElements(
				req.params.projectId,
				req.body.elements,
				getRequestCorrelationId({ req })
			);
			scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
			return result;
		} catch (error) {
			throw new HttpError(
				400,
				error instanceof Error ? error.message : "Batch add failed"
			);
		}
	});

	router.patch(
		"/api/claude/timeline/:projectId/elements/batch",
		async (req) => {
			await assertProjectIsOpen({
				accessor,
				projectId: req.params.projectId,
			});
			if (!Array.isArray(req.body?.updates))
				throw new HttpError(400, "Missing 'updates' array in request body");
			try {
				const result = await accessor.batchUpdateElements(
					req.body.updates,
					getRequestCorrelationId({ req })
				);
				scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
				return result;
			} catch (error) {
				throw new HttpError(
					400,
					error instanceof Error ? error.message : "Batch update failed"
				);
			}
		}
	);

	router.patch(
		"/api/claude/timeline/:projectId/elements/:elementId",
		async (req) => {
			await assertProjectIsOpen({
				accessor,
				projectId: req.params.projectId,
			});
			const correlationId = getRequestCorrelationId({ req });
			let ignoredFields: string[] | undefined;
			await requireRendererMutation({
				operation: "Timeline element update",
				request: async () => {
					const result = await accessor.batchUpdateElements(
						[
							{
								...(req.body || {}),
								elementId: req.params.elementId,
							},
						],
						correlationId
					);
					const item = result.results[0];
					if (result.updatedCount !== 1 || item?.success !== true) {
						throw new Error(item?.error || "Renderer did not apply the update");
					}
					ignoredFields = item.ignoredFields;
				},
			});
			scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
			// Fields the element could not use are named, not swallowed.
			return ignoredFields?.length
				? { updated: true, ignoredFields }
				: { updated: true };
		}
	);

	router.delete(
		"/api/claude/timeline/:projectId/elements/batch",
		async (req) => {
			await assertProjectIsOpen({
				accessor,
				projectId: req.params.projectId,
			});
			if (!Array.isArray(req.body?.elements))
				throw new HttpError(400, "Missing 'elements' array in request body");
			try {
				const result = await accessor.batchDeleteElements(
					req.body.elements,
					Boolean(req.body.ripple),
					getRequestCorrelationId({ req })
				);
				scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
				return result;
			} catch (error) {
				throw new HttpError(
					400,
					error instanceof Error ? error.message : "Batch delete failed"
				);
			}
		}
	);

	router.delete(
		"/api/claude/timeline/:projectId/elements/:elementId",
		async (req) => {
			await assertProjectIsOpen({
				accessor,
				projectId: req.params.projectId,
			});
			const win = accessor.getWindow();
			win.webContents.send(
				"claude:timeline:removeElement",
				req.params.elementId
			);
			await waitForTimelineMutationBarrier({ accessor });
			scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
			return { removed: true };
		}
	);

	router.post("/api/claude/timeline/:projectId/arrange", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		if (!req.body?.trackId || typeof req.body.trackId !== "string")
			throw new HttpError(400, "Missing 'trackId' in request body");
		if (!req.body?.mode || typeof req.body.mode !== "string")
			throw new HttpError(400, "Missing 'mode' in request body");
		if (!["sequential", "spaced", "manual"].includes(req.body.mode))
			throw new HttpError(
				400,
				"Invalid mode. Use sequential, spaced, or manual"
			);
		try {
			const result = await accessor.arrangeTimeline(
				{
					trackId: req.body.trackId,
					mode: req.body.mode,
					gap: req.body.gap,
					order: req.body.order,
					startOffset: req.body.startOffset,
				},
				getRequestCorrelationId({ req })
			);
			scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
			return result;
		} catch (error) {
			throw new HttpError(
				400,
				error instanceof Error ? error.message : "Arrange request failed"
			);
		}
	});

	router.post(
		"/api/claude/timeline/:projectId/elements/:elementId/split",
		async (req) => {
			if (typeof req.body?.splitTime !== "number")
				throw new HttpError(
					400,
					"Missing 'splitTime' (number) in request body"
				);
			const mode = req.body.mode || "split";
			if (!["split", "keepLeft", "keepRight"].includes(mode))
				throw new HttpError(
					400,
					"Invalid mode. Use 'split', 'keepLeft', or 'keepRight'"
				);
			// Input first (400), then the project (409), then the editor.
			await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
			const result = await accessor.requestSplit(
				req.params.elementId,
				req.body.splitTime,
				mode,
				getRequestCorrelationId({ req })
			);
			scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
			return result;
		}
	);

	// Splitting by shots detects first (seconds to minutes), so it is a job:
	// the answer is a job id, polled at /timeline/:projectId/jobs/:jobId.
	router.post("/api/claude/timeline/:projectId/shot-split", async (req) => {
		const request = readShotSplitRequest({
			projectId: req.params.projectId,
			body: req.body,
		});
		if (!accessor.requestShotSplit) {
			throw new HttpError(
				503,
				"Shot splitting is not available in this editor"
			);
		}
		// The renderer resolves ids against the open project; a mismatch is a
		// 409 now, not an opaque job error later.
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		const requestShotSplit = accessor.requestShotSplit.bind(accessor);
		const correlationId = getRequestCorrelationId({ req });
		const job = startBackgroundJob({
			projectId: req.params.projectId,
			kind: "shot-split",
			message: request.dryRun
				? "Detecting shots"
				: "Detecting shots and splitting the timeline",
			run: async () => {
				const response = await requestShotSplit(request, correlationId);
				if (
					!request.dryRun &&
					response.results.some((r) => r.createdElementIds.length > 0)
				) {
					scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
				}
				return response;
			},
		});
		return { jobId: job.jobId, status: job.status, kind: job.kind };
	});

	router.get("/api/claude/timeline/:projectId/jobs/:jobId", async (req) => {
		const job = getBackgroundJob(req.params.jobId);
		if (!job || job.projectId !== req.params.projectId) {
			throw new HttpError(404, `Timeline job not found: ${req.params.jobId}`);
		}
		return job;
	});

	router.get("/api/claude/timeline/:projectId/jobs", async (req) =>
		listBackgroundJobs(req.params.projectId)
	);

	router.post(
		"/api/claude/timeline/:projectId/elements/:elementId/move",
		async (req) => {
			await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
			const hasStartTime = typeof req.body?.newStartTime === "number";
			if (!req.body?.toTrackId && !hasStartTime)
				throw new HttpError(
					400,
					"Give 'toTrackId', 'newStartTime', or both in the request body"
				);
			// Without a target track the element stays on its own track.
			let toTrackId: string = req.body.toTrackId;
			if (!toTrackId) {
				const before = await accessor.requestTimeline();
				const current = locateElement({
					timeline: before,
					elementId: req.params.elementId,
				});
				if (!current) {
					throw new HttpError(
						404,
						`Element ${req.params.elementId} is not on the timeline.`
					);
				}
				if (current.trackId === undefined) {
					throw new HttpError(
						409,
						`The track of element ${req.params.elementId} has no id; pass 'toTrackId'.`
					);
				}
				toTrackId = current.trackId;
			}
			const win = accessor.getWindow();
			const correlationId = getRequestCorrelationId({ req });
			win.webContents.send("claude:timeline:moveElement", {
				correlationId,
				elementId: req.params.elementId,
				toTrackId,
				newStartTime: req.body.newStartTime,
			});
			const timeline = await waitForTimelineMutationBarrier({ accessor });
			scheduleProjectJsonAutoSync({ projectId: req.params.projectId });

			// The renderer refuses a move that would stack two elements on one
			// track, so read back where the element actually ended up rather than
			// reporting an unconditional success.
			if (!timeline) return { moved: true, verified: false };
			const placed = locateElement({
				timeline,
				elementId: req.params.elementId,
			});
			if (!placed) {
				throw new HttpError(
					500,
					`Element ${req.params.elementId} is no longer on the timeline after the move.`
				);
			}
			if (placed.trackId === undefined) {
				return { moved: true, verified: false };
			}
			// A move within one track keeps the track id, so the requested time is
			// the only evidence that the placement was refused.
			const refused =
				placed.trackId !== toTrackId ||
				(typeof req.body.newStartTime === "number" &&
					Math.abs(placed.startTime - req.body.newStartTime) >
						MOVE_START_TIME_TOLERANCE_SECONDS);
			if (refused) {
				throw new HttpError(
					409,
					describeRefusedMove({
						timeline,
						elementId: req.params.elementId,
						toTrackId,
						startTime:
							typeof req.body.newStartTime === "number"
								? req.body.newStartTime
								: undefined,
					})
				);
			}
			return {
				moved: true,
				trackId: placed.trackId,
				startTime: placed.startTime,
			};
		}
	);

	router.post("/api/claude/timeline/:projectId/selection", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		const colorLabel = readColorLabelField({
			value: req.body?.colorLabel,
			field: "colorLabel",
		});
		if (colorLabel === null) {
			throw new HttpError(400, "colorLabel must name a colour to select");
		}
		if (colorLabel === undefined && !Array.isArray(req.body?.elements))
			throw new HttpError(
				400,
				"Missing 'elements' array or 'colorLabel' in request body"
			);
		const win = accessor.getWindow();
		const correlationId = getRequestCorrelationId({ req });
		win.webContents.send("claude:timeline:selectElements", {
			correlationId,
			...(colorLabel ? { colorLabel } : { elements: req.body.elements }),
		});
		if (!colorLabel) return { selected: req.body.elements.length };
		// Selecting by colour is decided in the editor, so read the result back.
		const elements = await accessor.requestSelection(correlationId);
		return { selected: elements.length, elements };
	});

	router.post("/api/claude/timeline/:projectId/color-label", async (req) => {
		const colorLabel = readColorLabelField({
			value: req.body?.colorLabel,
			field: "colorLabel",
		});
		if (colorLabel === undefined) {
			throw new HttpError(
				400,
				"Missing 'colorLabel' (a colour, or none to clear)"
			);
		}
		const elementIds = Array.isArray(req.body?.elementIds)
			? (req.body.elementIds as unknown[]).filter(
					(id): id is string => typeof id === "string"
				)
			: undefined;
		const trackId =
			typeof req.body?.trackId === "string" ? req.body.trackId : undefined;
		if (!trackId && (!elementIds || elementIds.length === 0)) {
			throw new HttpError(400, "Give 'trackId' or 'elementIds'");
		}
		// Input first (400), then the project (409), then the editor.
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		const result = await accessor.mutateTrack(
			{ action: "color-clips", trackId, elementIds, colorLabel },
			getRequestCorrelationId({ req })
		);
		if (!result.success)
			throw new HttpError(400, result.error || "Colouring clips failed");
		scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
		return {
			updatedCount: result.updatedCount ?? 0,
			skipped: result.skipped ?? [],
		};
	});

	router.get("/api/claude/timeline/:projectId/selection", async (req) => {
		const elements = await Promise.race([
			accessor.requestSelection(getRequestCorrelationId({ req })),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new HttpError(504, "Renderer timed out")), 5000)
			),
		]);
		return { elements };
	});

	router.delete("/api/claude/timeline/:projectId/selection", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		const win = accessor.getWindow();
		win.webContents.send("claude:timeline:clearSelection");
		return { cleared: true };
	});

	router.post("/api/claude/timeline/:projectId/playback", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		const win = accessor.getWindow();
		const { action, time } = req.body as {
			action: "play" | "pause" | "toggle" | "seek";
			time?: number;
		};
		if (!action) throw new HttpError(400, "Missing action in request body");
		if (action === "seek" && (time === undefined || Number.isNaN(time))) {
			throw new HttpError(400, "Missing or invalid time for seek action");
		}
		win.webContents.send("claude:timeline:playback", { action, time });
		return { action, time, applied: true };
	});

	registerTransactionRoutes({ router, accessor });
	registerAudioMixRoutes({
		assertProjectOpen: (projectId) =>
			assertProjectIsOpen({ accessor, projectId }),
		router,
		mutateAudioMix: accessor.mutateAudioMix?.bind(accessor),
		measureNativeLoudness: async ({ projectId }) => {
			const timeline = await accessor.requestTimeline();
			if (timeline.projectId && timeline.projectId !== projectId) {
				throw new Error(
					`Project ${projectId} is not open in the editor (active project: ${timeline.projectId})`
				);
			}
			const mediaFiles = await listMediaFilesWithRendererFallback({
				projectId,
				accessor,
			});
			return measureNativeExportLoudness({ projectId, timeline, mediaFiles });
		},
		onChanged: scheduleProjectJsonAutoSync,
	});

	// ==========================================================================
	// Project routes
	// ==========================================================================
	router.get("/api/claude/project/:projectId/settings", async (req) =>
		getProjectSettings(req.params.projectId)
	);

	router.patch("/api/claude/project/:projectId/settings", async (req) => {
		if (!req.body) throw new HttpError(400, "Missing settings in request body");
		await updateProjectSettings(req.params.projectId, req.body, {
			broadcast: false,
		});
		const normalizedSettings = await getProjectSettings(req.params.projectId);
		try {
			const win = accessor.getWindow();
			win.webContents.send(
				"claude:project:updated",
				req.params.projectId,
				normalizedSettings
			);
		} catch {
			// Non-fatal: direct file sync below still updates project.json
		}
		scheduleProjectJsonAutoSync({ projectId: req.params.projectId });
		return { updated: true };
	});

	router.get("/api/claude/project/:projectId/stats", async (req) => {
		try {
			return await accessor.getProjectStats(req.params.projectId);
		} catch {
			return getEmptyStats();
		}
	});

	router.get("/api/claude/project/:projectId/summary", async (req) => {
		try {
			const timeline = await Promise.race([
				accessor.requestTimeline(),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new HttpError(504, "Renderer timed out")),
						5000
					)
				),
			]);
			const [mediaFiles, settings] = await Promise.all([
				listMediaFiles(req.params.projectId),
				getProjectSettings(req.params.projectId),
			]);
			const exportJobs = listExportJobs(req.params.projectId);
			return generateProjectSummary({
				timeline,
				mediaFiles,
				exportJobs,
				settings,
			});
		} catch (error) {
			if (error instanceof HttpError) throw error;
			const msg =
				error instanceof Error ? error.message : "Failed to generate summary";
			throw new HttpError(
				msg.includes("Failed to read project") ? 400 : 500,
				msg
			);
		}
	});

	router.post("/api/claude/project/:projectId/report", async (req) => {
		try {
			const timeline = await Promise.race([
				accessor.requestTimeline(),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new HttpError(504, "Renderer timed out")),
						5000
					)
				),
			]);
			const [mediaFiles, settings] = await Promise.all([
				listMediaFiles(req.params.projectId),
				getProjectSettings(req.params.projectId),
			]);
			const exportJobs = listExportJobs(req.params.projectId);
			const summary = generateProjectSummary({
				timeline,
				mediaFiles,
				exportJobs,
				settings,
			});
			const steps = getOperationLog({ projectId: req.params.projectId });
			let outputDir: string | undefined;
			if (typeof req.body?.outputDir === "string") {
				outputDir = req.body.outputDir;
			} else if (typeof req.body?.outputPath === "string") {
				outputDir = path.dirname(req.body.outputPath);
			}
			if (outputDir && !isValidSourcePath(outputDir))
				throw new HttpError(400, "Invalid output directory path");
			const saveToDisk =
				req.body?.saveToDisk === true || outputDir !== undefined;
			const report = await generatePipelineReport({
				steps,
				summary,
				saveToDisk,
				outputDir,
				projectId: req.params.projectId,
			});
			if (req.body?.clearLog === true)
				clearOperationLog({ projectId: req.params.projectId });
			return report;
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Failed to generate report"
			);
		}
	});

	// ==========================================================================
	// Export routes
	// ==========================================================================
	router.get("/api/claude/export/presets", async () => getExportPresets());

	router.get("/api/claude/export/:projectId/recommend/:target", async (req) =>
		getExportRecommendation({ target: req.params.target })
	);

	router.post("/api/claude/export/:projectId/start", async (req) => {
		try {
			const timeline = await Promise.race([
				accessor.requestTimeline(),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new HttpError(504, "Renderer timed out")),
						5000
					)
				),
			]);
			// The renderer can only snapshot the currently open project. Refuse a
			// mismatched target instead of silently exporting the wrong timeline.
			if (!timeline.projectId) {
				throw new HttpError(
					409,
					"The open editor timeline did not identify its project. Reopen the " +
						"target project, then retry the export."
				);
			}
			if (timeline.projectId !== req.params.projectId) {
				throw new HttpError(
					409,
					`Project ${req.params.projectId} is not open in the editor ` +
						`(active project: ${timeline.projectId}). Open it first with ` +
						"editor:navigator:open, then retry the export."
				);
			}
			const mediaFiles = await listMediaFilesWithRendererFallback({
				projectId: req.params.projectId,
				accessor,
			});
			// Each reason is named so a refused override can say what in the
			// timeline made this a renderer export, not just that it is one.
			const rendererExportReasons = [
				...((req.body as { engine?: string } | undefined)?.engine === "muxer"
					? ["--engine muxer was asked for"]
					: []),
				...(hasStickerRuntimeForExport({
					mediaItems: mediaFiles,
					tracks: timeline.tracks,
				})
					? ["Sticker Lab runtime stickers"]
					: []),
				...(findRestrictedMediaForExport({
					mediaItems: mediaFiles,
					scope: "timeline",
					tracks: timeline.tracks,
				}).length > 0
					? ["restricted media only the live renderer may read"]
					: []),
				...(timelineRequiresRendererPortraitExport({ timeline })
					? ["portrait adjustments"]
					: []),
				...(timelineRequiresRendererFilterStackExport({ timeline })
					? ["clips with a filterStack"]
					: []),
				...(timelineRequiresRendererShaderTransitionExport({ timeline })
					? ["shader transitions"]
					: []),
				...(timelineRequiresRendererAdjustmentLayerExport({ timeline })
					? ["masked or multi-pass adjustment layers"]
					: []),
			];
			if (rendererExportReasons.length > 0) {
				if (!accessor.requestLocalVideoExport) {
					throw new HttpError(
						503,
						`The live QCut renderer is unavailable, and this export needs it (${rendererExportReasons.join("; ")}).`
					);
				}
				return await startRendererExportJob({
					dispatch: accessor.requestLocalVideoExport,
					mediaFiles,
					projectId: req.params.projectId,
					request: req.body || {},
					timeline,
					reasons: rendererExportReasons,
				});
			}
			return await startExportJob({
				projectId: req.params.projectId,
				request: req.body || {},
				timeline,
				mediaFiles,
			});
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Failed to start export"
			);
		}
	});

	router.get("/api/claude/export/:projectId/jobs/:jobId", async (req) => {
		const job = getExportJobStatus(req.params.jobId);
		if (!job || job.projectId !== req.params.projectId)
			throw new HttpError(404, `Job not found: ${req.params.jobId}`);
		return job;
	});

	router.get("/api/claude/export/:projectId/jobs", async (req) =>
		listExportJobs(req.params.projectId)
	);

	router.post(
		"/api/claude/export/:projectId/jobs/:jobId/cancel",
		async (req) => {
			const existing = getExportJobStatus(req.params.jobId);
			if (!existing || existing.projectId !== req.params.projectId) {
				throw new HttpError(404, `Job not found: ${req.params.jobId}`);
			}
			const outcome = cancelExportJob({ jobId: req.params.jobId });
			if (!outcome.ok) {
				if (outcome.reason === "finished") {
					throw new HttpError(
						409,
						`Export ${req.params.jobId} already ${existing.status}; nothing to cancel`
					);
				}
				if (outcome.reason === "renderer") {
					throw new HttpError(
						409,
						`Export ${req.params.jobId} runs in the editor window and cannot be cancelled from here`
					);
				}
				throw new HttpError(404, `Job not found: ${req.params.jobId}`);
			}
			return getExportJobStatus(req.params.jobId);
		}
	);

	// ==========================================================================
	// Diagnostics
	// ==========================================================================
	router.post("/api/claude/diagnostics/analyze", async (req) => {
		if (!req.body?.message)
			throw new HttpError(400, "Missing 'message' in error report");
		const systemInfo = getSystemInfo(accessor.getAppVersion());
		return analyzeError(req.body, systemInfo);
	});

	// ==========================================================================
	// Analysis routes
	// ==========================================================================
	registerAnalysisRoutes(router, accessor);

	// ==========================================================================
	// Search routes
	// ==========================================================================
	registerSearchRoutes(router);

	// ==========================================================================
	// PersonaPlex
	// ==========================================================================
	router.post("/api/claude/personaplex/generate", async (req) =>
		generatePersonaPlex(req.body)
	);

	// ==========================================================================
	// MCP app preview forwarding
	// ==========================================================================
	router.post("/api/claude/mcp/app", async (req) => {
		if (!req.body || typeof req.body.html !== "string" || !req.body.html.trim())
			throw new HttpError(400, "Missing 'html' in request body");
		const toolName =
			typeof req.body.toolName === "string" ? req.body.toolName : "unknown";
		try {
			const win = accessor.getWindow();
			win.webContents.send("mcp:app-html", { html: req.body.html, toolName });
			return { forwarded: true };
		} catch (err) {
			return {
				forwarded: false,
				error: err instanceof Error ? err.message : "Unknown error",
			};
		}
	});

	// ── Moyin (Director) ───────────────────────────────────────────────
	router.post("/api/claude/moyin/parse-result", async (req) => {
		if (!req.body?.scriptData)
			throw new HttpError(400, "Missing 'scriptData' in request body");
		const win = accessor.getWindow();
		win.webContents.send("claude:moyin:parsed", req.body.scriptData);
		return { imported: true };
	});

	// ── Novel Parse ───────────────────────────────────────────────────
	router.post("/api/claude/novel/parse", async (req) => {
		if (
			!req.body?.text ||
			typeof req.body.text !== "string" ||
			!req.body.text.trim()
		)
			throw new HttpError(400, "Missing or empty 'text' in request body");

		const { handleNovelParse } = await import(
			"../../moyin/novel-parse-handler.js"
		);
		const { RESPONSE_HANDLED } = await import("../utils/http-router.js");

		// Streaming mode: write ndjson lines with progress, then result
		if (req.body.stream === true) {
			const res = req.rawRes;
			res.writeHead(200, {
				"Content-Type": "application/x-ndjson",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});
			if (typeof res.flushHeaders === "function") res.flushHeaders();

			try {
				const result = await handleNovelParse(
					{
						text: req.body.text,
						language: req.body.language,
						maxClips: req.body.maxClips,
					},
					(progress) => {
						try {
							res.write(
								JSON.stringify({ type: "progress", ...progress }) + "\n"
							);
						} catch {}
					}
				);
				res.write(JSON.stringify({ type: "result", ...result }) + "\n");
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				res.write(JSON.stringify({ type: "error", error: msg }) + "\n");
			}
			res.end();
			return RESPONSE_HANDLED;
		}

		return handleNovelParse({
			text: req.body.text,
			language: req.body.language,
			maxClips: req.body.maxClips,
		});
	});
}
