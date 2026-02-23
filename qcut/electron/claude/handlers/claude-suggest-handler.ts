/**
 * Claude Cut Suggestion Handler
 * Combines transcription + scene detection + filler detection
 * to generate intelligent cut point suggestions.
 * Does NOT modify the timeline — just returns ranked suggestions.
 */

import { claudeLog } from "../utils/logger.js";
import { sanitizeProjectId } from "../utils/helpers.js";
import { HttpError } from "../utils/http-router.js";
import { transcribeMedia } from "./claude-transcribe-handler.js";
import { analyzeFillers } from "./claude-filler-handler.js";
import { detectScenes } from "./claude-scene-handler.js";
import type {
	CutSuggestion,
	SuggestCutsJob,
	SuggestCutsRequest,
	SuggestCutsResponse,
	TranscriptionResult,
	FillerAnalysisResult,
	SceneDetectionResult,
} from "../../types/claude-api";

const HANDLER_NAME = "SuggestCuts";

// ============================================================================
// Async Job Tracking
// ============================================================================

const suggestJobs = new Map<string, SuggestCutsJob>();
const MAX_SUGGEST_JOBS = 50;

function pruneOldSuggestJobs(): void {
	if (suggestJobs.size <= MAX_SUGGEST_JOBS) return;
	const entries = [...suggestJobs.entries()].sort(
		(a, b) => a[1].createdAt - b[1].createdAt
	);
	const toRemove = entries.slice(0, entries.length - MAX_SUGGEST_JOBS);
	for (const [id] of toRemove) {
		suggestJobs.delete(id);
	}
}

/**
 * Start a suggest-cuts job. Returns immediately with a job ID.
 * The analysis runs in the background; poll with getSuggestJobStatus().
 */
