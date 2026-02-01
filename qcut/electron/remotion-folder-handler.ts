/**
 * Remotion Folder Handler
 *
 * Provides IPC handlers for loading and managing Remotion project folders.
 * Enables scanning, parsing compositions, and bundling components for
 * integration with the QCut timeline.
 *
 * @module electron/remotion-folder-handler
 */

import { ipcMain, dialog, BrowserWindow } from "electron";
import * as path from "path";
import * as fs from "fs/promises";
import {
  isRemotionProject,
  findRootFile,
  parseRemotionProject,
  type CompositionInfo,
  type ParseResult,
} from "./remotion-composition-parser";
import {
  bundleComposition,
  bundleCompositions,
  isEsbuildAvailable,
  type BundleResult,
  type BundleAllResult,
} from "./remotion-bundler";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of selecting a Remotion folder via dialog.
 */
export interface FolderSelectResult {
  /** Whether selection was successful */
  success: boolean;
  /** Selected folder path (if successful) */
  folderPath?: string;
  /** Whether user cancelled the dialog */
  cancelled?: boolean;
  /** Error message if selection failed */
  error?: string;
}

/**
 * Result of scanning a Remotion project folder.
 */
export interface FolderScanResult {
  /** Whether the folder is a valid Remotion project */
  isValid: boolean;
  /** Path to the Root.tsx or equivalent file */
  rootFilePath: string | null;
  /** Detected compositions */
  compositions: CompositionInfo[];
  /** Any errors encountered during parsing */
  errors: string[];
  /** Folder path that was scanned */
  folderPath: string;
}

/**
 * Result of bundling compositions from a folder.
 */
export interface FolderBundleResult {
  /** Overall success (true if all succeeded) */
  success: boolean;
  /** Individual bundle results */
  results: BundleResult[];
  /** Number of successful bundles */
  successCount: number;
  /** Number of failed bundles */
  errorCount: number;
  /** Folder path that was bundled */
  folderPath: string;
}

/**
 * Combined result of folder import (scan + bundle).
 */
export interface FolderImportResult {
  /** Whether import was successful */
  success: boolean;
  /** Scan result with composition metadata */
  scan: FolderScanResult;
  /** Bundle result with compiled code */
  bundle: FolderBundleResult | null;
  /** Total import time in milliseconds */
  importTime: number;
  /** Error message if import failed */
  error?: string;
}

// ============================================================================
// Logger Setup
// ============================================================================

