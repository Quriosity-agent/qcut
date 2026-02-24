/**
 * Types for component loader.
 * @module lib/remotion/component-loader/types
 */

import type { RemotionComponentCategory } from "../types";
import type {
	ComponentMetadata,
	ValidationResult,
} from "../component-validator";
import type { AnalysisResult } from "../sequence-analysis-service";

// ============================================================================
// Load Types
// ============================================================================

/**
 * Result of loading a component
 */
export interface LoadResult {
	/** Whether loading was successful */
	success: boolean;
	/** The loaded component definition */
	component?: import("../types").RemotionComponentDefinition;
	/** Error message if loading failed */
	error?: string;
	/** Validation result */
	validation?: ValidationResult;
	/** Sequence analysis result (for imported components) */
	analysisResult?: AnalysisResult;
}

/**
 * Options for loading a component
 */
export interface LoadOptions {
	/** Whether to run in sandboxed mode */
	sandbox?: boolean;
	/** Whether to generate a thumbnail */
	generateThumbnail?: boolean;
	/** Whether to store in IndexedDB */
	storeInDB?: boolean;
	/** Custom ID to use (generated if not provided) */
	customId?: string;
}

/**
 * Stored component data in IndexedDB
 */
export interface StoredComponent {
	/** Component ID */
	id: string;
	/** Original file name */
	fileName: string;
	/** Component source code */
	sourceCode: string;
	/** Component metadata */
	metadata: ComponentMetadata;
	/** Thumbnail data URL if available */
	thumbnail?: string;
	/** When the component was imported */
	importedAt: number;
	/** When the component was last updated */
	updatedAt: number;
}

/**
 * Default load options
 */
export const DEFAULT_LOAD_OPTIONS: LoadOptions = {
	sandbox: true,
	generateThumbnail: false,
	storeInDB: true,
};

// ============================================================================
// Folder Import Types
// ============================================================================

/**
 * Result of loading components from a Remotion folder
 */
export interface FolderLoadResult {
	success: boolean;
	components: import("../types").RemotionComponentDefinition[];
	successCount: number;
	errorCount: number;
	folderPath: string;
	errors: string[];
	importTime?: number;
}

/**
 * Composition info from folder scan (matches Electron IPC types)
 */
export interface FolderCompositionInfo {
	id: string;
	name: string;
	durationInFrames: number;
	fps: number;
	width: number;
	height: number;
	componentPath: string;
	importPath: string;
	line: number;
}

/**
 * Bundle result from folder import
 */
export interface FolderBundleResult {
	compositionId: string;
	success: boolean;
	code?: string;
	sourceMap?: string;
	error?: string;
}

/**
 * Result of loading stored components
 */
export interface LoadStoredComponentsResult {
	definition: import("../types").RemotionComponentDefinition;
	sourceCode: string;
	analysisResult?: AnalysisResult;
}
