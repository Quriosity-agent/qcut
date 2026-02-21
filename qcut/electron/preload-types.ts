/**
 * Type definitions for the Electron preload API.
 *
 * Contains all interfaces, the master ElectronAPI type,
 * and the global Window augmentation.
 *
 * @module electron/preload-types
 */

import type {
	MediaFile,
	ClaudeTimeline,
	ClaudeElement,
	ClaudeSplitResponse,
	ClaudeSelectionItem,
	ClaudeBatchAddElementRequest,
	ClaudeBatchAddResponse,
	ClaudeBatchDeleteItemRequest,
	ClaudeBatchDeleteResponse,
	ClaudeBatchUpdateItemRequest,
	ClaudeBatchUpdateResponse,
	ClaudeArrangeRequest,
	ClaudeArrangeResponse,
	ClaudeRangeDeleteRequest,
	ClaudeRangeDeleteResponse,
	BatchCutResponse,
	ProjectSettings,
	ProjectStats,
	ExportPreset,
	ExportRecommendation,
	ErrorReport,
	DiagnosticResult,
} from "./types/claude-api";

// ============================================================================
// Supporting types
// ============================================================================

/** File dialog filter for open/save dialogs */
export interface FileDialogFilter {
	name: string;
	extensions: string[];
}

/** File information returned from file operations */
export interface FileInfo {
	name: string;
	path: string;
	size: number;
	lastModified: Date;
	type: string;
}

/** Parameters for searching sounds via Freesound API */
export interface SoundSearchParams {
	query?: string;
	page?: number;
	pageSize?: number;
	duration?: string;
	sort?: string;
}

/** Parameters for downloading a sound file */
export interface SoundDownloadParams {
	soundId: number;
	previewUrl: string;
	name: string;
}

/** Data for initiating a transcription request */
export interface TranscriptionRequestData {
	id: string;
	filename: string;
	language?: string;
	decryptionKey?: string;
	iv?: string;
	controller?: AbortController;
}

/** Result from a transcription operation */
export interface TranscriptionResult {
	success: boolean;
	text?: string;
	segments?: TranscriptionSegment[];
	language?: string;
	error?: string;
	message?: string;
	id?: string;
}

/** A segment of transcribed text with timing information */
export interface TranscriptionSegment {
	id: number;
	start: number;
	end: number;
	text: string;
}

export interface AIFillerWordItem {
	id: string;
	text: string;
	start: number;
	end: number;
	type: "word" | "spacing";
	speaker_id?: string;
}

export interface AnalyzeFillersResult {
	filteredWordIds: Array<{
		id: string;
		reason: string;
		scope?: "word" | "sentence";
	}>;
	provider?: "gemini" | "anthropic" | "pattern";
}

/** Result from a cancellation operation */
export interface CancelResult {
	success: boolean;
	message?: string;
}

export interface ExportSession {
	sessionId: string;
	frameDir: string;
	outputDir: string;
}

export interface FrameData {
	sessionId: string;
	frameNumber: number;
	imageData: ArrayBuffer | Buffer;
}

export interface VideoSource {
	path: string;
	startTime: number;
	duration: number;
	trimStart?: number;
	trimEnd?: number;
}

export interface ExportOptions {
	sessionId: string;
	outputPath: string;
	width: number;
	height: number;
	fps: number;
	duration: number;
	audioFiles?: AudioFile[];
	metadata?: Record<string, string>;
	useDirectCopy?: boolean;
	videoSources?: VideoSource[];
	useVideoInput?: boolean;
	videoInputPath?: string;
	trimStart?: number;
	trimEnd?: number;
	optimizationStrategy?:
		| "image-pipeline"
		| "direct-copy"
		| "direct-video-with-filters"
		| "video-normalization"
		| "image-video-composite";
	wordFilterSegments?: Array<{
		start: number;
		end: number;
	}>;
	crossfadeMs?: number;
}

export interface AudioFile {
	path: string;
	startTime: number;
	volume?: number;
}

export interface ApiKeyConfig {
	FREESOUND_API_KEY?: string;
	FAL_API_KEY?: string;
	GEMINI_API_KEY?: string;
	freesoundApiKey?: string;
	falApiKey?: string;
	geminiApiKey?: string;
	openRouterApiKey?: string;
	anthropicApiKey?: string;
	elevenLabsApiKey?: string;
}

