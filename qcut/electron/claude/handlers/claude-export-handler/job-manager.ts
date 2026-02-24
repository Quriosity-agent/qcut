/**
 * Export job tracking and management.
 * @module electron/claude/handlers/claude-export-handler/job-manager
 */

import { claudeLog } from "../../utils/logger.js";
import {
	HANDLER_NAME,
	EXPORT_JOB_STATUS,
	type ExportJobInternal,
} from "./types.js";
import { clampProgress } from "./utils.js";
import type { ExportJobStatus } from "../../../types/claude-api";

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

		if (normalized >= 1) {
			job.status = EXPORT_JOB_STATUS.completed;
			job.completedAt = Date.now();
		} else if (job.status !== EXPORT_JOB_STATUS.failed) {
			job.status = EXPORT_JOB_STATUS.exporting;
		}
	} catch (error) {
		claudeLog.warn(
			HANDLER_NAME,
			`Failed to update progress for job ${jobId}:`,
			error
		);
	}
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
