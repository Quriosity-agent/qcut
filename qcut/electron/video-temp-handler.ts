import * as path from "path";
import * as fs from "fs";
import { app } from "electron";
import { randomBytes } from "crypto";

const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024; // 2GB limit

/**
 * Sanitize filename to prevent path traversal attacks
 * Replaces any character that's not alphanumeric, dot, underscore, or hyphen
 */
function sanitizeFilename(filename: string): string {
	return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Generate a unique identifier to prevent filename collisions
 * Uses cryptographic random bytes for true uniqueness
 */
function generateUniqueId(): string {
	return randomBytes(8).toString("hex");
}

/**
 * Save video file to temporary directory
 *
 * @param videoData - Video file data as Uint8Array or Buffer
 * @param filename - Original filename (will be sanitized)
 * @param sessionId - Optional session ID for session-based cleanup
 * @returns Absolute path to saved temp file
 * @throws Error if file is too large or save fails
 */
export async function saveVideoToTemp(
	videoData: Uint8Array | Buffer,
	filename: string,
	sessionId?: string
): Promise<string> {
	const buffer = Buffer.isBuffer(videoData)
		? videoData
		: Buffer.from(videoData);

	// Validate file size to prevent disk exhaustion
	if (buffer.length > MAX_VIDEO_SIZE) {
		throw new Error(
			`Video file too large: ${(buffer.length / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_VIDEO_SIZE / 1024 / 1024}MB limit`
		);
	}

	const tempDir = path.join(app.getPath("temp"), "qcut-videos");

	// Check available disk space (optional but recommended)
	try {
		// Note: statfs is not available in all environments, so we wrap in try-catch
		const stats = await fs.promises.statfs(tempDir).catch(() => null);
		if (stats) {
			const availableSpace = stats.bavail * stats.bsize;
			const requiredSpace = buffer.length * 1.1; // 10% buffer

			if (availableSpace < requiredSpace) {
				throw new Error(
					`Insufficient disk space: ${(availableSpace / 1024 / 1024).toFixed(2)}MB available, ${(requiredSpace / 1024 / 1024).toFixed(2)}MB required`
				);
			}
		}
	} catch (error) {
		// If we can't check space, proceed anyway (better than blocking)
		console.warn("[Video Temp Handler] Could not check disk space:", error);
	}

	// Create temp directory if it doesn't exist
	try {
		await fs.promises.mkdir(tempDir, { recursive: true });
	} catch (error) {
		console.error(
			"[Video Temp Handler] Failed to create temp directory:",
			error
		);
		throw error;
	}

	// Generate unique filename with timestamp and random ID to prevent collisions
	const uniqueId = generateUniqueId();
	const timestamp = Date.now();
	const safeName = sessionId
		? `video-${sessionId}-${timestamp}-${uniqueId}-${sanitizeFilename(filename)}`
		: `video-${timestamp}-${uniqueId}-${sanitizeFilename(filename)}`;

	const filePath = path.join(tempDir, safeName);

	// Write file to temp directory
	try {
		await fs.promises.writeFile(filePath, buffer);
	} catch (error) {
		console.error(
			"[Video Temp Handler] Failed to write file:",
			filePath,
			error
		);
		throw error;
	}

	return filePath;
}

/**
 * Clean up video files for a specific session
 *
 * @param sessionId - Session ID to clean up
 */
export async function cleanupVideoFiles(sessionId: string): Promise<void> {
	const tempDir = path.join(app.getPath("temp"), "qcut-videos");

	// Check if directory exists asynchronously
	try {
		await fs.promises.access(tempDir, fs.constants.F_OK);
	} catch {
		return; // Directory doesn't exist, nothing to clean
	}

	try {
		const files = await fs.promises.readdir(tempDir);
		await Promise.all(
			files
				.filter((f) => f.includes(sessionId))
				.map((f) => fs.promises.unlink(path.join(tempDir, f)).catch(() => {}))
		);
	} catch (error) {
		console.error(
			"[Video Temp Handler] Failed to cleanup session videos:",
			error
		);
	}
}

/**
 * Clean up all video temp files (called on app quit)
 */
export async function cleanupAllVideoFiles(): Promise<void> {
	const tempDir = path.join(app.getPath("temp"), "qcut-videos");

	try {
		await fs.promises.access(tempDir, fs.constants.F_OK);
		await fs.promises.rm(tempDir, { recursive: true, force: true });
		console.log("[Video Temp Handler] Cleaned up all video temp files");
	} catch (error) {
		// Directory doesn't exist or cleanup failed - not critical
		console.error(
			"[Video Temp Handler] Failed to cleanup video temp files:",
			error
		);
	}
}