export interface SaveAIVideoOptions {
	fileName: string;
	fileData: ArrayBuffer | Uint8Array;
	projectId: string;
	modelId?: string;
	metadata?: {
		width?: number;
		height?: number;
		duration?: number;
		fps?: number;
	};
}

export interface SaveAIVideoResult {
	success: boolean;
	localPath?: string;
	fileName?: string;
	fileSize?: number;
	error?: string;
}

export interface GitHubStarsResponse {
	stars: number;
}

export interface FalUploadResult {
	success: boolean;
	url?: string;
	error?: string;
}

export interface Skill {
	id: string;
	name: string;
	description: string;
	dependencies?: string;
	folderName: string;
	mainFile: string;
	additionalFiles: string[];
	content: string;
	createdAt: number;
	updatedAt: number;
}

export interface SkillsSyncForClaudeResult {
	synced: boolean;
	copied: number;
	skipped: number;
	removed: number;
	warnings: string[];
	error?: string;
}

/** Options for importing media into a project */
export interface MediaImportOptions {
	sourcePath: string;
	projectId: string;
	mediaId: string;
	preferSymlink?: boolean;
}

/** Result of a media import operation */
export interface MediaImportResult {
	success: boolean;
	targetPath: string;
	importMethod: "symlink" | "copy";
	originalPath: string;
	fileSize: number;
	error?: string;
}

/** Composition information from a Remotion project */
export interface RemotionCompositionInfo {
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

/** Result of selecting a Remotion folder via dialog */
export interface RemotionFolderSelectResult {
	success: boolean;
	folderPath?: string;
	cancelled?: boolean;
	error?: string;
}

/** Result of scanning a Remotion project folder */
export interface RemotionFolderScanResult {
	isValid: boolean;
	rootFilePath: string | null;
	compositions: RemotionCompositionInfo[];
	errors: string[];
	folderPath: string;
}

/** Result of bundling a single composition */
export interface RemotionBundleResult {
	compositionId: string;
	success: boolean;
	code?: string;
	sourceMap?: string;
	error?: string;
}

/** Result of bundling compositions from a folder */
export interface RemotionFolderBundleResult {
	success: boolean;
	results: RemotionBundleResult[];
	successCount: number;
	errorCount: number;
	folderPath: string;
}

/** Combined result of folder import (scan + bundle) */
export interface RemotionFolderImportResult {
	success: boolean;
	scan: RemotionFolderScanResult;
	bundle: RemotionFolderBundleResult | null;
	importTime: number;
	error?: string;
}

export type ThemeSource = "system" | "light" | "dark";

export type ScreenCaptureSourceType = "window" | "screen";

export interface ScreenCaptureSource {
	id: string;
	name: string;
	type: ScreenCaptureSourceType;
	displayId: string;
	isCurrentWindow: boolean;
}

export interface StartScreenRecordingOptions {
	sourceId?: string;
	filePath?: string;
	fileName?: string;
	mimeType?: string;
}

export interface StartScreenRecordingResult {
	sessionId: string;
	sourceId: string;
	sourceName: string;
	filePath: string;
	startedAt: number;
	mimeType: string | null;
}

export interface StopScreenRecordingOptions {
	sessionId?: string;
	discard?: boolean;
}

export interface StopScreenRecordingResult {
	success: boolean;
	filePath: string | null;
	bytesWritten: number;
	durationMs: number;
	discarded: boolean;
}

export interface ScreenRecordingStatus {
	state: "idle" | "recording";
	recording: boolean;
	sessionId: string | null;
	sourceId: string | null;
	sourceName: string | null;
	filePath: string | null;
	bytesWritten: number;
	startedAt: number | null;
	durationMs: number;
	mimeType: string | null;
}

// ============================================================================
// Master ElectronAPI interface
// ============================================================================

export interface ElectronAPI {
	platform: NodeJS.Platform;

