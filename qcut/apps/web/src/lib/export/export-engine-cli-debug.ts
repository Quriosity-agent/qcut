/**
 * Debug Utilities for CLI Export Engine
 *
 * Logging helpers for export operations including duration
 * verification and mode detection logging.
 */

import { debugLog, debugWarn } from "@/lib/debug/debug-config";

export function logActualVideoDurationCLI(
	videoBlob: Blob,
	totalDuration: number
): void {
	const video = document.createElement("video");
	const url = URL.createObjectURL(videoBlob);

	video.onloadedmetadata = () => {
		const actualDuration = video.duration;
		const expectedDuration = totalDuration;

		debugLog(
			`[CLIExportEngine] 🎥 Actual video duration: ${actualDuration.toFixed(3)}s`
		);
		debugLog(
			`[CLIExportEngine] 📈 Timeline vs Video ratio: ${(actualDuration / expectedDuration).toFixed(3)}x`
		);

		if (Math.abs(actualDuration - expectedDuration) > 0.1) {
			debugWarn(
				`[CLIExportEngine] ⚠️  Duration mismatch detected! Expected: ${expectedDuration.toFixed(3)}s, Got: ${actualDuration.toFixed(3)}s`
			);
		} else {
			debugLog("[CLIExportEngine] ✅ Duration match within tolerance");
		}

		URL.revokeObjectURL(url);
	};

	video.onerror = () => {
		debugWarn("[CLIExportEngine] ⚠️  Could not determine actual video duration");
		URL.revokeObjectURL(url);
	};

	video.src = url;
}

export function logMode2Detection(
	canUseMode2: boolean,
	videoInput: { path: string; trimStart: number; trimEnd: number } | null,
	needsVideoInput: boolean,
	hasTextFilters: boolean,
	hasStickerFilters: boolean
): void {
	if (canUseMode2 && videoInput) {
		console.log(
			"⚡ [MODE 2 EXPORT] ============================================"
		);
		console.log("⚡ [MODE 2 EXPORT] Mode 2 optimization enabled!");
		console.log(`⚡ [MODE 2 EXPORT] Video input: ${videoInput.path}`);
		console.log(`⚡ [MODE 2 EXPORT] Trim start: ${videoInput.trimStart}s`);
		console.log(`⚡ [MODE 2 EXPORT] Trim end: ${videoInput.trimEnd}s`);
		console.log(
			`⚡ [MODE 2 EXPORT] Text filters: ${hasTextFilters ? "YES" : "NO"}`
		);
		console.log(
			`⚡ [MODE 2 EXPORT] Sticker filters: ${hasStickerFilters ? "YES" : "NO"}`
		);
		console.log(
			"⚡ [MODE 2 EXPORT] Frame rendering: SKIPPED (using direct video)"
		);
		console.log(
			"⚡ [MODE 2 EXPORT] Expected speedup: 3-5x faster than frame rendering"
		);
		console.log(
			"⚡ [MODE 2 EXPORT] ============================================"
		);
	} else if (needsVideoInput && !videoInput) {
		debugWarn("⚠️ [MODE 2 EXPORT] Video input extraction failed");
		debugWarn("⚠️ [MODE 2 EXPORT] Falling back to standard export");
	}
}
