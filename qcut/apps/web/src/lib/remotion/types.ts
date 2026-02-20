/**
 * Remotion Integration Type Definitions
 *
 * This file contains all TypeScript interfaces for the QCut-Remotion integration.
 * These types define the structure for Remotion components, instances, caching,
 * and render jobs within the QCut video editor.
 *
 * @module lib/remotion/types
 */

import type { PlayerRef } from "@remotion/player";
import type { z } from "zod";

// ============================================================================
// Sequence Visualization Types
// ============================================================================

/**
 * Metadata describing a single sequence within a Remotion composition.
 * Used for visualizing internal structure in the timeline.
 */
export interface SequenceMetadata {
	/** Human-readable name for the sequence */
	name: string;
	/** Frame at which this sequence starts (relative to composition) */
	from: number;
	/** Duration of the sequence in frames */
	durationInFrames: number;
	/** Color for timeline visualization (hex format) */
	color?: string;
	/** Optional description for tooltips */
	description?: string;
}

/**
 * Metadata describing a transition between sequences.
 * Used for TransitionSeries components.
 */
export interface TransitionMetadata {
	/** Index of the sequence this transition follows (0-based) */
	afterSequenceIndex: number;
	/** Duration of the transition overlap in frames */
	durationInFrames: number;
	/** Type of transition presentation */
	presentation?: "fade" | "slide" | "wipe" | "zoom" | "custom";
}

/**
 * Complete structure describing sequences and transitions within a composition.
 * Enables timeline visualization of internal component structure.
 */
export interface SequenceStructure {
	/** List of sequences in order */
	sequences: SequenceMetadata[];
	/** Optional transitions between sequences */
	transitions?: TransitionMetadata[];
	/** Pre-calculated total duration (sequences - transitions overlap) */
	calculatedDuration?: number;
}

// ============================================================================
// Component Definition Types
// ============================================================================

/**
 * Categories for organizing Remotion components in the UI
 */
export type RemotionComponentCategory =
	| "animation"
	| "scene"
	| "effect"
	| "template"
	| "transition"
	| "text"
	| "intro"
	| "social"
	| "custom";

/**
 * Complete definition of a Remotion component that can be used in QCut.
 * This includes metadata, the React component itself, and validation schema.
 */
export interface RemotionComponentDefinition {
	/** Unique identifier for the component */
	id: string;
	/** Human-readable name displayed in UI */
	name: string;
	/** Description of what the component does */
	description?: string;
	/** Category for organizing in component browser */
	category: RemotionComponentCategory;
	/** Default duration in frames */
	durationInFrames: number;
	/** Frames per second (should match QCut project) */
	fps: number;
	/** Component width in pixels */
	width: number;
	/** Component height in pixels */
	height: number;
	/** Zod schema for validating and generating prop editors */
	schema: z.ZodSchema;
	/** Default prop values */
	defaultProps: Record<string, unknown>;
	/** Base64 or URL for thumbnail preview */
	thumbnail?: string;
	/** The actual React component */
	component: React.ComponentType<Record<string, unknown>>;
	/** Source of the component */
	source: "built-in" | "imported" | "custom";
	/** Tags for search/filtering */
	tags?: string[];
	/** Version of the component */
	version?: string;
	/** Author information */
	author?: string;
	/** Optional sequence structure for timeline visualization */
	sequenceStructure?: SequenceStructure;
	/** Original folder path for folder-imported components */
	folderPath?: string;
}

/**
 * Minimal component metadata without the actual React component.
 * Used for serialization and storage.
 */
export interface RemotionComponentMetadata {
	id: string;
	name: string;
	description?: string;
	category: RemotionComponentCategory;
	durationInFrames: number;
	fps: number;
	width: number;
	height: number;
	defaultProps: Record<string, unknown>;
	thumbnail?: string;
	source: "built-in" | "imported" | "custom";
	tags?: string[];
	version?: string;
	author?: string;
}

// ============================================================================
// Timeline Element Types
// ============================================================================

/**
 * Data stored in a Remotion timeline element.
 * This is the Remotion-specific data within a timeline element.
 */
export interface RemotionElementData {
	/** ID of the Remotion component being used */
	componentId: string;
	/** Optional path to the .tsx source file for imported components */
	componentPath?: string;
	/** Props to pass to the Remotion component */
	props: Record<string, unknown>;
	/** Rendering mode: live for preview, cached for export */
	renderMode: "live" | "cached";
}

// ============================================================================
// Instance Management Types
// ============================================================================