interface Logger {
  info(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
  debug(message?: unknown, ...optionalParams: unknown[]): void;
}

let log: Logger;
try {
  log = require("electron-log");
} catch {
  const noop = (): void => {};
  log = { info: noop, warn: noop, error: noop, debug: noop };
}

const LOG_PREFIX = "[RemotionFolder]";

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Validate that a path exists and is a directory.
 */
async function validateDirectory(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if esbuild is available for bundling.
 */
async function checkBundlerAvailable(): Promise<boolean> {
  return isEsbuildAvailable();
}

// ============================================================================
// IPC Handlers
// ============================================================================

/**
 * Register Remotion folder IPC handlers.
 * Call this function during app initialization.
 */
export function setupRemotionFolderIPC(): void {
  log.info(`${LOG_PREFIX} Registering IPC handlers`);

  // -------------------------------------------------------------------------
  // Open folder selection dialog
  // -------------------------------------------------------------------------
  ipcMain.handle(
    "remotion-folder:select",
    async (): Promise<FolderSelectResult> => {
      log.info(`${LOG_PREFIX} Opening folder selection dialog`);

      try {
        const mainWindow = BrowserWindow.getFocusedWindow();
        const dialogOptions: Electron.OpenDialogOptions = {
          title: "Select Remotion Project Folder",
          properties: ["openDirectory"],
          buttonLabel: "Import",
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, dialogOptions)
          : await dialog.showOpenDialog(dialogOptions);

        if (result.canceled || result.filePaths.length === 0) {
          log.info(`${LOG_PREFIX} Folder selection cancelled`);
          return { success: false, cancelled: true };
        }

        const folderPath = result.filePaths[0];
        log.info(`${LOG_PREFIX} Selected folder: ${folderPath}`);

        // Validate it's a directory
        const isDir = await validateDirectory(folderPath);
        if (!isDir) {
          return {
            success: false,
            error: "Selected path is not a directory",
          };
        }

        // Check if it's a valid Remotion project
        const isValid = await isRemotionProject(folderPath);
        if (!isValid) {
          log.warn(`${LOG_PREFIX} Selected folder is not a Remotion project`);
          return {
            success: false,
            folderPath,
            error:
              "Not a valid Remotion project. Ensure package.json contains 'remotion' dependency and Root.tsx exists.",
          };
        }

        return { success: true, folderPath };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`${LOG_PREFIX} Folder selection error:`, error);
        return { success: false, error: message };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Scan a Remotion project folder
  // -------------------------------------------------------------------------
  ipcMain.handle(
    "remotion-folder:scan",
    async (_, folderPath: string): Promise<FolderScanResult> => {
      log.info(`${LOG_PREFIX} Scanning folder: ${folderPath}`);

      try {
        // Validate directory exists
        const isDir = await validateDirectory(folderPath);
        if (!isDir) {
          return {
            isValid: false,
            rootFilePath: null,
            compositions: [],
            errors: ["Folder does not exist or is not a directory"],
            folderPath,
          };
        }

        // Parse the Remotion project
        const parseResult = await parseRemotionProject(folderPath);

        log.info(
          `${LOG_PREFIX} Scan complete: ${parseResult.compositions.length} compositions found`
        );

        return {
          isValid: parseResult.isValid,
          rootFilePath: parseResult.rootFilePath,
          compositions: parseResult.compositions,
          errors: parseResult.errors,
          folderPath,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`${LOG_PREFIX} Scan error:`, error);
        return {
          isValid: false,
          rootFilePath: null,
          compositions: [],
          errors: [`Scan failed: ${message}`],
          folderPath,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Bundle compositions from a folder
  // -------------------------------------------------------------------------
  ipcMain.handle(
    "remotion-folder:bundle",
    async (
      _,
      folderPath: string,
      compositionIds?: string[]
    ): Promise<FolderBundleResult> => {
      log.info(`${LOG_PREFIX} Bundling folder: ${folderPath}`);

      try {
        // Check if bundler is available
        const bundlerAvailable = await checkBundlerAvailable();
        if (!bundlerAvailable) {
          return {
            success: false,
            results: [],
            successCount: 0,
            errorCount: 0,
            folderPath,
          };
        }

        // First scan to get compositions
        const parseResult = await parseRemotionProject(folderPath);
        if (!parseResult.isValid) {
          return {
            success: false,
            results: [],
            successCount: 0,
            errorCount: 1,
            folderPath,
          };
        }

        // Filter compositions if IDs are specified
        let compositionsToBundle = parseResult.compositions;
        if (compositionIds && compositionIds.length > 0) {
          compositionsToBundle = compositionsToBundle.filter((c) =>
            compositionIds.includes(c.id)
          );
        }

        if (compositionsToBundle.length === 0) {
          log.warn(`${LOG_PREFIX} No compositions to bundle`);
          return {
            success: true,
            results: [],
            successCount: 0,
            errorCount: 0,
            folderPath,
          };
        }

        // Bundle all compositions
        const bundleResult = await bundleCompositions(
          compositionsToBundle,
          folderPath
        );

        log.info(
          `${LOG_PREFIX} Bundle complete: ${bundleResult.successCount} success, ${bundleResult.errorCount} errors`
        );

        return {
          success: bundleResult.success,
          results: bundleResult.results,
          successCount: bundleResult.successCount,
          errorCount: bundleResult.errorCount,
          folderPath,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`${LOG_PREFIX} Bundle error:`, error);
        return {
          success: false,
          results: [],
          successCount: 0,
          errorCount: 1,
          folderPath,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Full import: scan + bundle in one operation
  // -------------------------------------------------------------------------
  ipcMain.handle(
    "remotion-folder:import",
    async (_, folderPath: string): Promise<FolderImportResult> => {
      const startTime = Date.now();
      log.info(`${LOG_PREFIX} Starting full import: ${folderPath}`);

      try {
        // Step 1: Scan the project
        const scanResult: FolderScanResult = {
          isValid: false,
          rootFilePath: null,
          compositions: [],
          errors: [],
          folderPath,
        };

        const isDir = await validateDirectory(folderPath);
        if (!isDir) {
          scanResult.errors.push("Folder does not exist or is not a directory");
          return {
            success: false,
            scan: scanResult,
            bundle: null,
            importTime: Date.now() - startTime,
            error: "Invalid folder path",
          };
        }

        const parseResult = await parseRemotionProject(folderPath);
        scanResult.isValid = parseResult.isValid;
        scanResult.rootFilePath = parseResult.rootFilePath;
        scanResult.compositions = parseResult.compositions;
        scanResult.errors = parseResult.errors;

        if (!parseResult.isValid) {
          return {
            success: false,
            scan: scanResult,
            bundle: null,
            importTime: Date.now() - startTime,
            error: "Not a valid Remotion project",
          };
        }

        // Step 2: Bundle all compositions
        let bundleResult: FolderBundleResult | null = null;
        const bundlerAvailable = await checkBundlerAvailable();

        if (bundlerAvailable && parseResult.compositions.length > 0) {
          const bundled = await bundleCompositions(
            parseResult.compositions,
            folderPath
          );
          bundleResult = {
            success: bundled.success,
            results: bundled.results,
            successCount: bundled.successCount,
            errorCount: bundled.errorCount,
            folderPath,
          };
        }

        const importTime = Date.now() - startTime;
        log.info(`${LOG_PREFIX} Import complete in ${importTime}ms`);

        return {
          success: true,
          scan: scanResult,
          bundle: bundleResult,
          importTime,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`${LOG_PREFIX} Import error:`, error);
        return {
          success: false,
          scan: {
            isValid: false,
            rootFilePath: null,
            compositions: [],
            errors: [message],
            folderPath,
          },
          bundle: null,
          importTime: Date.now() - startTime,
          error: message,
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // Check if bundler is available
  // -------------------------------------------------------------------------
  ipcMain.handle(
    "remotion-folder:check-bundler",
    async (): Promise<{ available: boolean }> => {
      const available = await checkBundlerAvailable();
      return { available };
    }
  );

  // -------------------------------------------------------------------------
  // Validate a folder is a Remotion project
  // -------------------------------------------------------------------------
  ipcMain.handle(
    "remotion-folder:validate",
    async (_, folderPath: string): Promise<{ isValid: boolean; error?: string }> => {
      try {
        const isDir = await validateDirectory(folderPath);
        if (!isDir) {
          return { isValid: false, error: "Path is not a directory" };
        }

        const isValid = await isRemotionProject(folderPath);
        if (!isValid) {
          return {
            isValid: false,
            error: "Not a valid Remotion project",
          };
        }

        return { isValid: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { isValid: false, error: message };
      }
    }
  );

  log.info(`${LOG_PREFIX} IPC handlers registered`);
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = { setupRemotionFolderIPC };
export default { setupRemotionFolderIPC };
