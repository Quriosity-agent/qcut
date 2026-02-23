/**
 * Generation state, progress, and service manager types
 */

import type { AIVideoOutputManager } from "@/lib/ai-video-output";

// Generated Video Interfaces
export interface GeneratedVideo {
	jobId: string;
	videoUrl: string;
	videoPath?: string;
	localPath?: string; // Local file path on disk (for AI videos saved locally)
	fileSize?: number;
	duration?: number;
	prompt: string;
	model: string;
}

export interface GeneratedVideoResult {
	modelId: string;
	video: GeneratedVideo;
}

// ⚠️ CRITICAL ADDITION: Polling state interface (identified in validation)
export interface PollingState {
	interval: NodeJS.Timeout | null;
	jobId: string | null;
	isPolling: boolean;
}

// ⚠️ CRITICAL ADDITION: Service manager interface (identified in validation)
export interface AIServiceManager {
	outputManager: AIVideoOutputManager;
	cleanup: () => void;
}

/**
 * Progress update passed to ProgressCallback during video generation.
 * Contains status, progress percentage, message, and timing information.
 */
export interface ProgressUpdate {
	status: "queued" | "processing" | "completed" | "failed";
	progress?: number;
	message?: string;
	elapsedTime?: number;
	estimatedTime?: number;
	logs?: string[];
}

/**
 * Callback for receiving progress updates during video generation.
 * Called periodically (every ~2s) during polling with the current status.
 */
export type ProgressCallback = (status: ProgressUpdate) => void;

// Generation status types (from API client)
export interface GenerationStatus {
	progress?: number;
	status?: string;
	completed?: boolean;
	error?: string;
	videoUrl?: string;
	/** @deprecated Use videoUrl instead. Kept for backward compatibility. */
	video_url?: string;
}

// API Configuration types
export interface APIConfiguration {
	falApiKey?: string;
	falApiBase: string;
	maxRetries: number;
	timeoutMs: number;
}

// Error types
export type AIError = string | null;