/**
 * Cache status for a Remotion instance
 */
export type CacheStatus = "none" | "partial" | "complete";

/**
 * Runtime instance of a Remotion component on the timeline.
 * Tracks the player ref, current state, and cache status.
 */
export interface RemotionInstance {
	/** ID of the timeline element this instance belongs to */
	elementId: string;
	/** ID of the Remotion component definition */
	componentId: string;
	/** Reference to the Remotion Player for imperative control */
	playerRef: PlayerRef | null;
	/** Current frame within the component (local frame, not global timeline) */
	localFrame: number;
	/** Current props being used */
	props: Record<string, unknown>;
	/** Status of frame caching for this instance */
	cacheStatus: CacheStatus;
	/** Whether the instance is currently playing */
	isPlaying: boolean;
	/** Playback rate multiplier */
	playbackRate: number;
	/** Error state if rendering failed */
	error?: RemotionError;
}

// ============================================================================
// Frame Caching Types
// ============================================================================

/**
 * A single cached frame entry.
 * Uses ImageBitmap for efficient GPU-accelerated rendering.
 */
export interface FrameCacheEntry {
	/** Frame number within the component */
	frame: number;
	/** Cached frame data as ImageBitmap for efficient rendering */
	imageData: ImageBitmap;
	/** Timestamp when this frame was cached */
	timestamp: number;
	/** Size in bytes for cache management */
	sizeBytes: number;
}

/**
 * Cache key components for frame lookup
 */
export interface FrameCacheKey {
	elementId: string;
	frame: number;
	propsHash: string;
}

/**
 * Statistics about the frame cache
 */
export interface FrameCacheStats {
	/** Total entries in cache */
	entryCount: number;
	/** Total size in bytes */
	totalSizeBytes: number;
	/** Maximum allowed size in bytes */
	maxSizeBytes: number;
	/** Cache hit rate (0-1) */
	hitRate: number;
	/** Number of cache hits */
	hits: number;
	/** Number of cache misses */
	misses: number;
}

// ============================================================================
// Render Job Types
// ============================================================================

/**
 * Status of a render job
 */
export type RenderJobStatus =
	| "pending"
	| "rendering"
	| "complete"
	| "error"
	| "cancelled";

/**
 * A job in the render queue for pre-rendering Remotion elements.
 * Used primarily during export to render frames to disk.
 */
