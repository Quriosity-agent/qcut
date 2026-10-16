/**
 * Claude HTTP Analysis & Editing Routes
 * Registers video analysis, transcription, scene detection, filler analysis,
 * and Stage 3 cut/edit routes on the HTTP router.
 */

import type { Router } from "../utils/http-router.js";
import { HttpError } from "../utils/http-router.js";
import {
	analyzeVideo,
	listAnalyzeModels,
} from "../handlers/claude-analyze-handler.js";
import {
	transcribeMedia,
	startTranscribeJob,
	getTranscribeJobStatus,
	listTranscribeJobs,
	cancelTranscribeJob,
} from "../handlers/claude-transcribe-handler.js";
import {
	detectScenes,
	INVALID_SCENE_ENGINE_MESSAGE,
	inspectSceneEngines,
} from "../handlers/claude-scene-handler.js";
import { analyzeFrames } from "../handlers/claude-vision-handler.js";
import { analyzeFillers } from "../handlers/claude-filler-handler.js";
import { analyzeBeats } from "../handlers/claude-beats-handler.js";
import { executeBatchCuts } from "../handlers/claude-cuts-handler.js";
import { executeDeleteRange } from "../handlers/claude-range-handler.js";
import {
	autoEdit,
	startAutoEditJob,
	getAutoEditJobStatus,
	listAutoEditJobs,
	cancelAutoEditJob,
} from "../handlers/claude-auto-edit-handler.js";
import {
	suggestCuts,
	startSuggestJob,
	getSuggestJobStatus,
	listSuggestJobs,
	cancelSuggestJob,
} from "../handlers/claude-suggest-handler.js";
import { claudeLog } from "../utils/logger.js";
import { logOperation } from "../claude-operation-log.js";
import { getMediaInfo } from "../handlers/claude-media-handler.js";
import { saveTranscription } from "./claude-http-search-routes.js";
import { getRequestCorrelationId } from "./claude-http-meta-routes.js";
import type { BrowserWindow } from "electron";
import type {
	WindowAccessor,
	WindowProxy,
} from "./claude-http-shared-routes.js";
import { assertProjectIsOpen } from "./claude-http-project-scope.js";
import { SCENE_DETECTION_ENGINE_CHOICES } from "../../types/claude-api.js";
import type {
	AutoEditRequest,
	AutoEditJob,
	BatchCutRequest,
	BatchCutResponse,
	ClaudeRangeDeleteRequest,
	ClaudeRangeDeleteResponse,
	ClaudeBeatDetectionResult,
	ClaudeBeatsMarkRequest,
	ClaudeBeatsMarkResponse,
	ClaudeSnapToBeatsRequest,
	ClaudeSnapToBeatsResponse,
} from "../../types/claude-api.js";

const HANDLER_NAME = "AnalysisRoutes";

/** Handle debug route log. */
function debugRouteLog({ message }: { message: string }): void {
	try {
		claudeLog.debug(HANDLER_NAME, message);
	} catch {
		// Ignore logging failures to keep route behavior stable.
	}
}

// ---------------------------------------------------------------------------
// Helpers for word normalization (used by load-speech + transcribe-and-load)
// ---------------------------------------------------------------------------

interface RawWord {
	text: string;
	start: number;
	end: number;
	type?: string;
	speaker_id?: string | null;
	speaker?: string;
}

/** Build text from words. */
function buildTextFromWords(words: RawWord[]): string {
	return words
		.filter((w) => (w.type ?? "word") === "word" || w.type === "spacing")
		.map((w) => w.text)
		.join("");
}

/** Normalize words. */
function normalizeWords(words: RawWord[]): Array<{
	text: string;
	start: number;
	end: number;
	type: string;
	speaker_id: string | null;
}> {
	return words.map((w) => ({
		text: w.text,
		start: w.start,
		end: w.end,
		type: w.type ?? "word",
		speaker_id: w.speaker_id ?? w.speaker ?? null,
	}));
}