	// File operations
	openFileDialog: () => Promise<string | null>;
	openMultipleFilesDialog: () => Promise<string[]>;
	saveFileDialog: (
		defaultFilename?: string,
		filters?: FileDialogFilter[]
	) => Promise<string | null>;
	readFile: (filePath: string) => Promise<Buffer | null>;
	writeFile: (filePath: string, data: Buffer | string) => Promise<boolean>;
	saveBlob: (
		data: Buffer | Uint8Array,
		defaultFilename?: string
	) => Promise<{
		success: boolean;
		filePath?: string;
		canceled?: boolean;
		error?: string;
	}>;
	getFileInfo: (filePath: string) => Promise<FileInfo | null>;

	// File path utility (Electron 37+ removed File.path on dropped files)
	getPathForFile: (file: File) => string;

	// Storage operations
	storage: {
		save: (key: string, data: any) => Promise<boolean>;
		load: (key: string) => Promise<any>;
		remove: (key: string) => Promise<boolean>;
		list: () => Promise<string[]>;
		clear: () => Promise<boolean>;
	};

	// Theme operations
	theme: {
		get: () => Promise<ThemeSource>;
		set: (theme: ThemeSource) => Promise<ThemeSource>;
		toggle: () => Promise<ThemeSource>;
		isDark: () => Promise<boolean>;
	};

	// Sound operations
	sounds: {
		search: (params: SoundSearchParams) => Promise<any>;
		downloadPreview: (
			params: SoundDownloadParams
		) => Promise<{ success: boolean; path?: string; error?: string }>;
	};

	// Audio operations
	audio: {
		saveTemp: (audioData: Uint8Array, filename: string) => Promise<string>;
	};

	// Video operations
	video?: {
		saveTemp: (
			videoData: Uint8Array,
			filename: string,
			sessionId?: string
		) => Promise<string>;
		saveToDisk: (options: SaveAIVideoOptions) => Promise<SaveAIVideoResult>;
		verifyFile: (filePath: string) => Promise<boolean>;
		deleteFile: (filePath: string) => Promise<boolean>;
		getProjectDir: (projectId: string) => Promise<string>;
	};

	// Screen recording operations
	screenRecording?: {
		getSources: () => Promise<ScreenCaptureSource[]>;
		start: (
			options?: StartScreenRecordingOptions
		) => Promise<StartScreenRecordingResult>;
		appendChunk: (options: {
			sessionId: string;
			chunk: Uint8Array;
		}) => Promise<{ bytesWritten: number }>;
		stop: (
			options?: StopScreenRecordingOptions
		) => Promise<StopScreenRecordingResult>;
		getStatus: () => Promise<ScreenRecordingStatus>;
	};

	// Transcription operations
	transcribe: {
		transcribe: (request: { audioPath: string; language?: string }) => Promise<{
			text: string;
			segments: Array<{
				id: number;
				seek: number;
				start: number;
				end: number;
				text: string;
				tokens: number[];
				temperature: number;
				avg_logprob: number;
				compression_ratio: number;
				no_speech_prob: number;
			}>;
			language: string;
		}>;
		cancel: (id: string) => Promise<CancelResult>;
		elevenlabs: (options: {
			audioPath: string;
			language?: string;
			diarize?: boolean;
			tagAudioEvents?: boolean;
			keyterms?: string[];
		}) => Promise<{
			text: string;
			language_code: string;
			language_probability: number;
			words: Array<{
				text: string;
				start: number;
				end: number;
				type: "word" | "spacing" | "audio_event" | "punctuation";
				speaker_id: string | null;
			}>;
		}>;
		uploadToFal: (filePath: string) => Promise<{ url: string }>;
	};

	analyzeFillers: (options: {
		words: AIFillerWordItem[];
		languageCode: string;
	}) => Promise<AnalyzeFillersResult>;

