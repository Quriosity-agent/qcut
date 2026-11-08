/**
 * FFmpeg Constants and Debug Logging
 */

import type { QualitySettings } from "./types";

// ============================================================================
// Constants
// ============================================================================

/** Maximum video duration for export (10 minutes) */
export const MAX_EXPORT_DURATION = 600;

/** Quality presets mapping quality levels to FFmpeg encoding parameters */
export const QUALITY_SETTINGS: Record<string, QualitySettings> = {
	high: { crf: "18", preset: "slow" },
	medium: { crf: "23", preset: "fast" },
	low: { crf: "28", preset: "veryfast" },
};

// ============================================================================
// Debug Logging
// ============================================================================

let debugLoggingOverride: boolean | undefined;

/**
 * Turns the [FFmpeg] debug lines on or off whatever NODE_ENV says. The CLI
 * runs as plain Node with no NODE_ENV, so without this every probe printed
 * "Using staged FFprobe binary…" to stderr; it keeps them for --verbose.
 */
export function setFFmpegDebugLogging(enabled: boolean): void {
	debugLoggingOverride = enabled;
}

function debugLoggingEnabled(): boolean {
	return debugLoggingOverride ?? process.env.NODE_ENV !== "production";
}

/**
 * Debug logging for development mode only.
 * Logs are prefixed with [FFmpeg] for easy filtering.
 */
export const debugLog = (...args: any[]): void => {
	if (debugLoggingEnabled()) {
		console.error("[FFmpeg]", ...args);
	}
};

/**
 * Debug warning for development mode only.
 */
export const debugWarn = (...args: any[]): void => {
	if (debugLoggingEnabled()) {
		console.warn("[FFmpeg]", ...args);
	}
};

/**
 * Debug error for development mode only.
 */
export const debugError = (...args: any[]): void => {
	if (debugLoggingEnabled()) {
		console.error("[FFmpeg]", ...args);
	}
};