export interface RenderJob {
	/** Unique job identifier */
	id: string;
	/** ID of the timeline element being rendered */
	elementId: string;
	/** ID of the Remotion component */
	componentId: string;
	/** Starting frame to render */
	startFrame: number;
	/** Ending frame to render (exclusive) */
	endFrame: number;
	/** Priority level (higher = more urgent) */
	priority: number;
	/** Current status of the job */
	status: RenderJobStatus;
	/** Progress percentage (0-100) */
	progress: number;
	/** Output directory for rendered frames */
	outputDir?: string;
	/** Error message if status is 'error' */
	errorMessage?: string;
	/** Timestamp when job was created */
	createdAt: number;
	/** Timestamp when job started rendering */
	startedAt?: number;
	/** Timestamp when job completed */
	completedAt?: number;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Types of errors that can occur in Remotion integration
 */
export type RemotionErrorType =
	| "render"
	| "load"
	| "validation"
	| "timeout"
	| "memory"
	| "unknown";

/**
 * Structured error information for Remotion operations
 */
export interface RemotionError {
	/** Type of error */
	type: RemotionErrorType;
	/** Element ID where error occurred */
	elementId?: string;
	/** Component ID where error occurred */
	componentId?: string;
	/** Human-readable error message */
	message: string;
	/** Stack trace for debugging */
	stack?: string;
	/** Whether the error can be recovered from */
	recoverable: boolean;
	/** Suggested recovery action */
	recoveryAction?: "retry" | "skip" | "reload" | "reduce-quality";
	/** Timestamp when error occurred */
	timestamp: number;
}

// ============================================================================
// Sync Manager Types
// ============================================================================

/**
 * Configuration for frame synchronization between QCut timeline and Remotion
 */
export interface SyncConfig {
	/** Tolerance in frames for sync drift before correction */
	driftTolerance: number;
	/** Debounce time in ms for seek operations */
	seekDebounceMs: number;
	/** Whether to preload adjacent frames */
	preloadEnabled: boolean;
	/** Number of frames to preload ahead */
	preloadFrames: number;
}

/**
 * State of sync between timeline and Remotion instances
 */
export interface SyncState {
	/** Current global timeline frame */
	globalFrame: number;
	/** Whether playback is currently active */
	isPlaying: boolean;
	/** Current playback rate */
	playbackRate: number;
	/** IDs of currently active (visible) Remotion elements */
	activeElementIds: string[];
	/** Last sync timestamp */
	lastSyncTime: number;
}

// ============================================================================
// Export Types
// ============================================================================

/**
 * Configuration for pre-rendering Remotion elements during export
 */
export interface PreRenderConfig {
	/** Directory to store rendered frames */
	outputDir: string;
	/** Image format for rendered frames */
	format: "png" | "jpeg";
	/** Quality for JPEG (0-100) */
	quality: number;
	/** Number of parallel render threads */
	concurrency: number;
	/** Resolution scale factor (1 = original, 0.5 = half) */
	scale: number;
}

/**
 * Result of pre-rendering a single Remotion element
 */
export interface PreRenderResult {
	/** ID of the element that was rendered */
	elementId: string;
	/** Map of frame number to file path */
	framePaths: Map<number, string>;
	/** Path to extracted audio file, if any */
	audioPath?: string;
	/** Whether rendering succeeded */
	success: boolean;
	/** Error information if rendering failed */
	error?: RemotionError;
	/** Rendering duration in milliseconds */
	durationMs: number;
}

// ============================================================================
// Compositor Types
// ============================================================================

/**
 * Blend modes for compositing layers
 */
export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "add";

/**
 * A layer to be composited in the final frame
 */
export interface CompositeLayer {
	/** Z-index for layer ordering */
	zIndex: number;
	/** Source of the layer content */
	source: "qcut" | "remotion";
	/** Element ID this layer represents */
	elementId: string;
	/** Blend mode for compositing */
	blendMode: BlendMode;
	/** Opacity of the layer (0-1) */
	opacity: number;
	/** Transform to apply to the layer */
	transform?: {
		x: number;
		y: number;
		scale: number;
		rotation: number;
	};
	/** Optional mask for the layer */
	mask?: ImageData;
}

// ============================================================================
// Store Types
// ============================================================================

/**
 * State interface for the Remotion Zustand store
 */
export interface RemotionStoreState {
	/** Registered Remotion components available for use */
	registeredComponents: Map<string, RemotionComponentDefinition>;
	/** Active instances of Remotion components on the timeline */
	instances: Map<string, RemotionInstance>;
	/** Render queue for pre-rendering operations */
	renderQueue: RenderJob[];
	/** Global sync state */
	syncState: SyncState;
	/** Whether the store has been initialized */
	isInitialized: boolean;
	/** Loading state for async operations */
	isLoading: boolean;
	/** Recent errors for debugging */
	recentErrors: RemotionError[];
	/** Cached sequence analysis results by componentId */
	analyzedSequences: Map<
		string,
		import("./sequence-analysis-service").AnalysisResult
	>;
	/** Imported folder metadata by folder path */
	importedFolders: Map<string, ImportedFolderInfo>;
	/** Whether a folder import is in progress */
	isFolderImporting: boolean;
}

/**
 * Information about an imported Remotion folder
 */
export interface ImportedFolderInfo {
	/** Folder path */
	folderPath: string;
	/** Display name for the folder */
	name: string;
	/** Component IDs imported from this folder */
	componentIds: string[];
	/** Number of compositions detected */
	compositionCount: number;
	/** When the folder was imported */
	importedAt: number;
	/** When the folder was last refreshed */
	refreshedAt: number;
}

/**
 * Result of a folder import operation
 */
export interface FolderImportResult {
	/** Whether import was successful */
	success: boolean;
	/** Component IDs that were imported */
	componentIds: string[];
	/** Number of components successfully imported */
	successCount: number;
	/** Number of components that failed */
	errorCount: number;
	/** Error messages */
	errors: string[];
	/** Folder path that was imported */
	folderPath: string;
}

/**
 * Actions interface for the Remotion Zustand store
 */
export interface RemotionStoreActions {
	// Initialization
	initialize: () => Promise<void>;

	// Component Registry
	registerComponent: (definition: RemotionComponentDefinition) => void;
	unregisterComponent: (id: string) => void;
	getComponent: (id: string) => RemotionComponentDefinition | undefined;
	getComponentsByCategory: (
		category: RemotionComponentCategory
	) => RemotionComponentDefinition[];