	// FFmpeg export operations
	ffmpeg: {
		createExportSession: () => Promise<ExportSession>;
		saveFrame: (
			data: FrameData
		) => Promise<{ success: boolean; error?: string }>;
		exportVideoCLI: (
			options: ExportOptions
		) => Promise<{ success: boolean; outputPath?: string; error?: string }>;
		readOutputFile: (path: string) => Promise<Buffer | null>;
		cleanupExportSession: (sessionId: string) => Promise<boolean>;
		openFramesFolder: (sessionId: string) => Promise<void>;
		processFrame: (options: {
			sessionId: string;
			inputFrameName: string;
			outputFrameName: string;
			filterChain: string;
		}) => Promise<void>;
		extractAudio: (options: { videoPath: string; format?: string }) => Promise<{
			audioPath: string;
			fileSize: number;
		}>;
		validateFilterChain: (filterChain: string) => Promise<boolean>;
		saveStickerForExport: (data: {
			sessionId: string;
			stickerId: string;
			imageData: Uint8Array;
			format?: string;
		}) => Promise<{ success: boolean; path?: string; error?: string }>;
		getFFmpegResourcePath: (filename: string) => Promise<string>;
		checkFFmpegResource: (filename: string) => Promise<boolean>;
		getPath: () => Promise<string>;
		checkHealth: () => Promise<{
			ffmpegOk: boolean;
			ffprobeOk: boolean;
			ffmpegVersion: string;
			ffprobeVersion: string;
			ffmpegPath: string;
			ffprobePath: string;
			errors: string[];
		}>;
	};

	// API key operations
	apiKeys: {
		get: () => Promise<ApiKeyConfig>;
		set: (keys: ApiKeyConfig) => Promise<boolean>;
		clear: () => Promise<boolean>;
		status: () => Promise<{
			falApiKey: { set: boolean; source: string };
			freesoundApiKey: { set: boolean; source: string };
			geminiApiKey: { set: boolean; source: string };
			openRouterApiKey: { set: boolean; source: string };
			anthropicApiKey: { set: boolean; source: string };
			elevenLabsApiKey: { set: boolean; source: string };
		}>;
	};

	// Shell operations
	shell: {
		showItemInFolder: (filePath: string) => Promise<void>;
	};

	// GitHub operations
	github: {
		fetchStars: () => Promise<GitHubStarsResponse>;
	};

	// FAL AI operations
	fal: {
		uploadVideo: (
			videoData: Uint8Array,
			filename: string,
			apiKey: string
		) => Promise<FalUploadResult>;
		uploadImage: (
			imageData: Uint8Array,
			filename: string,
			apiKey: string
		) => Promise<FalUploadResult>;
		uploadAudio: (
			audioData: Uint8Array,
			filename: string,
			apiKey: string
		) => Promise<FalUploadResult>;
		queueFetch: (
			url: string,
			apiKey: string
		) => Promise<{ ok: boolean; status: number; data: unknown }>;
	};

	// Gemini Chat operations
	geminiChat: {
		send: (request: {
			messages: Array<{ role: "user" | "assistant"; content: string }>;
			attachments?: Array<{ path: string; mimeType: string; name: string }>;
			model?: string;
		}) => Promise<{ success: boolean; error?: string }>;
		onStreamChunk: (callback: (data: { text: string }) => void) => void;
		onStreamComplete: (callback: () => void) => void;
		onStreamError: (callback: (data: { message: string }) => void) => void;
		removeListeners: () => void;
	};

	// PTY Terminal operations
	pty: {
		spawn: (options?: {
			cols?: number;
			rows?: number;
			cwd?: string;
			command?: string;
		}) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
		write: (
			sessionId: string,
			data: string
		) => Promise<{ success: boolean; error?: string }>;
		resize: (
			sessionId: string,
			cols: number,
			rows: number
		) => Promise<{ success: boolean; error?: string }>;
		kill: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
		killAll: () => Promise<{ success: boolean }>;
		onData: (
			callback: (data: { sessionId: string; data: string }) => void
		) => void;
		onExit: (
			callback: (data: {
				sessionId: string;
				exitCode: number;
				signal?: number;
			}) => void
		) => void;
		removeListeners: () => void;
	};

	// MCP app bridge (renderer preview iframe updates)
	mcp?: {
		onAppHtml: (
			callback: (data: { html: string; toolName?: string }) => void
		) => void;
		removeListeners: () => void;
	};

	// Skills operations
	skills?: {
		list: (projectId: string) => Promise<Skill[]>;
		import: (projectId: string, sourcePath: string) => Promise<Skill | null>;
		delete: (projectId: string, skillId: string) => Promise<void>;
		getContent: (
			projectId: string,
			skillId: string,
			filename: string
		) => Promise<string>;
		browse: () => Promise<string | null>;
		getPath: (projectId: string) => Promise<string>;
		scanGlobal: () => Promise<
			Array<{
				path: string;
				name: string;
				description: string;
				bundled?: boolean;
			}>
		>;
		syncForClaude: (projectId: string) => Promise<SkillsSyncForClaudeResult>;
	};