interface AnalysisRoutesAccessor {
	getWindow: () => WindowProxy;
	/** Lets routes that edit the open project refuse another project's id. */
	requestStateSnapshot?: WindowAccessor["requestStateSnapshot"];
	executeBatchCuts?: (request: BatchCutRequest) => Promise<BatchCutResponse>;
	executeDeleteRange?: (
		request: ClaudeRangeDeleteRequest
	) => Promise<ClaudeRangeDeleteResponse>;
	startAutoEditJob?: (
		projectId: string,
		request: AutoEditRequest
	) => Promise<{ jobId: string }>;
	getAutoEditJobStatus?: (jobId: string) => Promise<AutoEditJob | null>;
	listAutoEditJobs?: () => Promise<AutoEditJob[]>;
	cancelAutoEditJob?: (jobId: string) => Promise<boolean>;
	/** Store a clip's beats in the editor's beat store (and bookmark them). */
	requestBeatsMark?: (
		request: ClaudeBeatsMarkRequest,
		correlationId?: string
	) => Promise<ClaudeBeatsMarkResponse>;
	/** Move clips onto marked beats through the editor's own move. */
	requestSnapToBeats?: (
		request: ClaudeSnapToBeatsRequest,
		correlationId?: string
	) => Promise<ClaudeSnapToBeatsResponse>;
}

const BOOKMARK_CHOICES = ["none", "downbeats", "all"] as const;

/** The detection result a `beats mark` body carries, checked field by field. */
function readBeatDetectionResult(value: unknown): ClaudeBeatDetectionResult {
	if (typeof value !== "object" || value === null) {
		throw new HttpError(400, "result must be a beat detection result object");
	}
	const result = value as Record<string, unknown>;
	const number = (key: string): number => {
		const candidate = result[key];
		if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
			throw new HttpError(400, `result.${key} must be a number`);
		}
		return candidate;
	};
	if (!Array.isArray(result.beats)) {
		throw new HttpError(400, "result.beats must be a list");
	}
	const beats = result.beats.map((beat, index) => {
		if (typeof beat !== "object" || beat === null) {
			throw new HttpError(400, `result.beats[${index}] must be an object`);
		}
		const entry = beat as Record<string, unknown>;
		if (
			typeof entry.timestamp !== "number" ||
			!Number.isFinite(entry.timestamp) ||
			entry.timestamp < 0
		) {
			throw new HttpError(
				400,
				`result.beats[${index}].timestamp must be seconds, 0 or more`
			);
		}
		return {
			timestamp: entry.timestamp,
			strength:
				typeof entry.strength === "number" && Number.isFinite(entry.strength)
					? entry.strength
					: 1,
			index,
			isDownbeat: entry.isDownbeat === true,
		};
	});
	return {
		bpm: number("bpm"),
		confidence: number("confidence"),
		duration: number("duration"),
		beats,
		downbeats: beats
			.filter((beat) => beat.isDownbeat)
			.map((beat) => beat.timestamp),
	};
}

function readElementIds(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.some((id) => typeof id !== "string" || !id.trim())
	) {
		throw new HttpError(400, "elementIds must be a non-empty list of ids");
	}
	return value.map((id: string) => id.trim());
}

/**
 * Register analysis, transcription, and Stage 3 editing routes on the router.
 */
