/**
 * FFmpeg Invocation for CLI Export
 *
 * Handles the FFmpeg CLI invocation and debug logging
 * for the export process.
 */

import { debugLog, debugError } from "@/lib/debug/debug-config";

export function logExportConfiguration(
	exportOptions: {
		sessionId: string;
		width: number;
		height: number;
		fps: number;
		duration: number;
		quality: string;
		audioFiles?: unknown[];
		useDirectCopy?: boolean;
		videoSources?: unknown[];
		wordFilterSegments?: unknown[];
	},
	context: {
		hasTextFilters: boolean;
		hasStickerFilters: boolean;
		hasImageFilters: boolean;
		stickerCount: number;
		imageCount: number;
		textFilterChainLength: number;
	}
): void {
	console.log(
		"🚀 [FFMPEG EXPORT DEBUG] ============================================"
	);
	console.log("🚀 [FFMPEG EXPORT DEBUG] Starting FFmpeg CLI export process");
	console.log("🚀 [FFMPEG EXPORT DEBUG] Export configuration:");
	console.log(`   - Session ID: ${exportOptions.sessionId}`);
	console.log(
		`   - Dimensions: ${exportOptions.width}x${exportOptions.height}`
	);
	console.log(`   - FPS: ${exportOptions.fps}`);
	console.log(`   - Duration: ${exportOptions.duration}s`);
	console.log(`   - Quality: ${exportOptions.quality}`);
	console.log(`   - Audio files: ${exportOptions.audioFiles?.length || 0}`);
	console.log(
		`   - Text elements: ${context.hasTextFilters ? "YES (using FFmpeg drawtext)" : "NO"}`
	);
	console.log(
		`   - Sticker overlays: ${context.hasStickerFilters ? `YES (${context.stickerCount} stickers)` : "NO"}`
	);
	console.log(
		`   - Image overlays: ${context.hasImageFilters ? `YES (${context.imageCount} images)` : "NO"}`
	);
	console.log(
		`   - Direct copy mode: ${exportOptions.useDirectCopy ? "ENABLED" : "DISABLED"}`
	);
	console.log(
		`   - Word filter cuts: ${exportOptions.wordFilterSegments ? `${(exportOptions.wordFilterSegments as unknown[]).length} segments` : "NO"}`
	);
	console.log(
		`   - Video sources: ${exportOptions.videoSources?.length || 0}`
	);
	if (context.hasTextFilters) {
		console.log(
			"📝 [TEXT RENDERING] Text will be rendered directly by FFmpeg (not canvas)"
		);
		console.log(
			`📝 [TEXT RENDERING] Text filter chain length: ${context.textFilterChainLength} characters`
		);
	}
	console.log(
		"🚀 [FFMPEG EXPORT DEBUG] ============================================"
	);
}

// biome-ignore lint/suspicious/noExplicitAny: electron API types are dynamic
export async function invokeFFmpegExport(
	exportOptions: Record<string, any>
): Promise<string> {
	if (!window.electronAPI) {
		throw new Error("CLI export only available in Electron");
	}

	debugLog(
		"[CLI Export] Starting FFmpeg export with options:",
		exportOptions
	);

	try {
		console.log("⏳ [FFMPEG EXPORT DEBUG] Invoking FFmpeg CLI...");
		const startTime = Date.now();

		// biome-ignore lint/suspicious/noExplicitAny: export options are dynamically constructed
		const result = await window.electronAPI.ffmpeg.exportVideoCLI(
			exportOptions as any
		);

		const duration = ((Date.now() - startTime) / 1000).toFixed(2);
		console.log(
			`✅ [FFMPEG EXPORT DEBUG] FFmpeg export completed in ${duration}s`
		);
		console.log(
			"✅ [EXPORT OPTIMIZATION] FFmpeg export completed successfully!"
		);
		debugLog("[CLI Export] FFmpeg export completed successfully:", result);
		return result.outputFile;
	} catch (error) {
		console.error("❌ [EXPORT OPTIMIZATION] FFmpeg export FAILED!", error);
		console.error(
			"❌ [EXPORT OPTIMIZATION] Error message:",
			error instanceof Error ? error.message : String(error)
		);
		console.error("❌ [EXPORT OPTIMIZATION] Error details:", {
			message: error instanceof Error ? error.message : String(error),
			// biome-ignore lint/suspicious/noExplicitAny: error may have code/stderr/stdout
			code: (error as any)?.code,
			// biome-ignore lint/suspicious/noExplicitAny: error may have code/stderr/stdout
			stderr: (error as any)?.stderr,
			// biome-ignore lint/suspicious/noExplicitAny: error may have code/stderr/stdout
			stdout: (error as any)?.stdout,
		});
		debugError("[CLI Export] FFmpeg export failed:", error);
		debugError("[CLI Export] Error details:", {
			message: error instanceof Error ? error.message : String(error),
			// biome-ignore lint/suspicious/noExplicitAny: error may have code/stderr/stdout
			code: (error as any)?.code,
			// biome-ignore lint/suspicious/noExplicitAny: error may have code/stderr/stdout
			stderr: (error as any)?.stderr,
			// biome-ignore lint/suspicious/noExplicitAny: error may have code/stderr/stdout
			stdout: (error as any)?.stdout,
		});
		throw error;
	}
}