	// AI Pipeline operations
	aiPipeline?: {
		check: () => Promise<{ available: boolean; error?: string }>;
		status: () => Promise<{
			available: boolean;
			version: string | null;
			source: "bundled" | "system" | "python" | "unavailable";
			compatible: boolean;
			features: Record<string, boolean>;
			error?: string;
		}>;
		generate: (options: {
			command: string;
			args: Record<string, string | number | boolean>;
			outputDir?: string;
			sessionId?: string;
			projectId?: string;
			autoImport?: boolean;
		}) => Promise<{
			success: boolean;
			outputPath?: string;
			outputPaths?: string[];
			error?: string;
			errorCode?: string;
			duration?: number;
			cost?: number;
			models?: string[];
			data?: unknown;
			mediaId?: string;
			importedPath?: string;
		}>;
		listModels: () => Promise<{
			success: boolean;
			error?: string;
			models?: string[];
			data?: unknown;
		}>;
		estimateCost: (options: {
			model: string;
			duration?: number;
			resolution?: string;
		}) => Promise<{
			success: boolean;
			error?: string;
			cost?: number;
		}>;
		cancel: (sessionId: string) => Promise<{ success: boolean }>;
		refresh: () => Promise<{
			available: boolean;
			version: string | null;
			source: "bundled" | "system" | "python" | "unavailable";
			compatible: boolean;
			features: Record<string, boolean>;
			error?: string;
		}>;
		onProgress: (
			callback: (progress: {
				stage: string;
				percent: number;
				message: string;
				model?: string;
				eta?: number;
				sessionId?: string;
			}) => void
		) => () => void;
	};

	// Media import operations
	mediaImport?: {
		import: (options: MediaImportOptions) => Promise<MediaImportResult>;
		validateSymlink: (path: string) => Promise<boolean>;
		locateOriginal: (mediaPath: string) => Promise<string | null>;
		relinkMedia: (
			projectId: string,
			mediaId: string,
			newSourcePath: string
		) => Promise<MediaImportResult>;
		remove: (projectId: string, mediaId: string) => Promise<void>;
		checkSymlinkSupport: () => Promise<boolean>;
		getMediaPath: (projectId: string) => Promise<string>;
	};

	// Project folder operations
	projectFolder?: {
		getRoot: (projectId: string) => Promise<string>;
		scan: (
			projectId: string,
			subPath?: string,
			options?: { recursive?: boolean; mediaOnly?: boolean }
		) => Promise<{
			files: Array<{
				name: string;
				path: string;
				relativePath: string;
				type: "video" | "audio" | "image" | "unknown";
				size: number;
				modifiedAt: number;
				isDirectory: boolean;
			}>;
			folders: string[];
			totalSize: number;
			scanTime: number;
		}>;
		list: (
			projectId: string,
			subPath?: string
		) => Promise<
			Array<{
				name: string;
				path: string;
				relativePath: string;
				type: "video" | "audio" | "image" | "unknown";
				size: number;
				modifiedAt: number;
				isDirectory: boolean;
			}>
		>;
		ensureStructure: (
			projectId: string
		) => Promise<{ created: string[]; existing: string[] }>;
	};

