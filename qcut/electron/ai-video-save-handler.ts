import * as path from "path";
import * as fs from "fs";
import { app, ipcMain } from "electron";
import { randomBytes } from "crypto";

const MAX_VIDEO_SIZE = 5 * 1024 * 1024 * 1024; // 5GB limit for AI videos

/**
 * Sanitize filename to prevent path traversal attacks
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
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
export async function saveAIVideoToDisk(options: SaveAIVideoOptions): Promise<SaveAIVideoResult> {
  try {
    const { fileName, fileData, projectId, modelId, metadata } = options;

    // Convert to Buffer
    const buffer = Buffer.isBuffer(fileData)
      ? fileData
      : Buffer.from(fileData);

    // Validate file size
    if (buffer.length > MAX_VIDEO_SIZE) {
      const sizeInMB = (buffer.length / 1024 / 1024).toFixed(2);
      const error = `Video file too large: ${sizeInMB}MB exceeds ${MAX_VIDEO_SIZE / 1024 / 1024 / 1024}GB limit`;
      console.error("AI Video Save Error:", error);
      return {
        success: false,
        error
      };
    }

    // Validate buffer is not empty
    if (buffer.length === 0) {
      const error = "Video file is empty - cannot save";
      console.error("AI Video Save Error:", error);
      return {
        success: false,
        error
      };
    }

    // Create project-specific video directory
    const projectDir = path.join(
      app.getPath("userData"),
      "projects",
      sanitizeFilename(projectId),
      "ai-videos"
    );

    // Ensure directory exists with proper permissions
    try {
      await fs.promises.mkdir(projectDir, { recursive: true, mode: 0o755 });
    } catch (mkdirError: any) {
      const error = `Failed to create project directory: ${mkdirError.message}`;
      console.error("AI Video Save Error:", error);
      return {
        success: false,
        error
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
          error
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
        error
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
          error
        };
      }
    } catch (verifyError: any) {
      const error = `Failed to verify saved file: ${verifyError.message}`;
      console.error("AI Video Save Error:", error);
      return {
        success: false,
        error
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
        fileSize: buffer.length
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

    console.log(`✅ AI Video saved successfully to disk: ${filePath} (${(buffer.length / 1024 / 1024).toFixed(2)}MB)`);

    return {
      success: true,
      localPath: filePath,
      fileName: finalFileName,
      fileSize: buffer.length
    };

  } catch (unexpectedError: any) {
    const error = `Unexpected error saving AI video: ${unexpectedError.message}`;
    console.error("AI Video Save CRITICAL ERROR:", error);
    return {
      success: false,
      error
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
  ipcMain.handle("ai-video:save-to-disk", async (event, options: SaveAIVideoOptions): Promise<SaveAIVideoResult> => {
    console.log("IPC: ai-video:save-to-disk called", {
      fileName: options.fileName,
      projectId: options.projectId,
      dataSize: options.fileData ? (options.fileData as any).byteLength || (options.fileData as Buffer).length : 0
    });

    const result = await saveAIVideoToDisk(options);

    // If save failed, this is CRITICAL - the operation must not continue
    if (!result.success) {
      console.error("🚨 CRITICAL: AI Video save to disk FAILED - Operation must be aborted", result.error);
    }

    return result;
  });

  // Verify file exists
  ipcMain.handle("ai-video:verify-file", async (event, filePath: string): Promise<boolean> => {
    return await verifyAIVideoFile(filePath);
  });

  // Delete file (for cleanup or user request)
  ipcMain.handle("ai-video:delete-file", async (event, filePath: string): Promise<boolean> => {
    return await deleteAIVideoFile(filePath);
  });

  // Get project videos directory
  ipcMain.handle("ai-video:get-project-dir", async (event, projectId: string): Promise<string> => {
    return path.join(
      app.getPath("userData"),
      "projects",
      sanitizeFilename(projectId),
      "ai-videos"
    );
  });

  console.log("✅ AI Video save handlers registered");
}