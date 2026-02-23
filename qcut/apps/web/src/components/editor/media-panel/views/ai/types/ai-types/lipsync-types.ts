/**
 * Sync Lipsync React-1 Types
 */

/**
 * Emotion options for Sync Lipsync React-1
 * Controls the emotional expression applied during lip-sync
 */
export type SyncLipsyncEmotion =
	| "happy"
	| "angry"
	| "sad"
	| "neutral"
	| "disgusted"
	| "surprised";

/**
 * Model mode for Sync Lipsync React-1
 * Controls which region is modified during generation
 */
export type SyncLipsyncModelMode = "lips" | "face" | "head";

/**
 * Sync mode for audio-video duration mismatch handling
 */
export type SyncLipsyncSyncMode =
	| "cut_off"
	| "loop"
	| "bounce"
	| "silence"
	| "remap";

/**
 * Request parameters for Sync Lipsync React-1 generation
 */
export interface SyncLipsyncReact1Request {
	model: string;
	/** Pre-uploaded video URL (FAL storage) */
	videoUrl: string;
	/** Pre-uploaded audio URL (FAL storage) */
	audioUrl: string;
	/** Required emotion for expression control */
	emotion: SyncLipsyncEmotion;
	/** Optional model mode (default: face) */
	modelMode?: SyncLipsyncModelMode;
	/** Optional sync mode (default: bounce) */
	lipsyncMode?: SyncLipsyncSyncMode;
	/** Optional temperature 0-1 (default: 0.5) */
	temperature?: number;
}