	// Claude Code Integration API
	claude?: {
		media: {
			list: (projectId: string) => Promise<MediaFile[]>;
			info: (projectId: string, mediaId: string) => Promise<MediaFile | null>;
			import: (projectId: string, source: string) => Promise<MediaFile | null>;
			delete: (projectId: string, mediaId: string) => Promise<boolean>;
			rename: (
				projectId: string,
				mediaId: string,
				newName: string
			) => Promise<boolean>;
		};
		timeline: {
			export: (projectId: string, format: "json" | "md") => Promise<string>;
			import: (
				projectId: string,
				data: string,
				format: "json" | "md"
			) => Promise<void>;
			addElement: (
				projectId: string,
				element: Partial<ClaudeElement>
			) => Promise<string>;
			batchAddElements: (
				projectId: string,
				elements: ClaudeBatchAddElementRequest[]
			) => Promise<ClaudeBatchAddResponse>;
			updateElement: (
				projectId: string,
				elementId: string,
				changes: Partial<ClaudeElement>
			) => Promise<void>;
			batchUpdateElements: (
				projectId: string,
				updates: ClaudeBatchUpdateItemRequest[]
			) => Promise<ClaudeBatchUpdateResponse>;
			removeElement: (projectId: string, elementId: string) => Promise<void>;
			batchDeleteElements: (
				projectId: string,
				elements: ClaudeBatchDeleteItemRequest[],
				ripple?: boolean
			) => Promise<ClaudeBatchDeleteResponse>;
			deleteRange: (
				projectId: string,
				request: ClaudeRangeDeleteRequest
			) => Promise<ClaudeRangeDeleteResponse>;
			arrange: (
				projectId: string,
				request: ClaudeArrangeRequest
			) => Promise<ClaudeArrangeResponse>;
			splitElement: (
				projectId: string,
				elementId: string,
				splitTime: number,
				mode?: "split" | "keepLeft" | "keepRight"
			) => Promise<ClaudeSplitResponse>;
			moveElement: (
				projectId: string,
				elementId: string,
				toTrackId: string,
				newStartTime?: number
			) => Promise<void>;
			selectElements: (
				projectId: string,
				elements: ClaudeSelectionItem[]
			) => Promise<void>;
			getSelection: (projectId: string) => Promise<ClaudeSelectionItem[]>;
			clearSelection: (projectId: string) => Promise<void>;
			onRequest: (callback: () => void) => void;
			sendResponse: (timeline: ClaudeTimeline) => void;
			onApply: (
				callback: (timeline: ClaudeTimeline, replace?: boolean) => void
			) => void;
			onAddElement: (
				callback: (element: Partial<ClaudeElement>) => void
			) => void;
			onBatchAddElements: (
				callback: (data: {
					requestId: string;
					elements: ClaudeBatchAddElementRequest[];
				}) => void
			) => void;
			sendBatchAddElementsResponse: (
				requestId: string,
				result: ClaudeBatchAddResponse
			) => void;
			onUpdateElement: (
				callback: (data: {
					elementId: string;
					changes: Partial<ClaudeElement>;
				}) => void
			) => void;
			onBatchUpdateElements: (
				callback: (data: {
					requestId: string;
					updates: ClaudeBatchUpdateItemRequest[];
				}) => void
			) => void;
			sendBatchUpdateElementsResponse: (
				requestId: string,
				result: ClaudeBatchUpdateResponse
			) => void;
			onRemoveElement: (callback: (elementId: string) => void) => void;
			onBatchDeleteElements: (
				callback: (data: {
					requestId: string;
					elements: ClaudeBatchDeleteItemRequest[];
					ripple?: boolean;
				}) => void
			) => void;
			sendBatchDeleteElementsResponse: (
				requestId: string,
				result: ClaudeBatchDeleteResponse
			) => void;
			onSplitElement: (
				callback: (data: {
					requestId: string;
					elementId: string;
					splitTime: number;
					mode: "split" | "keepLeft" | "keepRight";
				}) => void
			) => void;
			sendSplitResponse: (
				requestId: string,
				result: ClaudeSplitResponse
			) => void;
			onExecuteCuts: (
				callback: (data: {
					requestId: string;
					elementId: string;
					cuts: Array<{ start: number; end: number }>;
					ripple: boolean;
				}) => void
			) => void;
			sendExecuteCutsResponse: (
				requestId: string,
				result: BatchCutResponse
			) => void;
			onMoveElement: (
				callback: (data: {
					elementId: string;
					toTrackId: string;
					newStartTime?: number;
				}) => void
			) => void;
			onSelectElements: (
				callback: (data: { elements: ClaudeSelectionItem[] }) => void
			) => void;
			onGetSelection: (callback: (data: { requestId: string }) => void) => void;
			sendSelectionResponse: (
				requestId: string,
				elements: ClaudeSelectionItem[]
			) => void;
			onClearSelection: (callback: () => void) => void;
			onDeleteRange: (
				callback: (data: {
					requestId: string;
					request: ClaudeRangeDeleteRequest;
				}) => void
			) => void;
			sendDeleteRangeResponse: (
				requestId: string,
				result: ClaudeRangeDeleteResponse
			) => void;
			onArrange: (
				callback: (data: {
					requestId: string;
					request: ClaudeArrangeRequest;
				}) => void
			) => void;
			sendArrangeResponse: (
				requestId: string,
				result: ClaudeArrangeResponse
			) => void;
			removeListeners: () => void;
		};
		project: {
			getSettings: (projectId: string) => Promise<ProjectSettings>;
			updateSettings: (
				projectId: string,
				settings: Partial<ProjectSettings>
			) => Promise<void>;
			getStats: (projectId: string) => Promise<ProjectStats>;
			onStatsRequest: (
				callback: (projectId: string, requestId: string) => void
			) => void;
			sendStatsResponse: (stats: ProjectStats, requestId: string) => void;
			onUpdated: (
				callback: (
					projectId: string,
					settings: Partial<ProjectSettings>
				) => void
			) => void;
			removeListeners: () => void;
		};
		export: {
			getPresets: () => Promise<ExportPreset[]>;
			recommend: (
				projectId: string,
				target: string
			) => Promise<ExportRecommendation>;
		};
		diagnostics: {
			analyze: (error: ErrorReport) => Promise<DiagnosticResult>;
		};
		analyze: {
			run: (
				projectId: string,
				options: {
					source: {
						type: "timeline" | "media" | "path";
						elementId?: string;
						mediaId?: string;
						filePath?: string;
					};
					analysisType?: "timeline" | "describe" | "transcribe";
					model?: string;
					format?: "md" | "json" | "both";
				}
			) => Promise<{
				success: boolean;
				markdown?: string;
				json?: Record<string, unknown>;
				outputFiles?: string[];
				videoPath?: string;
				duration?: number;
				cost?: number;
				error?: string;
			}>;
			models: () => Promise<{
				models: Array<{
					key: string;
					provider: string;
					modelId: string;
					description: string;
				}>;
			}>;
		};
	};

