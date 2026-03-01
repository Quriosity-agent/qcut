import * as path from "path";
import * as fs from "fs";
import { app, ipcMain } from "electron";
import { randomBytes } from "crypto";

const MAX_VIDEO_SIZE = 5 * 1024 * 1024 * 1024; // 5GB limit for AI videos

/** Safe console wrapper that catches EPIPE errors from broken stdout */
function safeLog(...args: unknown[]): void {
	try {
		console.log(...args);
	} catch {
		// Ignore EPIPE — stdout disconnected during shutdown
	}
}

/**
 * Sanitize filename to prevent path traversal attacks
 */
export function sanitizeFilename(filename: string): string {
	return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Get the Documents-based AI video directory for a project.
 * Path: Documents/QCut/Projects/{projectId}/media/generated/videos/
 */
export function getAIVideoDir(projectId: string): string {
	const documentsPath = app.getPath("documents");
	const dir = path.join(
		documentsPath,
		"QCut",
		"Projects",
		sanitizeFilename(projectId),
		"media",
		"generated",
		"videos"
	);
	console.log(
		`[AI Video Path] getAIVideoDir("${projectId}") → ${dir} (documents=${documentsPath})`
	);
	return dir;
}

/**
 * Get the legacy AppData-based AI video directory for migration.
 * Path: AppData/qcut/projects/{projectId}/ai-videos/
 */
export function getLegacyAIVideoDir(projectId: string): string {
	return path.join(
		app.getPath("userData"),
		"projects",
		sanitizeFilename(projectId),
		"ai-videos"
	);
}

/**
 * Generate a unique identifier to prevent filename collisions
 */
function generateUniqueId(): string {
	return randomBytes(8).toString("hex");
}

interface SaveAIVideoOptions {
	fileName: string;
	fileData: ArrayBuffer | Uint8Array | Buffer;
	projectId: string;
	modelId?: string;
	metadata?: {
		width?: number;
		height?: number;
		duration?: number;
		fps?: number;
	};
}

interface SaveAIVideoResult {
	success: boolean;
	localPath?: string;
	fileName?: string;
	fileSize?: number;
	error?: string;
}

/**
 * Save AI-generated video to permanent project storage
 * This is MANDATORY - if save fails, the entire operation must fail
 *
 * @param options - Save options including file data and project info
 * @returns Result object with local path or error
 * @throws Error if save fails - NO FALLBACKS ALLOWED
 */
export async function saveAIVideoToDisk(
	options: SaveAIVideoOptions
): Promise<SaveAIVideoResult> {
	try {
		const { fileName, fileData, projectId, modelId, metadata } = options;

		// Convert to Buffer
		let buffer: Buffer;
		if (Buffer.isBuffer(fileData)) {
			buffer = fileData;
		} else if (fileData instanceof ArrayBuffer) {
			buffer = Buffer.from(fileData);
		} else if (fileData instanceof Uint8Array) {
			buffer = Buffer.from(fileData);
		} else {
			const error =
				"Invalid file data type - must be Buffer, ArrayBuffer, or Uint8Array";
			console.error("AI Video Save Error:", error);
			return {
				success: false,
				error,
			};
		}

		// Validate file size
		if (buffer.length > MAX_VIDEO_SIZE) {
			const sizeInMB = (buffer.length / 1024 / 1024).toFixed(2);
			const error = `Video file too large: ${sizeInMB}MB exceeds ${MAX_VIDEO_SIZE / 1024 / 1024 / 1024}GB limit`;
			console.error("AI Video Save Error:", error);
			return {
				success: false,
				error,
			};
		}

		// Validate buffer is not empty
		if (buffer.length === 0) {
			const error = "Video file is empty - cannot save";
			console.error("AI Video Save Error:", error);
			return {
				success: false,
				error,
			};
		}

		// Create project-specific video directory (Documents-based)
		const projectDir = getAIVideoDir(projectId);
		console.log(
			`[AI Video Save] Saving to projectDir: ${projectDir} (projectId="${projectId}")`
		);

		// Ensure directory exists with proper permissions
		try {
			await fs.promises.mkdir(projectDir, { recursive: true, mode: 0o755 });
		} catch (mkdirError: any) {
			const error = `Failed to create project directory: ${mkdirError.message}`;
			console.error("AI Video Save Error:", error);
			return {
				success: false,
				error,
			};
		}

		// Generate unique filename with metadata
		const timestamp = Date.now();
		const uniqueId = generateUniqueId();
		const sanitizedName = sanitizeFilename(fileName);
		const extension = path.extname(sanitizedName) || ".mp4";
		const baseName = path.basename(sanitizedName, extension);

		// Include model ID in filename for better organization
		const finalFileName = modelId
			? `${baseName}-${modelId}-${timestamp}-${uniqueId}${extension}`
			: `${baseName}-${timestamp}-${uniqueId}${extension}`;

		const filePath = path.join(projectDir, finalFileName);

		// Check disk space before saving (Windows/Mac/Linux compatible)
		try {
			const stats = await fs.promises.statfs(projectDir);
			const availableSpace = stats.bavail * stats.bsize;
			const requiredSpace = buffer.length * 1.1; // 10% buffer for safety

			if (availableSpace < requiredSpace) {
				const availableMB = (availableSpace / 1024 / 1024).toFixed(2);
				const requiredMB = (requiredSpace / 1024 / 1024).toFixed(2);
				const error = `Insufficient disk space: ${availableMB}MB available, ${requiredMB}MB required`;
				console.error("AI Video Save Error:", error);
				return {
					success: false,
					error,
				};
			}
		} catch (statfsError) {
			// statfs might not be available on all systems, continue anyway
			console.warn("Could not check disk space, proceeding with save");
		}

		// Write file to disk - THIS MUST SUCCEED
		try {
			await fs.promises.writeFile(filePath, buffer, { mode: 0o644 });
		} catch (writeError: any) {
			const error = `Failed to write video file to disk: ${writeError.message}`;
			console.error("AI Video Save Error:", error);
			return {
				success: false,
				error,
			};
		}

		// Verify the file was written correctly
		try {
			const stats = await fs.promises.stat(filePath);
			if (stats.size !== buffer.length) {
				// File size mismatch - delete corrupted file
				await fs.promises.unlink(filePath).catch(() => {});
				const error = `File verification failed: size mismatch (expected ${buffer.length}, got ${stats.size})`;
				console.error("AI Video Save Error:", error);
				return {
					success: false,
					error,
				};
			}
		} catch (verifyError: any) {
			const error = `Failed to verify saved file: ${verifyError.message}`;
			console.error("AI Video Save Error:", error);
			return {
				success: false,
				error,
			};
		}

		// Save metadata file alongside video (optional, non-critical)
		if (metadata && Object.keys(metadata).length > 0) {
			const metadataPath = filePath.replace(extension, ".meta.json");
			const metadataContent = {
				...metadata,
				originalFileName: fileName,
				modelId,
				projectId,
				savedAt: new Date().toISOString(),
				fileSize: buffer.length,
			};

			try {
				await fs.promises.writeFile(
					metadataPath,
					JSON.stringify(metadataContent, null, 2)
				);
			} catch (metaError) {
				// Metadata save failure is non-critical
				console.warn("Failed to save metadata file:", metaError);
			}
		}

		console.log(
			`✅ AI Video saved successfully to disk: ${filePath} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`
		);

		return {
			success: true,
			localPath: filePath,
			fileName: finalFileName,
			fileSize: buffer.length,
		};
	} catch (unexpectedError: any) {
		const error = `Unexpected error saving AI video: ${unexpectedError.message}`;
		console.error("AI Video Save CRITICAL ERROR:", error);
		return {
			success: false,
			error,
		};
	}
}

/**
 * Check if a saved AI video file exists and is valid
 */
export async function verifyAIVideoFile(filePath: string): Promise<boolean> {
	try {
		const stats = await fs.promises.stat(filePath);
		return stats.isFile() && stats.size > 0;
	} catch {
		return false;
	}
}

/**
 * Delete AI video file and its metadata
 */
export async function deleteAIVideoFile(filePath: string): Promise<boolean> {
	try {
		// Delete main file
		await fs.promises.unlink(filePath);

		// Try to delete metadata file if it exists
		const metadataPath = filePath.replace(/\.[^.]+$/, ".meta.json");
		await fs.promises.unlink(metadataPath).catch(() => {});

		return true;
	} catch (error) {
		console.error("Failed to delete AI video file:", error);
		return false;
	}
}

/**
 * Register IPC handlers for AI video save operations
 */
export function registerAIVideoHandlers(): void {
	// Main save handler - MANDATORY SUCCESS REQUIRED
	ipcMain.handle(
		"ai-video:save-to-disk",
		async (event, options: SaveAIVideoOptions): Promise<SaveAIVideoResult> => {
			console.log("IPC: ai-video:save-to-disk called", {
				fileName: options.fileName,
				projectId: options.projectId,
				dataSize: options.fileData
					? (options.fileData as any).byteLength ||
						(options.fileData as Buffer).length
					: 0,
			});

			const result = await saveAIVideoToDisk(options);

			// If save failed, this is CRITICAL - the operation must not continue
			if (!result.success) {
				console.error(
					"🚨 CRITICAL: AI Video save to disk FAILED - Operation must be aborted",
					result.error
				);
			}

			return result;
		}
	);

	// Verify file exists
	ipcMain.handle(
		"ai-video:verify-file",
		async (event, filePath: string): Promise<boolean> => {
			return await verifyAIVideoFile(filePath);
		}
	);

	// Delete file (for cleanup or user request)
	ipcMain.handle(
		"ai-video:delete-file",
		async (event, filePath: string): Promise<boolean> => {
			return await deleteAIVideoFile(filePath);
		}
	);

	// Get project videos directory
	ipcMain.handle(
		"ai-video:get-project-dir",
		async (event, projectId: string): Promise<string> => {
			const dir = getAIVideoDir(projectId);
			safeLog(`[AI Video IPC] get-project-dir("${projectId}") → ${dir}`);
			return dir;
		}
	);

	safeLog("✅ AI Video save handlers registered (Documents-based paths)");
}

// --- Migration ---

interface MigrationResult {
	copied: number;
	skipped: number;
	projectsProcessed: number;
	errors: string[];
}

/**
 * One-time migration: copy AI videos from AppData to Documents.
 * - Copies files, does NOT delete originals (existing localPath refs still work)
 * - Skips files that already exist at the destination (idempotent)
 * - Non-blocking: errors are collected, not thrown
 */
export async function migrateAIVideosToDocuments(): Promise<MigrationResult> {
	const result: MigrationResult = {
		copied: 0,
		skipped: 0,
		projectsProcessed: 0,
		errors: [],
	};

	const legacyRoot = path.join(app.getPath("userData"), "projects");
	safeLog(`[AI Video Migration] Legacy root: ${legacyRoot}`);
	safeLog(`[AI Video Migration] Documents base: ${app.getPath("documents")}`);

	// Early return if no legacy directory
	try {
		await fs.promises.access(legacyRoot);
		safeLog("[AI Video Migration] Legacy root exists, scanning...");
	} catch {
		safeLog("[AI Video Migration] No legacy root found, skipping.");
		return result;
	}

	// Enumerate project directories
	let projectDirs: string[];
	try {
		const entries = await fs.promises.readdir(legacyRoot, {
			withFileTypes: true,
		});
		projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
	} catch (err) {
		result.errors.push(`Failed to read legacy projects dir: ${err}`);
		return result;
	}

	for (const projectName of projectDirs) {
		const legacyVideoDir = path.join(legacyRoot, projectName, "ai-videos");

		// Skip projects without ai-videos folder
		try {
			await fs.promises.access(legacyVideoDir);
		} catch {
			continue;
		}

		result.projectsProcessed++;
		const destDir = getAIVideoDir(projectName);

		// Ensure destination exists
		try {
			await fs.promises.mkdir(destDir, { recursive: true, mode: 0o755 });
		} catch (err) {
			result.errors.push(
				`Failed to create dest dir for ${projectName}: ${err}`
			);
			continue;
		}

		// Copy files
		let files: string[];
		try {
			files = await fs.promises.readdir(legacyVideoDir);
		} catch (err) {
			result.errors.push(
				`Failed to read legacy dir for ${projectName}: ${err}`
			);
			continue;
		}

		for (const file of files) {
			const srcPath = path.join(legacyVideoDir, file);
			const destPath = path.join(destDir, file);

			// Skip directories
			try {
				const stat = await fs.promises.stat(srcPath);
				if (!stat.isFile()) continue;
			} catch (err) {
				result.errors.push(`Failed to stat source file ${srcPath}: ${err}`);
				continue;
			}

			// Skip if destination already exists
			try {
				await fs.promises.access(destPath);
				result.skipped++;
				continue;
			} catch {
				// File doesn't exist at destination — proceed with copy
			}

			try {
				await fs.promises.copyFile(srcPath, destPath);
				result.copied++;
			} catch (err) {
				result.errors.push(`Failed to copy ${file} in ${projectName}: ${err}`);
			}
		}
	}

	return result;
}