	// Instance Management
	createInstance: (
		elementId: string,
		componentId: string,
		props?: Record<string, unknown>
	) => RemotionInstance | null;
	destroyInstance: (elementId: string) => void;
	updateInstanceProps: (
		elementId: string,
		props: Record<string, unknown>
	) => void;
	setInstancePlayerRef: (elementId: string, ref: PlayerRef | null) => void;
	getInstance: (elementId: string) => RemotionInstance | undefined;

	// Playback Control
	seekInstance: (elementId: string, frame: number) => void;
	playInstance: (elementId: string) => void;
	pauseInstance: (elementId: string) => void;
	setInstancePlaybackRate: (elementId: string, rate: number) => void;

	// Sync
	syncToGlobalFrame: (frame: number) => void;
	syncPlayState: (isPlaying: boolean) => void;
	syncPlaybackRate: (rate: number) => void;
	updateActiveElements: (elementIds: string[]) => void;

	// Render Queue
	addRenderJob: (job: Omit<RenderJob, "id" | "createdAt">) => string;
	updateRenderJobStatus: (
		jobId: string,
		status: RenderJobStatus,
		progress?: number
	) => void;
	cancelRenderJob: (jobId: string) => void;
	clearCompletedJobs: () => void;

	// Error Handling
	addError: (error: RemotionError) => void;
	clearErrors: () => void;

	// Sequence Analysis
	/** Store analysis result for a component */
	setAnalysisResult: (
		componentId: string,
		result: import("./sequence-analysis-service").AnalysisResult
	) => void;
	/** Get analysis result for a component */
	getAnalysisResult: (
		componentId: string
	) => import("./sequence-analysis-service").AnalysisResult | undefined;
	/** Clear analysis for a component */
	clearAnalysisResult: (componentId: string) => void;
	/** Analyze a component's source code and store result */
	analyzeComponentSource: (
		componentId: string,
		sourceCode: string
	) => Promise<import("./sequence-analysis-service").AnalysisResult>;

	// Folder Import
	/** Import components from a Remotion folder */
	importFromFolder: (folderPath?: string) => Promise<FolderImportResult>;
	/** Refresh components from an imported folder */
	refreshFolder: (folderPath: string) => Promise<FolderImportResult>;
	/** Remove an imported folder and its components */
	removeFolder: (folderPath: string) => void;
	/** Get all imported folders */
	getImportedFolders: () => ImportedFolderInfo[];

	// Cleanup
	reset: () => void;
}

/**
 * Complete Remotion store type
 */
export type RemotionStore = RemotionStoreState & RemotionStoreActions;

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Type guard to check if an object is a RemotionComponentDefinition
 */
export function isRemotionComponentDefinition(
	obj: unknown
): obj is RemotionComponentDefinition {
	if (typeof obj !== "object" || obj === null) return false;
	const def = obj as Record<string, unknown>;
	return (
		typeof def.id === "string" &&
		typeof def.name === "string" &&
		typeof def.category === "string" &&
		typeof def.durationInFrames === "number" &&
		typeof def.fps === "number" &&
		typeof def.width === "number" &&
		typeof def.height === "number" &&
		typeof def.component === "function"
	);
}

/**
 * Type guard to check if an error is a RemotionError
 */
export function isRemotionError(obj: unknown): obj is RemotionError {
	if (typeof obj !== "object" || obj === null) return false;
	const err = obj as Record<string, unknown>;
	return (
		typeof err.type === "string" &&
		typeof err.message === "string" &&
		typeof err.recoverable === "boolean" &&
		typeof err.timestamp === "number"
	);
}

/**
 * Generate a cache key string from components
 */
export function generateCacheKey(
	elementId: string,
	frame: number,
	propsHash: string
): string {
	return `${elementId}-${frame}-${propsHash}`;
}

/**
 * Parse a cache key string into components
 */
export function parseCacheKey(key: string): FrameCacheKey | null {
	const parts = key.split("-");
	if (parts.length < 3) return null;

	const frame = parseInt(parts[1], 10);
	if (isNaN(frame)) return null;

	return {
		elementId: parts[0],
		frame,
		propsHash: parts.slice(2).join("-"),
	};
}

/**
 * Calculate a hash for props object (for cache key generation)
 * Note: Uses djb2-style hash. Collisions are acceptable for cache keys
 * since they only cause cache misses, not data corruption.
 */
export function hashProps(props: Record<string, unknown>): string {
	let str: string;
	try {
		str = JSON.stringify(props, Object.keys(props).sort());
	} catch {
		// Handle circular references or other serialization errors
		str = String(Object.keys(props).length);
	}
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return Math.abs(hash).toString(36);
}
