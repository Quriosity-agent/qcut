import { ipcMain, app } from "electron";
import * as fs from "fs/promises";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

/**
 * Options for importing media into a project.
 */
interface MediaImportOptions {
  /** Absolute path to the source file */
  sourcePath: string;
  /** Project ID to import into */
  projectId: string;
  /** Unique media ID for the imported file */
  mediaId: string;
  /** Whether to prefer symlinks over copies (default: true) */
  preferSymlink?: boolean;
}

/**
 * Result of a media import operation.
 */
interface MediaImportResult {
  /** Whether the import succeeded */
  success: boolean;
  /** Path to the imported file (symlink or copy) */
  targetPath: string;
  /** Method used for import */
  importMethod: "symlink" | "copy";
  /** Original source path */
  originalPath: string;
  /** File size in bytes */
  fileSize: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Logger interface compatible with electron-log.
 */
interface Logger {
  info(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
  debug(message?: unknown, ...optionalParams: unknown[]): void;
}

// ============================================================================
// Logger Setup
// ============================================================================

let log: Logger;
try {
  log = require("electron-log");
} catch {
  const noop = (): void => {};
  log = { info: noop, warn: noop, error: noop, debug: noop };
}

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Get the base path for QCut projects in the user's Documents folder.
 */
function getProjectsBasePath(): string {
  const documentsPath = app.getPath("documents");
  return path.join(documentsPath, "QCut", "Projects");
}

/**
 * Get the media folder path for a specific project.
 */
function getProjectMediaPath(projectId: string): string {
  return path.join(getProjectsBasePath(), projectId, "media", "imported");
}

/**
 * Sanitize a path segment to prevent path traversal attacks.
 * Removes slashes and parent directory references.
 */
function sanitizePathSegment(segment: string): string {
  return segment.replace(/[/\\]/g, "").replace(/\.\./g, "");
}

/**
 * Validate that a resolved path is within the allowed base directory.
 */
function isPathWithinBase(targetPath: string, basePath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(basePath);
  return (
    resolvedTarget.startsWith(resolvedBase + path.sep) ||
    resolvedTarget === resolvedBase
  );
}

/**
 * Get the file extension from a path, preserving the dot.
 */
function getExtension(filePath: string): string {
  const ext = path.extname(filePath);
  return ext.toLowerCase();
}

// ============================================================================
// Core Import Functions
// ============================================================================

/**
 * Attempt to create a symbolic link from source to target.
 * Returns true if successful, false if symlink creation failed.
 */
async function tryCreateSymlink(
  sourcePath: string,
  targetPath: string
): Promise<boolean> {
  try {
    // On Windows, use 'file' type for file symlinks
    // On Unix-like systems, the type is ignored
    await fs.symlink(sourcePath, targetPath, "file");
    log.info("[MediaImport] Created symlink:", { source: sourcePath, target: targetPath });
    return true;
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    // EPERM: Operation not permitted (Windows without admin/dev mode)
    // EACCES: Permission denied
    // EXDEV: Cross-device link (different drives/filesystems)
    if (err.code === "EPERM" || err.code === "EACCES" || err.code === "EXDEV") {
      log.warn("[MediaImport] Symlink failed, will fallback to copy:", err.code);
      return false;
    }
    // Re-throw unexpected errors
    throw error;
  }
}

/**
 * Copy a file from source to target.
 */
async function copyFile(sourcePath: string, targetPath: string): Promise<void> {
  await fs.copyFile(sourcePath, targetPath);
  log.info("[MediaImport] Copied file:", { source: sourcePath, target: targetPath });
}

/**
 * Import a media file into the project using symlink with copy fallback.
 */
async function importMedia(options: MediaImportOptions): Promise<MediaImportResult> {
  const { sourcePath, projectId, mediaId, preferSymlink = true } = options;

  // Validate inputs
  const sanitizedProjectId = sanitizePathSegment(projectId);
  const sanitizedMediaId = sanitizePathSegment(mediaId);

  if (!sanitizedProjectId || !sanitizedMediaId) {
    return {
      success: false,
      targetPath: "",
      importMethod: "copy",
      originalPath: sourcePath,
      fileSize: 0,
      error: "Invalid project ID or media ID",
    };
  }

  // Verify source file exists and get its stats
  let fileStats: Awaited<ReturnType<typeof fs.stat>>;
  try {
    fileStats = await fs.stat(sourcePath);
    if (!fileStats.isFile()) {
      return {
        success: false,
        targetPath: "",
        importMethod: "copy",
        originalPath: sourcePath,
        fileSize: 0,
        error: "Source path is not a file",
      };
    }
  } catch {
    return {
      success: false,
      targetPath: "",
      importMethod: "copy",
      originalPath: sourcePath,
      fileSize: 0,
      error: "Source file does not exist or is not accessible",
    };
  }

  // Create target directory
  const mediaDir = getProjectMediaPath(sanitizedProjectId);
  try {
    await fs.mkdir(mediaDir, { recursive: true });
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    return {
      success: false,
      targetPath: "",
      importMethod: "copy",
      originalPath: sourcePath,
      fileSize: 0,
      error: `Failed to create media directory: ${err.message}`,
    };
  }

  // Build target path with original extension
  const extension = getExtension(sourcePath);
  const targetPath = path.join(mediaDir, `${sanitizedMediaId}${extension}`);

  // Security: verify target is within project directory
  const projectsBase = getProjectsBasePath();
  if (!isPathWithinBase(targetPath, projectsBase)) {
    return {
      success: false,
      targetPath: "",
      importMethod: "copy",
      originalPath: sourcePath,
      fileSize: 0,
      error: "Security: target path escapes project directory",
    };
  }

  // Remove existing file/symlink if it exists
  try {
    await fs.unlink(targetPath);
    log.debug("[MediaImport] Removed existing file at target path");
  } catch {
    // File doesn't exist, which is fine
  }

  // Attempt import
  let importMethod: "symlink" | "copy" = "copy";

  if (preferSymlink) {
    let symlinkSuccess = false;
    try {
      symlinkSuccess = await tryCreateSymlink(sourcePath, targetPath);
    } catch (error: unknown) {
      // Handle unexpected symlink errors to maintain IPC contract
      const err = error as NodeJS.ErrnoException;
      log.error("[MediaImport] Unexpected symlink error:", err.message);
      return {
        success: false,
        targetPath: "",
        importMethod: "symlink",
        originalPath: sourcePath,
        fileSize: 0,
        error: `Symlink creation failed unexpectedly: ${err.message}`,
      };
    }

    if (symlinkSuccess) {
      importMethod = "symlink";
    } else {
      // Fallback to copy
      try {
        await copyFile(sourcePath, targetPath);
        importMethod = "copy";
      } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException;
        return {
          success: false,
          targetPath: "",
          importMethod: "copy",
          originalPath: sourcePath,
          fileSize: 0,
          error: `Failed to copy file: ${err.message}`,
        };
      }
    }
  } else {
    // User prefers copy
    try {
      await copyFile(sourcePath, targetPath);
      importMethod = "copy";
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      return {
        success: false,
        targetPath: "",
        importMethod: "copy",
        originalPath: sourcePath,
        fileSize: 0,
        error: `Failed to copy file: ${err.message}`,
      };
    }
  }