export function startSuggestJob(
	projectId: string,
	request: SuggestCutsRequest
): { jobId: string } {
	const jobId = `suggest_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

	const job: SuggestCutsJob = {
		jobId,
		projectId,
		mediaId: request.mediaId,
		status: "queued",
		progress: 0,
		message: "Queued",
		createdAt: Date.now(),
	};

	suggestJobs.set(jobId, job);
	pruneOldSuggestJobs();

	claudeLog.info(
		HANDLER_NAME,
		`Job ${jobId} created for project ${projectId}, media ${request.mediaId}`
	);

	// Fire-and-forget — run analysis in background
	runSuggestJob(jobId, projectId, request).catch((err) => {
		claudeLog.error(HANDLER_NAME, `Job ${jobId} unexpected error:`, err);
	});

	return { jobId };
}

/** Get the current status of a suggest-cuts job. */
export function getSuggestJobStatus(jobId: string): SuggestCutsJob | null {
	return suggestJobs.get(jobId) ?? null;
}

/** List all suggest-cuts jobs, sorted newest-first. */
export function listSuggestJobs(): SuggestCutsJob[] {
	return [...suggestJobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** Cancel a running suggest-cuts job. */
export function cancelSuggestJob(jobId: string): boolean {
	const job = suggestJobs.get(jobId);
	if (!job || job.status === "completed" || job.status === "failed") {
		return false;
	}
	job.status = "cancelled";
	job.message = "Cancelled by user";
	job.completedAt = Date.now();
	claudeLog.info(HANDLER_NAME, `Job ${jobId} cancelled`);
	return true;
}

/** For tests: clear all jobs. */
export function _clearSuggestJobs(): void {
	suggestJobs.clear();
}

/** Run suggest-cuts in the background, updating job progress. */
async function runSuggestJob(
	jobId: string,
	projectId: string,
	request: SuggestCutsRequest
): Promise<void> {
	const job = suggestJobs.get(jobId);
	if (!job) return;

	job.status = "processing";
	job.progress = 10;
	job.message = "Starting analysis...";

	try {
		const result = await suggestCuts(projectId, request);

		if (suggestJobs.get(jobId)?.status === "cancelled") return;

		job.status = "completed";
		job.progress = 100;
		job.message = `Done: ${result.summary.totalSuggestions} suggestions`;
		job.result = result;
		job.completedAt = Date.now();

		claudeLog.info(
			HANDLER_NAME,
			`Job ${jobId} completed: ${result.summary.totalSuggestions} suggestions`
		);
	} catch (err) {
		if (suggestJobs.get(jobId)?.status === "cancelled") return;
		job.status = "failed";
		job.message = err instanceof Error ? err.message : "Suggest-cuts failed";
		job.completedAt = Date.now();
		claudeLog.error(HANDLER_NAME, `Job ${jobId} failed:`, err);
	}
}

/**
 * Generate cut suggestions by analyzing a media file.
 * Runs transcription, scene detection, and filler analysis in parallel.
 */
export async function suggestCuts(
	projectId: string,
	request: SuggestCutsRequest
): Promise<SuggestCutsResponse> {
	const safeProjectId = sanitizeProjectId(projectId);

	if (!request.mediaId) {
		throw new HttpError(400, "Missing 'mediaId'");
	}

	const includeFillers = request.includeFillers !== false;
	const includeSilences = request.includeSilences !== false;
	const includeScenes = request.includeScenes !== false;

	claudeLog.info(
		HANDLER_NAME,
		`Suggest cuts: project=${safeProjectId}, media=${request.mediaId}, ` +
			`fillers=${includeFillers}, silences=${includeSilences}, scenes=${includeScenes}`
	);

	// Run transcription and scene detection in parallel for speed
	const needTranscription = includeFillers || includeSilences;
	const needScenes = includeScenes;

	const [transcriptionSettled, scenesSettled] = await Promise.allSettled([
		needTranscription
			? transcribeMedia(safeProjectId, {
					mediaId: request.mediaId,
					provider: request.provider,
					language: request.language,
				})
			: Promise.resolve(null),
		needScenes
			? detectScenes(safeProjectId, {
					mediaId: request.mediaId,
					threshold: request.sceneThreshold,
				})
			: Promise.resolve(null),
	]);

	let transcription: TranscriptionResult | null = null;
	let sceneResult: SceneDetectionResult | null = null;

	if (
		transcriptionSettled.status === "fulfilled" &&
		transcriptionSettled.value
	) {
		transcription = transcriptionSettled.value;
	} else if (transcriptionSettled.status === "rejected" && needTranscription) {
		claudeLog.warn(
			HANDLER_NAME,
			`Transcription failed: ${transcriptionSettled.reason}`
		);
	}

	if (scenesSettled.status === "fulfilled" && scenesSettled.value) {
		sceneResult = scenesSettled.value;
	} else if (scenesSettled.status === "rejected" && needScenes) {
		claudeLog.warn(
			HANDLER_NAME,
			`Scene detection failed: ${scenesSettled.reason}`
		);
	}

	// Analyze fillers if transcription succeeded
	let fillerResult: FillerAnalysisResult | null = null;
	if (transcription && (includeFillers || includeSilences)) {
		try {
			const fillerInput = transcription.words.map((w, i) => ({
				id: `w_${i}`,
				text: w.text,
				start: w.start,
				end: w.end,
				type: w.type === "word" ? ("word" as const) : ("spacing" as const),
				speaker_id: w.speaker ?? undefined,
			}));

			fillerResult = await analyzeFillers(safeProjectId, {
				mediaId: request.mediaId,
				words: fillerInput,
			});
		} catch (error) {
			claudeLog.warn(
				HANDLER_NAME,
				`Filler analysis failed: ${error instanceof Error ? error.message : error}`
			);
		}
	}

	// Build suggestions
	const suggestions: CutSuggestion[] = [];

	// Filler word suggestions
	if (includeFillers && fillerResult) {
		for (const filler of fillerResult.fillers) {
			suggestions.push({
				type: "filler",
				start: filler.start,
				end: filler.end,
				reason: `Filler word "${filler.word}" detected`,
				confidence: 0.9,
				word: filler.word,
			});
		}
	}

	// Silence suggestions
	if (includeSilences && fillerResult) {
		for (const silence of fillerResult.silences) {
			suggestions.push({
				type: "silence",
				start: silence.start,
				end: silence.end,
				reason: `Silence gap of ${silence.duration.toFixed(1)}s`,
				confidence: 0.8,
			});
		}
	}

	// Scene-based suggestions
	if (includeScenes && sceneResult && sceneResult.scenes.length > 1) {
		for (let i = 0; i < sceneResult.scenes.length; i++) {
			const scene = sceneResult.scenes[i];
			const nextScene = sceneResult.scenes[i + 1];

			// Suggest very short shots (< 0.5s) as potential jump cuts
			if (nextScene) {
				const shotDuration = nextScene.timestamp - scene.timestamp;
				if (shotDuration < 0.5 && shotDuration > 0) {
					suggestions.push({
						type: "pacing",
						start: scene.timestamp,
						end: nextScene.timestamp,
						reason: `Very short shot (${shotDuration.toFixed(2)}s) — possible jump cut`,
						confidence: 0.6,
					});
				}
			}

			// Mark scene transitions for reference
			if (scene.timestamp > 0) {
				suggestions.push({
					type: "scene_transition",
					start: Math.max(0, scene.timestamp - 0.1),
					end: scene.timestamp + 0.1,
					reason:
						scene.description ||
						`Scene change at ${scene.timestamp.toFixed(1)}s`,
					confidence: scene.confidence,
				});
			}
		}
	}

	// Sort by start time
	suggestions.sort((a, b) => a.start - b.start);

	// Build summary
	const fillerSuggestions = suggestions.filter(
		(s) => s.type === "filler"
	).length;
	const silenceSuggestions = suggestions.filter(
		(s) => s.type === "silence"
	).length;
	const sceneSuggestions = suggestions.filter(
		(s) => s.type === "scene_transition" || s.type === "pacing"
	).length;

	const estimatedTimeRemoved = suggestions
		.filter((s) => s.type === "filler" || s.type === "silence")
		.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);

	claudeLog.info(
		HANDLER_NAME,
		`Generated ${suggestions.length} suggestions (fillers=${fillerSuggestions}, ` +
			`silences=${silenceSuggestions}, scenes=${sceneSuggestions})`
	);

	return {
		suggestions,
		summary: {
			totalSuggestions: suggestions.length,
			fillerSuggestions,
			silenceSuggestions,
			sceneSuggestions,
			estimatedTimeRemoved: Math.round(estimatedTimeRemoved * 100) / 100,
		},
		...(transcription && {
			transcription: {
				wordCount: transcription.words.length,
				duration: transcription.duration,
			},
		}),
		...(sceneResult && {
			scenes: {
				totalScenes: sceneResult.totalScenes,
				averageShotDuration: sceneResult.averageShotDuration,
			},
		}),
	};
}