export function registerAnalysisRoutes(
	router: Router,
	accessor: AnalysisRoutesAccessor
): void {
	/** Resolves an auto-edit job through the accessor when available. */
	const getAutoEditJobForRequest = async ({
		jobId,
	}: {
		jobId: string;
	}): Promise<AutoEditJob | null> => {
		if (accessor.getAutoEditJobStatus) {
			return await accessor.getAutoEditJobStatus(jobId);
		}
		return getAutoEditJobStatus(jobId);
	};

	// ==========================================================================
	// Video Analysis routes
	// ==========================================================================
	router.post("/api/claude/analyze/:projectId", async (req) => {
		if (!req.body?.source) {
			throw new HttpError(400, "Missing 'source' in request body");
		}
		try {
			const result = await analyzeVideo(req.params.projectId, {
				source: req.body.source,
				analysisType: req.body.analysisType,
				model: req.body.model,
				format: req.body.format,
			});
			if (!result.success) {
				throw new HttpError(500, result.error);
			}
			return result;
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Analysis failed"
			);
		}
	});

	router.get("/api/claude/analyze/models", async () => {
		return listAnalyzeModels();
	});

	// ==========================================================================
	// Transcription routes (Stage 2)
	// ==========================================================================
	router.post("/api/claude/transcribe/:projectId", async (req) => {
		if (!req.body?.mediaId && !req.body?.source) {
			throw new HttpError(400, "Missing 'mediaId' or 'source' in request body");
		}
		try {
			const result = await transcribeMedia(req.params.projectId, {
				mediaId: req.body.mediaId,
				source: req.body.source,
				provider: req.body.provider,
				language: req.body.language,
				diarize: req.body.diarize,
			});
			const sourceDesc =
				req.body.source?.filePath || req.body.mediaId || "unknown";
			logOperation({
				stage: 2,
				action: "transcribe",
				details: `Transcribed media ${sourceDesc}`,
				timestamp: Date.now(),
				projectId: req.params.projectId,
				metadata: {
					mediaId: req.body.mediaId,
					source: req.body.source,
					provider: req.body.provider,
				},
			});

			// Auto-persist transcription for search
			const mediaId = req.body.mediaId ?? req.body.source?.mediaId;
			if (mediaId) {
				try {
					const mediaInfo = await getMediaInfo(req.params.projectId, mediaId);
					saveTranscription(req.params.projectId, {
						version: 1,
						mediaId,
						mediaName: mediaInfo?.name ?? mediaId,
						language: result.language ?? "en",
						duration: result.duration ?? 0,
						provider: req.body.provider ?? "elevenlabs",
						createdAt: Date.now(),
						text: result.segments
							.map((s: { text: string }) => s.text)
							.join(" "),
						words: result.words ?? [],
						segments: result.segments ?? [],
					});
				} catch (err) {
					claudeLog.warn(
						"AnalysisRoutes",
						`Failed to auto-persist transcription: ${err}`
					);
				}
			}

			return result;
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Transcription failed"
			);
		}
	});

	// Async transcription routes (preferred — avoids 30s HTTP timeout)
	router.post("/api/claude/transcribe/:projectId/start", async (req) => {
		if (!req.body?.mediaId && !req.body?.source) {
			throw new HttpError(400, "Missing 'mediaId' or 'source' in request body");
		}
		const { jobId } = startTranscribeJob(req.params.projectId, {
			mediaId: req.body.mediaId,
			source: req.body.source,
			provider: req.body.provider,
			language: req.body.language,
			diarize: req.body.diarize,
		});
		return { jobId };
	});

	router.get("/api/claude/transcribe/:projectId/jobs/:jobId", async (req) => {
		const job = getTranscribeJobStatus(req.params.jobId);
		if (!job) {
			throw new HttpError(404, `Job not found: ${req.params.jobId}`);
		}
		return job;
	});

	router.get("/api/claude/transcribe/:projectId/jobs", async (req) => {
		const allJobs = listTranscribeJobs();
		return allJobs.filter((job) => job.projectId === req.params.projectId);
	});

	router.post(
		"/api/claude/transcribe/:projectId/jobs/:jobId/cancel",
		async (req) => {
			const cancelled = cancelTranscribeJob(req.params.jobId);
			return { cancelled };
		}
	);

	// ==========================================================================
	// Smart Speech (load transcription into Word Timeline panel)
	// ==========================================================================

	// Load pre-existing transcription data into the Smart Speech panel
	router.post("/api/claude/transcribe/:projectId/load-speech", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		if (!req.body?.words || !Array.isArray(req.body.words)) {
			throw new HttpError(400, "Missing 'words' array in request body");
		}
		if (req.body.words.length === 0) {
			throw new HttpError(400, "Empty 'words' array in request body");
		}
		try {
			const win = accessor.getWindow();
			const words: RawWord[] = req.body.words;
			win.webContents.send("claude:speech:load", {
				text: req.body.text ?? buildTextFromWords(words),
				language_code: req.body.language_code ?? req.body.language ?? "unknown",
				language_probability: req.body.language_probability ?? 0,
				words: normalizeWords(words),
				fileName:
					req.body.fileName ?? `transcription_${req.params.projectId}.json`,
			});

			// Add media to timeline if mediaId provided
			if (req.body.mediaId) {
				const media = await getMediaInfo(
					req.params.projectId,
					req.body.mediaId
				);
				if (media) {
					const elementId = `element_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
					win.webContents.send("claude:timeline:addElement", {
						id: elementId,
						type: "media",
						mediaId: req.body.mediaId,
						startTime: 0,
						duration: media.duration ?? 0,
						sourceName: media.name,
					});
				}
			}

			return { loaded: true };
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Load speech failed"
			);
		}
	});

	// Transcribe media and load result directly into Smart Speech panel
	router.post(
		"/api/claude/transcribe/:projectId/transcribe-and-load",
		async (req) => {
			await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
			if (!req.body?.mediaId && !req.body?.source) {
				throw new HttpError(
					400,
					"Missing 'mediaId' or 'source' in request body"
				);
			}
			try {
				const result = await transcribeMedia(req.params.projectId, {
					mediaId: req.body.mediaId,
					source: req.body.source,
					provider: req.body.provider,
					language: req.body.language,
					diarize: req.body.diarize,
				});
				if (
					!result?.words ||
					!Array.isArray(result.words) ||
					result.words.length === 0
				) {
					throw new HttpError(500, "Transcription produced no words");
				}
				const sourceDesc =
					req.body.source?.filePath || req.body.mediaId || "unknown";
				const win = accessor.getWindow();
				win.webContents.send("claude:speech:load", {
					text: buildTextFromWords(result.words),
					language_code: result.language ?? "unknown",
					language_probability: 0,
					words: normalizeWords(result.words),
					fileName: `transcription_${sourceDesc.replace(/[/\\]/g, "_")}.json`,
				});
				// Add media to timeline (only when using mediaId, not path source)
				if (req.body.mediaId) {
					const media = await getMediaInfo(
						req.params.projectId,
						req.body.mediaId
					);
					if (media) {
						const elementId = `element_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
						win.webContents.send("claude:timeline:addElement", {
							id: elementId,
							type: "media",
							mediaId: req.body.mediaId,
							startTime: 0,
							duration: media.duration ?? result.duration ?? 0,
							sourceName: media.name,
						});
					}
				}

				// Auto-persist transcription for search
				const persistMediaId = req.body.mediaId ?? req.body.source?.mediaId;
				if (persistMediaId) {
					try {
						const mediaInfo = await getMediaInfo(
							req.params.projectId,
							persistMediaId
						);
						saveTranscription(req.params.projectId, {
							version: 1,
							mediaId: persistMediaId,
							mediaName: mediaInfo?.name ?? persistMediaId,
							language: result.language ?? "en",
							duration: result.duration ?? 0,
							provider: req.body.provider ?? "elevenlabs",
							createdAt: Date.now(),
							text:
								result.segments
									?.map((s: { text: string }) => s.text)
									.join(" ") ?? "",
							words: result.words ?? [],
							segments: result.segments ?? [],
						});
					} catch (err) {
						claudeLog.warn(
							"AnalysisRoutes",
							`Failed to auto-persist transcription (transcribe-and-load): ${err}`
						);
					}
				}

				logOperation({
					stage: 2,
					action: "transcribe-and-load",
					details: `Transcribed and loaded to Smart Speech: ${sourceDesc}`,
					timestamp: Date.now(),
					projectId: req.params.projectId,
					metadata: {
						mediaId: req.body.mediaId,
						source: req.body.source,
					},
				});
				return {
					loaded: true,
					wordCount: result.words.filter((w) => (w.type ?? "word") === "word")
						.length,
					duration: result.duration,
				};
			} catch (error) {
				if (error instanceof HttpError) throw error;
				throw new HttpError(
					500,
					error instanceof Error ? error.message : "Transcribe and load failed"
				);
			}
		}
	);

	// ==========================================================================
	// Scene Detection routes (Stage 2)
	// ==========================================================================
	/** Which scene engines can run here, and the one `auto` would pick. */
	router.get("/api/claude/analyze/engines", async () => inspectSceneEngines());

	router.post("/api/claude/analyze/:projectId/scenes", async (req) => {
		if (!req.body?.mediaId) {
			throw new HttpError(400, "Missing 'mediaId' in request body");
		}
		if (
			req.body.engine !== undefined &&
			!SCENE_DETECTION_ENGINE_CHOICES.some(
				(engine) => engine === req.body.engine
			)
		) {
			throw new HttpError(400, INVALID_SCENE_ENGINE_MESSAGE);
		}
		if (
			req.body.aiAnalysis !== undefined &&
			typeof req.body.aiAnalysis !== "boolean"
		) {
			throw new HttpError(400, "aiAnalysis must be a boolean");
		}
		if (
			req.body.threshold !== undefined &&
			req.body.engine !== undefined &&
			req.body.engine !== "ffmpeg" &&
			req.body.engine !== "auto"
		) {
			throw new HttpError(
				400,
				"threshold is only supported by the FFmpeg scene engine"
			);
		}
		try {
			const result = await detectScenes(req.params.projectId, {
				mediaId: req.body.mediaId,
				engine: req.body.engine,
				threshold: req.body.threshold,
				aiAnalysis: req.body.aiAnalysis,
				model: req.body.model,
			});
			logOperation({
				stage: 2,
				action: "analyze-scenes",
				details: `Detected scenes for media ${req.body.mediaId}`,
				timestamp: Date.now(),
				projectId: req.params.projectId,
				metadata: {
					mediaId: req.body.mediaId,
					model: req.body.model,
					engine: result.engine,
					route: result.route,
				},
			});
			return result;
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Scene detection failed"
			);
		}
	});

	// ==========================================================================
	// Frame Analysis routes (Stage 2)
	// ==========================================================================
	router.post("/api/claude/analyze/:projectId/frames", async (req) => {
		if (!req.body?.mediaId) {
			throw new HttpError(400, "Missing 'mediaId' in request body");
		}
		try {
			return await analyzeFrames(req.params.projectId, {
				mediaId: req.body.mediaId,
				timestamps: req.body.timestamps,
				interval: req.body.interval,
				prompt: req.body.prompt,
			});
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Frame analysis failed"
			);
		}
	});

	// ==========================================================================
	// Filler Detection routes (Stage 2)
	// ==========================================================================
	router.post("/api/claude/analyze/:projectId/fillers", async (req) => {
		const projectId = req.params.projectId;
		try {
			let words = req.body?.words;

			// Mode 1: words provided directly
			// Mode 2: auto-transcribe from mediaId
			if (!Array.isArray(words)) {
				if (!req.body?.mediaId) {
					throw new HttpError(
						400,
						"Provide 'words' array or 'mediaId' for auto-transcription"
					);
				}
				const transcription = await transcribeMedia(projectId, {
					mediaId: req.body.mediaId,
					provider: req.body.provider,
					language: req.body.language,
				});
				words = transcription?.words;
				if (!Array.isArray(words) || words.length === 0) {
					throw new HttpError(
						400,
						"Transcription produced no words for filler analysis"
					);
				}
			}

			const result = await analyzeFillers(projectId, {
				mediaId: req.body.mediaId,
				words,
			});
			logOperation({
				stage: 2,
				action: "analyze-fillers",
				details: `Analyzed filler words for media ${req.body.mediaId ?? "unknown"}`,
				timestamp: Date.now(),
				projectId,
			});
			return result;
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Filler analysis failed"
			);
		}
	});

	// ==========================================================================
	// Beats on the timeline: mark a clip's beats in the editor, snap clips to them
	// ==========================================================================
	router.post("/api/claude/timeline/:projectId/beats/mark", async (req) => {
		const elementId =
			typeof req.body?.elementId === "string" ? req.body.elementId.trim() : "";
		if (!elementId) {
			throw new HttpError(400, "Missing 'elementId' in request body");
		}
		const result = readBeatDetectionResult(req.body?.result);
		const bookmarks = req.body?.bookmarks ?? "none";
		if (!BOOKMARK_CHOICES.some((choice) => choice === bookmarks)) {
			throw new HttpError(
				400,
				`bookmarks must be one of ${BOOKMARK_CHOICES.join(", ")}`
			);
		}
		if (!accessor.requestBeatsMark) {
			throw new HttpError(503, "Beat marking is not available in this editor");
		}
		// Input first (400), then the project (409), then the editor.
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		return accessor.requestBeatsMark(
			{
				projectId: req.params.projectId,
				elementId,
				result,
				bookmarks: bookmarks as ClaudeBeatsMarkRequest["bookmarks"],
			},
			getRequestCorrelationId({ req })
		);
	});

	router.post("/api/claude/timeline/:projectId/snap-to-beats", async (req) => {
		const elementIds = readElementIds(req.body?.elementIds);
		const edge = req.body?.edge ?? "start";
		if (edge !== "start" && edge !== "end") {
			throw new HttpError(400, "edge must be start or end");
		}
		const maxDistance = req.body?.maxDistance;
		if (
			maxDistance !== undefined &&
			(typeof maxDistance !== "number" ||
				!Number.isFinite(maxDistance) ||
				maxDistance <= 0)
		) {
			throw new HttpError(
				400,
				"maxDistance must be a positive number of seconds"
			);
		}
		if (!accessor.requestSnapToBeats) {
			throw new HttpError(
				503,
				"Snapping to beats is not available in this editor"
			);
		}
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		return accessor.requestSnapToBeats(
			{
				projectId: req.params.projectId,
				elementIds,
				...(typeof req.body?.beatsElementId === "string"
					? { beatsElementId: req.body.beatsElementId.trim() }
					: {}),
				edge,
				...(maxDistance !== undefined ? { maxDistance } : {}),
				downbeatsOnly: req.body?.downbeatsOnly === true,
				dryRun: req.body?.dryRun === true,
			},
			getRequestCorrelationId({ req })
		);
	});

	// ==========================================================================
	// Beat Detection routes (Stage 2)
	// ==========================================================================
	router.post("/api/claude/analyze/:projectId/beats", async (req) => {
		if (!req.body?.mediaId) {
			throw new HttpError(400, "Missing 'mediaId' in request body");
		}
		try {
			const result = await analyzeBeats(req.params.projectId, {
				mediaId: req.body.mediaId,
				threshold: req.body.threshold,
			});
			logOperation({
				stage: 2,
				action: "analyze-beats",
				details: `Detected ${result.beats.length} beats at ${result.bpm.toFixed(1)} BPM for media ${req.body.mediaId}`,
				timestamp: Date.now(),
				projectId: req.params.projectId,
			});
			return result;
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Beat detection failed"
			);
		}
	});

	// ==========================================================================
	// Batch Cut-List routes (Stage 3)
	// ==========================================================================
	router.post("/api/claude/timeline/:projectId/cuts", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		if (!req.body?.elementId || !Array.isArray(req.body?.cuts)) {
			throw new HttpError(
				400,
				"Missing 'elementId' and 'cuts' array in request body"
			);
		}
		const batchCutRequest: BatchCutRequest = {
			elementId: req.body.elementId,
			cuts: req.body.cuts,
			ripple: req.body.ripple,
		};
		const batchCutPromise = accessor.executeBatchCuts
			? accessor.executeBatchCuts(batchCutRequest)
			: executeBatchCuts(
					accessor.getWindow() as BrowserWindow,
					batchCutRequest
				);
		debugRouteLog({
			message: `/timeline/${req.params.projectId}/cuts using ${accessor.executeBatchCuts ? "accessor.executeBatchCuts" : "local.executeBatchCuts"}`,
		});
		return Promise.race([
			batchCutPromise,
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new HttpError(504, "Renderer timed out")),
					30_000
				)
			),
		]);
	});

	// ==========================================================================
	// Range Delete routes (Stage 3)
	// ==========================================================================
	router.delete("/api/claude/timeline/:projectId/range", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		if (
			typeof req.body?.startTime !== "number" ||
			typeof req.body?.endTime !== "number"
		) {
			throw new HttpError(
				400,
				"Missing 'startTime' and 'endTime' in request body"
			);
		}
		const deleteRangeRequest: ClaudeRangeDeleteRequest = {
			startTime: req.body.startTime,
			endTime: req.body.endTime,
			trackIds: req.body.trackIds,
			ripple: req.body.ripple,
			crossTrackRipple: req.body.crossTrackRipple,
			keepAutomation: req.body.keepAutomation,
		};
		const deleteRangePromise = accessor.executeDeleteRange
			? accessor.executeDeleteRange(deleteRangeRequest)
			: executeDeleteRange(
					accessor.getWindow() as BrowserWindow,
					deleteRangeRequest
				);
		debugRouteLog({
			message: `/timeline/${req.params.projectId}/range using ${accessor.executeDeleteRange ? "accessor.executeDeleteRange" : "local.executeDeleteRange"}`,
		});
		return Promise.race([
			deleteRangePromise,
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new HttpError(504, "Renderer timed out")),
					30_000
				)
			),
		]);
	});

	// ==========================================================================
	// Auto-Edit routes (Stage 3)
	// ==========================================================================
	router.post("/api/claude/timeline/:projectId/auto-edit", async (req) => {
		await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
		if (!req.body?.elementId && !req.body?.mediaId) {
			throw new HttpError(
				400,
				"Missing 'elementId' and 'mediaId' in request body"
			);
		}
		if (!req.body?.elementId) {
			throw new HttpError(400, "Missing 'elementId' in request body");
		}
		if (!req.body?.mediaId) {
			throw new HttpError(400, "Missing 'mediaId' in request body");
		}
		const win = accessor.getWindow();
		try {
			const correlationId = getRequestCorrelationId({ req });
			return await autoEdit(
				req.params.projectId,
				{
					elementId: req.body.elementId,
					mediaId: req.body.mediaId,
					correlationId,
					removeFillers: req.body.removeFillers,
					removeSilences: req.body.removeSilences,
					silenceThreshold: req.body.silenceThreshold,
					keepSilencePadding: req.body.keepSilencePadding,
					dryRun: req.body.dryRun,
					provider: req.body.provider,
					language: req.body.language,
				},
				win as BrowserWindow
			);
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Auto-edit failed"
			);
		}
	});

	// ==========================================================================
	// Cut Suggestions routes (Stage 3)
	// ==========================================================================
	router.post("/api/claude/analyze/:projectId/suggest-cuts", async (req) => {
		if (!req.body?.mediaId) {
			throw new HttpError(400, "Missing 'mediaId' in request body");
		}
		try {
			return await suggestCuts(req.params.projectId, {
				mediaId: req.body.mediaId,
				provider: req.body.provider,
				language: req.body.language,
				sceneThreshold: req.body.sceneThreshold,
				includeFillers: req.body.includeFillers,
				includeSilences: req.body.includeSilences,
				includeScenes: req.body.includeScenes,
			});
		} catch (error) {
			if (error instanceof HttpError) throw error;
			throw new HttpError(
				500,
				error instanceof Error ? error.message : "Suggest cuts failed"
			);
		}
	});

	// Async suggest-cuts routes (preferred — avoids HTTP timeout on long videos)
	router.post(
		"/api/claude/analyze/:projectId/suggest-cuts/start",
		async (req) => {
			if (!req.body?.mediaId) {
				throw new HttpError(400, "Missing 'mediaId' in request body");
			}
			const { jobId } = startSuggestJob(req.params.projectId, {
				mediaId: req.body.mediaId,
				provider: req.body.provider,
				language: req.body.language,
				sceneThreshold: req.body.sceneThreshold,
				includeFillers: req.body.includeFillers,
				includeSilences: req.body.includeSilences,
				includeScenes: req.body.includeScenes,
			});
			return { jobId };
		}
	);

	router.get(
		"/api/claude/analyze/:projectId/suggest-cuts/jobs/:jobId",
		async (req) => {
			const job = getSuggestJobStatus(req.params.jobId);
			if (!job || job.projectId !== req.params.projectId) {
				throw new HttpError(404, `Job not found: ${req.params.jobId}`);
			}
			return job;
		}
	);

	router.get(
		"/api/claude/analyze/:projectId/suggest-cuts/jobs",
		async (req) => {
			const allJobs = listSuggestJobs();
			return allJobs.filter((job) => job.projectId === req.params.projectId);
		}
	);

	router.post(
		"/api/claude/analyze/:projectId/suggest-cuts/jobs/:jobId/cancel",
		async (req) => {
			const cancelled = cancelSuggestJob(req.params.jobId);
			return { cancelled };
		}
	);

	// ==========================================================================
	// Async Auto-Edit routes (preferred — avoids HTTP timeout on long videos)
	// ==========================================================================
	router.post(
		"/api/claude/timeline/:projectId/auto-edit/start",
		async (req) => {
			await assertProjectIsOpen({ accessor, projectId: req.params.projectId });
			if (!req.body?.elementId && !req.body?.mediaId) {
				throw new HttpError(
					400,
					"Missing 'elementId' and 'mediaId' in request body"
				);
			}
			if (!req.body?.elementId) {
				throw new HttpError(400, "Missing 'elementId' in request body");
			}
			if (!req.body?.mediaId) {
				throw new HttpError(400, "Missing 'mediaId' in request body");
			}
			const autoEditRequest: AutoEditRequest = {
				elementId: req.body.elementId,
				mediaId: req.body.mediaId,
				correlationId: getRequestCorrelationId({ req }),
				removeFillers: req.body.removeFillers,
				removeSilences: req.body.removeSilences,
				silenceThreshold: req.body.silenceThreshold,
				keepSilencePadding: req.body.keepSilencePadding,
				dryRun: req.body.dryRun,
				provider: req.body.provider,
				language: req.body.language,
			};
			if (accessor.startAutoEditJob) {
				debugRouteLog({
					message: `/timeline/${req.params.projectId}/auto-edit/start using accessor.startAutoEditJob`,
				});
				const { jobId } = await accessor.startAutoEditJob(
					req.params.projectId,
					autoEditRequest
				);
				return { jobId };
			}
			debugRouteLog({
				message: `/timeline/${req.params.projectId}/auto-edit/start using local.startAutoEditJob`,
			});
			const win = accessor.getWindow();
			const { jobId } = startAutoEditJob(
				req.params.projectId,
				autoEditRequest,
				win as BrowserWindow
			);
			return { jobId };
		}
	);

	router.get(
		"/api/claude/timeline/:projectId/auto-edit/jobs/:jobId",
		async (req) => {
			debugRouteLog({
				message: `/timeline/${req.params.projectId}/auto-edit/jobs/${req.params.jobId} using ${accessor.getAutoEditJobStatus ? "accessor.getAutoEditJobStatus" : "local.getAutoEditJobStatus"}`,
			});
			const job = await getAutoEditJobForRequest({
				jobId: req.params.jobId,
			});
			if (!job || job.projectId !== req.params.projectId) {
				throw new HttpError(404, `Job not found: ${req.params.jobId}`);
			}
			return job;
		}
	);

	router.get("/api/claude/timeline/:projectId/auto-edit/jobs", async (req) => {
		debugRouteLog({
			message: `/timeline/${req.params.projectId}/auto-edit/jobs using ${accessor.listAutoEditJobs ? "accessor.listAutoEditJobs" : "local.listAutoEditJobs"}`,
		});
		const allJobs = accessor.listAutoEditJobs
			? await accessor.listAutoEditJobs()
			: listAutoEditJobs();
		return allJobs.filter((job) => job.projectId === req.params.projectId);
	});

	router.post(
		"/api/claude/timeline/:projectId/auto-edit/jobs/:jobId/cancel",
		async (req) => {
			debugRouteLog({
				message: `/timeline/${req.params.projectId}/auto-edit/jobs/${req.params.jobId}/cancel using ${accessor.cancelAutoEditJob ? "accessor.cancelAutoEditJob" : "local.cancelAutoEditJob"}`,
			});
			const job = await getAutoEditJobForRequest({
				jobId: req.params.jobId,
			});
			if (!job || job.projectId !== req.params.projectId) {
				throw new HttpError(404, `Job not found: ${req.params.jobId}`);
			}
			const cancelled = accessor.cancelAutoEditJob
				? await accessor.cancelAutoEditJob(req.params.jobId)
				: cancelAutoEditJob(req.params.jobId);
			return { cancelled };
		}
	);
}

// CommonJS export for compatibility
module.exports = { registerAnalysisRoutes };