	// Remotion folder operations
	remotionFolder?: {
		select: () => Promise<RemotionFolderSelectResult>;
		scan: (folderPath: string) => Promise<RemotionFolderScanResult>;
		bundle: (
			folderPath: string,
			compositionIds?: string[]
		) => Promise<RemotionFolderBundleResult>;
		import: (folderPath: string) => Promise<RemotionFolderImportResult>;
		checkBundler: () => Promise<{ available: boolean }>;
		validate: (
			folderPath: string
		) => Promise<{ isValid: boolean; error?: string }>;
	};

	// Moyin script-to-storyboard operations
	moyin?: {
		parseScript: (options: {
			rawScript: string;
			language?: string;
			sceneCount?: number;
		}) => Promise<{
			success: boolean;
			data?: Record<string, unknown>;
			error?: string;
		}>;
		generateStoryboard: (options: {
			scenes: unknown[];
			styleId?: string;
		}) => Promise<{
			success: boolean;
			outputPaths?: string[];
			error?: string;
		}>;
		callLLM: (options: {
			systemPrompt: string;
			userPrompt: string;
			temperature?: number;
			maxTokens?: number;
		}) => Promise<{
			success: boolean;
			text?: string;
			error?: string;
		}>;
	};

	// Update and release notes operations
	updates?: {
		checkForUpdates: () => Promise<{
			available: boolean;
			version?: string;
			message?: string;
			error?: string;
		}>;
		installUpdate: () => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		getReleaseNotes: (version?: string) => Promise<{
			version: string;
			date: string;
			channel: string;
			content: string;
		} | null>;
		getChangelog: () => Promise<
			Array<{
				version: string;
				date: string;
				channel: string;
				content: string;
			}>
		>;
		onUpdateAvailable: (
			callback: (data: {
				version: string;
				releaseNotes?: string;
				releaseDate?: string;
			}) => void
		) => () => void;
		onDownloadProgress: (
			callback: (data: {
				percent: number;
				transferred: number;
				total: number;
			}) => void
		) => () => void;
		onUpdateDownloaded: (
			callback: (data: { version: string }) => void
		) => () => void;
	};

	isElectron: boolean;
}

// ============================================================================
// Global augmentation
// ============================================================================

declare global {
	interface Window {
		electronAPI: ElectronAPI;
	}
}
