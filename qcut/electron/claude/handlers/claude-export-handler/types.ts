/**
 * Types for Claude Export Handler.
 * @module electron/claude/handlers/claude-export-handler/types
 */

export const EXPORT_JOB_STATUS = {
	queued: "queued",
	exporting: "exporting",
	completed: "completed",
	failed: "failed",
} as const;

export const MAX_JOBS = 50;

export const HANDLER_NAME = "Export";

export interface ExportSegment {
	sourcePath: string;
	startTime: number;
	duration: number;
	sourceId: string;
}

export interface ResolvedExportSettings {
	presetId: string;
	width: number;
	height: number;
	fps: number;
	format: string;
	codec: string;
	bitrate: string;
}

export interface ExportJobInternal {
	jobId: string;
	projectId: string;
	status: string;
	progress: number;
	startedAt: number;
	presetId: string;
	settings: ResolvedExportSettings;
	outputPath?: string;
	duration?: number;
	fileSize?: number;
	completedAt?: number;
	error?: string;
	currentFrame?: number;
	totalFrames?: number;
	fps?: number;
	estimatedTimeRemaining?: number;
}

export interface ProgressEventPayload {
	jobId?: string;
	progress?: number;
	currentFrame?: number;
	totalFrames?: number;
	fps?: number;
	estimatedTimeRemaining?: number;
}
