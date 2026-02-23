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
			console.log(`${LOG_PREFIX} 📂 Opening folder selection dialog...`);
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
					console.log(`${LOG_PREFIX} ❌ Folder selection cancelled by user`);
					log.info(`${LOG_PREFIX} Folder selection cancelled`);
					return { success: false, cancelled: true };
				}

				const folderPath = result.filePaths[0];
				console.log(`${LOG_PREFIX} 📁 Selected folder: ${folderPath}`);
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
				console.log(`${LOG_PREFIX} 🔍 Validating Remotion project...`);
				const isValid = await isRemotionProject(folderPath);
				if (!isValid) {
					console.log(`${LOG_PREFIX} ⚠️ Not a valid Remotion project`);
					log.warn(`${LOG_PREFIX} Selected folder is not a Remotion project`);
					return {
						success: false,
						folderPath,
						error:
							"Not a valid Remotion project. Ensure package.json contains 'remotion' dependency and Root.tsx exists.",
					};
				}

				console.log(`${LOG_PREFIX} ✅ Valid Remotion project detected`);
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
			console.log(`${LOG_PREFIX} 🔎 Scanning folder: ${folderPath}`);
			log.info(`${LOG_PREFIX} Scanning folder: ${folderPath}`);

			try {
				// Validate directory exists
				const isDir = await validateDirectory(folderPath);
				if (!isDir) {
					console.log(
						`${LOG_PREFIX} ❌ Folder does not exist or is not a directory`
					);
					return {
						isValid: false,
						rootFilePath: null,
						compositions: [],
						errors: ["Folder does not exist or is not a directory"],
						folderPath,
					};
				}

				// Parse the Remotion project
				console.log(`${LOG_PREFIX} 📄 Parsing Root.tsx for compositions...`);
				const parseResult = await parseRemotionProject(folderPath);

				console.log(
					`${LOG_PREFIX} ✅ Scan complete: Found ${parseResult.compositions.length} composition(s)`
				);
				if (parseResult.compositions.length > 0) {
					console.log(
						`${LOG_PREFIX} 📋 Compositions: ${parseResult.compositions.map((c) => c.id).join(", ")}`
					);
				}
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
			console.log(`${LOG_PREFIX} 📦 Bundling folder: ${folderPath}`);
			log.info(`${LOG_PREFIX} Bundling folder: ${folderPath}`);

			try {
				// Check if bundler is available
				console.log(`${LOG_PREFIX} 🔧 Checking esbuild availability...`);
				const bundlerAvailable = await checkBundlerAvailable();
				if (!bundlerAvailable) {
					console.log(`${LOG_PREFIX} ⚠️ esbuild bundler not available`);
					return {
						success: false,
						results: [],
						successCount: 0,
						errorCount: 0,
						folderPath,
					};
				}
				console.log(`${LOG_PREFIX} ✅ esbuild bundler available`);

				// First scan to get compositions
				console.log(`${LOG_PREFIX} 🔎 Scanning for compositions...`);
				const parseResult = await parseRemotionProject(folderPath);
				if (!parseResult.isValid) {
					console.log(`${LOG_PREFIX} ❌ Invalid Remotion project`);
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
					console.log(
						`${LOG_PREFIX} 🎯 Filtering to ${compositionsToBundle.length} composition(s)`
					);
				}

				if (compositionsToBundle.length === 0) {
					console.log(`${LOG_PREFIX} ⚠️ No compositions to bundle`);
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
				console.log(
					`${LOG_PREFIX} ⚙️ Bundling ${compositionsToBundle.length} composition(s)...`
				);
				const bundleResult = await bundleCompositions(
					compositionsToBundle,
					folderPath
				);

				console.log(
					`${LOG_PREFIX} ✅ Bundle complete: ${bundleResult.successCount} success, ${bundleResult.errorCount} errors`
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
			console.log(`${LOG_PREFIX} 🚀 Starting full import: ${folderPath}`);
			log.info(`${LOG_PREFIX} Starting full import: ${folderPath}`);

			try {
				// Step 1: Scan the project
				console.log(`${LOG_PREFIX} 📂 Step 1/3: Validating folder...`);
				const scanResult: FolderScanResult = {
					isValid: false,
					rootFilePath: null,
					compositions: [],
					errors: [],
					folderPath,
				};

				const isDir = await validateDirectory(folderPath);
				if (!isDir) {
					console.log(
						`${LOG_PREFIX} ❌ Folder does not exist or is not a directory`
					);
					scanResult.errors.push("Folder does not exist or is not a directory");
					return {
						success: false,
						scan: scanResult,
						bundle: null,
						importTime: Date.now() - startTime,
						error: "Invalid folder path",
					};
				}

				console.log(`${LOG_PREFIX} 🔎 Step 2/3: Scanning for compositions...`);
				const parseResult = await parseRemotionProject(folderPath);
				scanResult.isValid = parseResult.isValid;
				scanResult.rootFilePath = parseResult.rootFilePath;
				scanResult.compositions = parseResult.compositions;
				scanResult.errors = parseResult.errors;

				if (!parseResult.isValid) {
					console.log(`${LOG_PREFIX} ❌ Not a valid Remotion project`);
					return {
						success: false,
						scan: scanResult,
						bundle: null,
						importTime: Date.now() - startTime,
						error: "Not a valid Remotion project",
					};
				}

				console.log(
					`${LOG_PREFIX} ✅ Found ${parseResult.compositions.length} composition(s): ${parseResult.compositions.map((c) => c.id).join(", ")}`
				);

				// Step 2: Bundle all compositions
				console.log(`${LOG_PREFIX} 📦 Step 3/3: Bundling compositions...`);
				let bundleResult: FolderBundleResult | null = null;
				const bundlerAvailable = await checkBundlerAvailable();

				if (bundlerAvailable && parseResult.compositions.length > 0) {
					console.log(`${LOG_PREFIX} ⚙️ Bundling with esbuild...`);
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
					console.log(
						`${LOG_PREFIX} ✅ Bundled ${bundled.successCount} composition(s)`
					);
				} else if (!bundlerAvailable) {
					console.log(
						`${LOG_PREFIX} ⚠️ esbuild not available, skipping bundling`
					);
				}

				const importTime = Date.now() - startTime;
				console.log(`${LOG_PREFIX} 🎉 Import complete in ${importTime}ms`);
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
		async (
			_,
			folderPath: string
		): Promise<{ isValid: boolean; error?: string }> => {
			console.log(`${LOG_PREFIX} 🔍 Validating folder: ${folderPath}`);
			try {
				const isDir = await validateDirectory(folderPath);
				if (!isDir) {
					console.log(`${LOG_PREFIX} ❌ Path is not a directory`);
					return { isValid: false, error: "Path is not a directory" };
				}

				const isValid = await isRemotionProject(folderPath);
				if (!isValid) {
					console.log(`${LOG_PREFIX} ❌ Not a valid Remotion project`);
					return {
						isValid: false,
						error: "Not a valid Remotion project",
					};
				}

				console.log(`${LOG_PREFIX} ✅ Valid Remotion project`);
				return { isValid: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.log(`${LOG_PREFIX} ❌ Validation error: ${message}`);
				return { isValid: false, error: message };
			}
		}
	);

	// -------------------------------------------------------------------------
	// Bundle a single .tsx file (no Root.tsx or folder scanning needed)
	// -------------------------------------------------------------------------
	ipcMain.handle(
		"remotion-file:bundle",
		async (
			_,
			filePath: string,
			compositionId: string
		): Promise<BundleResult> => {
			console.log(
				`${LOG_PREFIX} 📦 Bundling single file: ${filePath} (${compositionId})`
			);
			log.info(`${LOG_PREFIX} Bundling single file: ${filePath}`);

			try {
				const bundlerAvailable = await checkBundlerAvailable();
				if (!bundlerAvailable) {
					return {
						compositionId,
						success: false,
						error: "esbuild bundler not available",
					};
				}

				// Verify file exists
				try {
					await fs.access(filePath);
				} catch {
					return {
						compositionId,
						success: false,
						error: `File not found: ${filePath}`,
					};
				}

				const composition: CompositionInfo = {
					id: compositionId,
					name: compositionId,
					durationInFrames: 150,
					fps: 30,
					width: 1920,
					height: 1080,
					componentPath: filePath,
					importPath: filePath,
					line: 0,
				};

				const folderPath = path.dirname(filePath);
				const result = await bundleComposition(composition, folderPath);

				console.log(
					`${LOG_PREFIX} ${result.success ? "✅" : "❌"} Bundle result for ${compositionId}: ${result.success ? "success" : result.error}`
				);
				return result;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				log.error(`${LOG_PREFIX} Single file bundle error:`, error);
				return {
					compositionId,
					success: false,
					error: message,
				};
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
