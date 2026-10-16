/**
 * Export job tracking and management.
 * @module electron/claude/handlers/claude-export-handler/job-manager
 */

import { claudeLog } from "../../utils/logger.js";
import { emitClaudeEvent } from "../claude-events-handler.js";
import {
	HANDLER_NAME,
	EXPORT_JOB_STATUS,
	type ExportJobInternal,
} from "./types.js";
import { clampProgress } from "./utils.js";
import type { ExportJobStatus } from "../../../types/claude-api";
import {
	CLAUDE_EDITOR_EVENT_ACTION,
	CLAUDE_EDITOR_EVENT_CATEGORY,
} from "../../../types/claude-api.js";

// In-memory job tracking (cleared on app restart)
export const exportJobs = new Map<string, ExportJobInternal>();

export function getActiveJobForProject({
	projectId,
}: {
	projectId: string;
}): ExportJobInternal | null {
	try {
		for (const job of exportJobs.values()) {
			if (job.projectId !== projectId) {
				continue;
			}
			if (
				job.status === EXPORT_JOB_STATUS.queued ||
				job.status === EXPORT_JOB_STATUS.exporting
			) {
				return job;
			}
		}
		return null;
	} catch {
		return null;
	}
}

export function updateJobProgress({
	jobId,
	progress,
	currentFrame,
	totalFrames,
	fps,
	estimatedTimeRemaining,
}: {
	jobId: string;
	progress: number;
	currentFrame?: number;
	totalFrames?: number;
	fps?: number;
	estimatedTimeRemaining?: number;
}): void {
	try {
		const job = exportJobs.get(jobId);
		if (!job) {
			return;
		}

		const normalized = clampProgress({ value: progress });
		job.progress = normalized;
		job.currentFrame = currentFrame;
		job.totalFrames = totalFrames;
		job.fps = fps;
		job.estimatedTimeRemaining = estimatedTimeRemaining;

		if (job.status === EXPORT_JOB_STATUS.cancelled) {
			// A late progress report from a step that was being killed.
			return;
		}
		if (normalized >= 1) {
			job.status = EXPORT_JOB_STATUS.completed;
			job.completedAt = Date.now();
		} else if (job.status !== EXPORT_JOB_STATUS.failed) {
			job.status = EXPORT_JOB_STATUS.exporting;
		}

		emitClaudeEvent({
			category: CLAUDE_EDITOR_EVENT_CATEGORY.exportProgress,
			action: CLAUDE_EDITOR_EVENT_ACTION.progress,
			correlationId: jobId,
			source: "main.export-handler",
			data: {
				jobId,
				projectId: job.projectId,
				status: job.status,
				progress: job.progress,
				currentFrame: job.currentFrame,
				totalFrames: job.totalFrames,
				fps: job.fps,
				estimatedTimeRemaining: job.estimatedTimeRemaining,
			},
		});
	} catch (error) {
		claudeLog.warn(
			HANDLER_NAME,
			`Failed to update progress for job ${jobId}:`,
			error
		);
	}
}

export type CancelExportOutcome =
	| { ok: true; job: ExportJobInternal }
	| {
			ok: false;
			reason: "not-found" | "finished" | "renderer";
			job?: ExportJobInternal;
	  };

/**
 * Stops a running native export: the job is marked cancelled and its current
 * FFmpeg step is killed; the engine then removes the partial output. A job
 * that already finished stays as it is, and a renderer (muxer) export runs
 * in the editor window, out of reach from here.
 */
export function cancelExportJob({
	jobId,
}: {
	jobId: string;
}): CancelExportOutcome {
	const job = exportJobs.get(jobId);
	if (!job) return { ok: false, reason: "not-found" };
	if (
		job.status !== EXPORT_JOB_STATUS.queued &&
		job.status !== EXPORT_JOB_STATUS.exporting
	) {
		return { ok: false, reason: "finished", job };
	}
	if (job.engine === "renderer-muxer") {
		return { ok: false, reason: "renderer", job };
	}
	job.status = EXPORT_JOB_STATUS.cancelled;
	job.error = "Cancelled";
	job.completedAt = Date.now();
	job.abort?.abort();
	claudeLog.info(HANDLER_NAME, `Export job ${jobId} cancelled`);
	return { ok: true, job };
}

export function getExportJobStatus(jobId: string): ExportJobStatus | null {
	try {
		return (exportJobs.get(jobId) as ExportJobStatus | undefined) ?? null;
	} catch {
		return null;
	}
}

export function listExportJobs(projectId?: string): ExportJobStatus[] {
	try {
		const allJobs = [...exportJobs.values()] as ExportJobStatus[];
		const filteredJobs = projectId
			? allJobs.filter((job: any) => job.projectId === projectId)
			: allJobs;

		return filteredJobs.sort((a, b) => b.startedAt - a.startedAt);
	} catch {
		return [];
	}
}

export function clearExportJobsForTests(): void {
	try {
		exportJobs.clear();
	} catch {
		// no-op
	}
}