  log.info("[MediaImport] Successfully imported media:", {
    mediaId: sanitizedMediaId,
    method: importMethod,
    size: fileStats.size,
  });

  return {
    success: true,
    targetPath,
    importMethod,
    originalPath: sourcePath,
    fileSize: fileStats.size,
  };
}

/**
 * Validate whether a symlink at the given path is valid (target exists).
 */
async function validateSymlink(symlinkPath: string): Promise<boolean> {
  try {
    const stats = await fs.lstat(symlinkPath);
    if (!stats.isSymbolicLink()) {
      // Not a symlink, but file exists - consider valid
      return true;
    }
    // Check if symlink target exists
    await fs.stat(symlinkPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the original path that a symlink points to.
 * Returns null if the path is not a symlink or cannot be read.
 */
async function locateOriginal(mediaPath: string): Promise<string | null> {
  try {
    const stats = await fs.lstat(mediaPath);
    if (!stats.isSymbolicLink()) {
      return null;
    }
    const target = await fs.readlink(mediaPath);
    // Resolve relative symlinks to absolute paths
    if (!path.isAbsolute(target)) {
      return path.resolve(path.dirname(mediaPath), target);
    }
    return target;
  } catch {
    return null;
  }
}

/**
 * Re-link a media file to a new source path.
 * Used when the original file has been moved.
 */
async function relinkMedia(
  projectId: string,
  mediaId: string,
  newSourcePath: string
): Promise<MediaImportResult> {
  // Simply re-import with the new source path
  return importMedia({
    sourcePath: newSourcePath,
    projectId,
    mediaId,
    preferSymlink: true,
  });
}

/**
 * Remove an imported media file (symlink or copy).
 * Does NOT delete the original file for symlinks.
 */
async function removeImportedMedia(
  projectId: string,
  mediaId: string
): Promise<void> {
  const sanitizedProjectId = sanitizePathSegment(projectId);
  const sanitizedMediaId = sanitizePathSegment(mediaId);

  if (!sanitizedProjectId || !sanitizedMediaId) {
    throw new Error("Invalid project ID or media ID");
  }

  const mediaDir = getProjectMediaPath(sanitizedProjectId);

  // Find the file with any extension
  try {
    const files = await fs.readdir(mediaDir);
    const matchingFile = files.find((f) => f.startsWith(sanitizedMediaId + "."));

    if (matchingFile) {
      const filePath = path.join(mediaDir, matchingFile);

      // Security check
      if (!isPathWithinBase(filePath, getProjectsBasePath())) {
        throw new Error("Security: path escapes project directory");
      }

      await fs.unlink(filePath);
      log.info("[MediaImport] Removed imported media:", filePath);
    }
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
    // Directory doesn't exist, nothing to remove
  }
}

/**
 * Check if symlinks are supported on the current system.
 * Attempts to create a test symlink in temp directory.
 */
async function checkSymlinkSupport(): Promise<boolean> {
  const tempDir = app.getPath("temp");
  const testSource = path.join(tempDir, `qcut-symlink-test-source-${Date.now()}`);
  const testLink = path.join(tempDir, `qcut-symlink-test-link-${Date.now()}`);

  try {
    // Create a test file
    await fs.writeFile(testSource, "test");

    // Try to create a symlink
    await fs.symlink(testSource, testLink, "file");

    // Cleanup
    await fs.unlink(testLink);
    await fs.unlink(testSource);

    log.info("[MediaImport] Symlink support: available");
    return true;
  } catch {
    // Cleanup source file if it was created
    try {
      await fs.unlink(testSource);
    } catch {
      // Ignore cleanup errors
    }

    log.info("[MediaImport] Symlink support: not available");
    return false;
  }
}

// ============================================================================
// IPC Handler Setup
// ============================================================================

/**
 * Set up IPC handlers for media import operations.
 * Call this in app.whenReady() in main.ts.
 */
export function setupMediaImportIPC(): void {
  log.info("[MediaImport] Setting up IPC handlers...");

  // Import media with symlink/copy fallback
  ipcMain.handle(
    "media-import:import",
    async (_, options: MediaImportOptions): Promise<MediaImportResult> => {
      return importMedia(options);
    }
  );

  // Validate a symlink (check if target exists)
  ipcMain.handle(
    "media-import:validate-symlink",
    async (_, symlinkPath: string): Promise<boolean> => {
      return validateSymlink(symlinkPath);
    }
  );

  // Get the original path of a symlink
  ipcMain.handle(
    "media-import:locate-original",
    async (_, mediaPath: string): Promise<string | null> => {
      return locateOriginal(mediaPath);
    }
  );

  // Re-link media to a new source
  ipcMain.handle(
    "media-import:relink",
    async (
      _,
      projectId: string,
      mediaId: string,
      newSourcePath: string
    ): Promise<MediaImportResult> => {
      return relinkMedia(projectId, mediaId, newSourcePath);
    }
  );

  // Remove imported media
  ipcMain.handle(
    "media-import:remove",
    async (_, projectId: string, mediaId: string): Promise<void> => {
      return removeImportedMedia(projectId, mediaId);
    }
  );

  // Check symlink support on system
  ipcMain.handle(
    "media-import:check-symlink-support",
    async (): Promise<boolean> => {
      return checkSymlinkSupport();
    }
  );

  // Get the project media path
  ipcMain.handle(
    "media-import:get-media-path",
    async (_, projectId: string): Promise<string> => {
      return getProjectMediaPath(sanitizePathSegment(projectId));
    }
  );

  log.info("[MediaImport] IPC handlers registered");
}

// Export for CommonJS compatibility
module.exports = { setupMediaImportIPC };
