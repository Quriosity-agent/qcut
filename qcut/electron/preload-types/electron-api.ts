/**
 * Master ElectronAPI interface definition.
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
} from "../types/claude-api";

import type {
	FileDialogFilter,
	FileInfo,
	SoundSearchParams,
	SoundDownloadParams,
	TranscriptionResult,
	TranscriptionSegment,
	AIFillerWordItem,
	AnalyzeFillersResult,
	CancelResult,
	ExportSession,
	FrameData,
	VideoSource,
	ExportOptions,
	AudioFile,
	ApiKeyConfig,
	SaveAIVideoOptions,
	SaveAIVideoResult,
	GitHubStarsResponse,
	FalUploadResult,
	Skill,
	SkillsSyncForClaudeResult,
	MediaImportOptions,
	MediaImportResult,
	RemotionCompositionInfo,
	RemotionFolderSelectResult,
	RemotionFolderScanResult,
	RemotionBundleResult,
	RemotionFolderBundleResult,
	RemotionFolderImportResult,
	ThemeSource,
	ScreenCaptureSourceType,
	ScreenCaptureSource,
	StartScreenRecordingOptions,
	StartScreenRecordingResult,
	StopScreenRecordingOptions,
	StopScreenRecordingResult,
	ScreenRecordingStatus,
} from "./supporting-types";

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
		save: <T = unknown>(key: string, data: T) => Promise<boolean>;
		load: <T = unknown>(key: string) => Promise<T | null>;
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
		search: (params: SoundSearchParams) => Promise<unknown>;
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
			onMediaImported: (
				callback: (data: {
					path: string;
					name: string;
					id: string;
					type: string;
					size: number;
				}) => void
			) => void;
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
			onLoadSpeech: (
				callback: (data: {
					text: string;
					language_code: string;
					language_probability: number;
					words: Array<{
						text: string;
						start: number;
						end: number;
						type: string;
						speaker_id: string | null;
					}>;
					fileName: string;
				}) => void
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
		navigator: {
			onProjectsRequest: (
				callback: (data: { requestId: string }) => void
			) => void;
			sendProjectsResponse: (
				requestId: string,
				result: {
					projects: Array<{
						id: string;
						name: string;
						createdAt: string;
						updatedAt: string;
					}>;
					activeProjectId: string | null;
				}
			) => void;
			onOpenRequest: (
				callback: (data: { requestId: string; projectId: string }) => void
			) => void;
			sendOpenResponse: (
				requestId: string,
				result: { navigated: boolean; projectId: string }
			) => void;
			removeListeners: () => void;
		};
		screenRecordingBridge: {
			onStartRequest: (
				callback: (data: {
					requestId: string;
					options: { sourceId?: string; fileName?: string };
				}) => void
			) => void;
			sendStartResponse: (
				requestId: string,
				result?: {
					sessionId: string;
					sourceId: string;
					sourceName: string;
					filePath: string;
					startedAt: number;
					mimeType: string | null;
				},
				error?: string
			) => void;
			onStopRequest: (
				callback: (data: {
					requestId: string;
					options: { discard?: boolean };
				}) => void
			) => void;
			sendStopResponse: (
				requestId: string,
				result?: {
					success: boolean;
					filePath: string | null;
					bytesWritten: number;
					durationMs: number;
					discarded: boolean;
				},
				error?: string
			) => void;
			removeListeners: () => void;
		};
		projectCrud: {
			onCreateRequest: (
				callback: (data: { requestId: string; name: string }) => void
			) => void;
			sendCreateResponse: (
				requestId: string,
				result?: { projectId: string; name: string },
				error?: string
			) => void;
			onDeleteRequest: (
				callback: (data: { requestId: string; projectId: string }) => void
			) => void;
			sendDeleteResponse: (
				requestId: string,
				result?: { deleted: boolean; projectId: string },
				error?: string
			) => void;
			onRenameRequest: (
				callback: (data: {
					requestId: string;
					projectId: string;
					name: string;
				}) => void
			) => void;
			sendRenameResponse: (
				requestId: string,
				result?: { renamed: boolean; projectId: string; name: string },
				error?: string
			) => void;
			onDuplicateRequest: (
				callback: (data: { requestId: string; projectId: string }) => void
			) => void;
			sendDuplicateResponse: (
				requestId: string,
				result?: {
					projectId: string;
					name: string;
					sourceProjectId: string;
				},
				error?: string
			) => void;
			removeListeners: () => void;
		};
		ui: {
			onSwitchPanelRequest: (
				callback: (data: {
					requestId: string;
					panel: string;
					tab?: string;
				}) => void
			) => void;
			sendSwitchPanelResponse: (
				requestId: string,
				result?: { switched: boolean; panel: string; group: string },
				error?: string
			) => void;
			removeListeners: () => void;
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
		bundleFile: (
			filePath: string,
			compositionId: string
		) => Promise<{
			compositionId: string;
			success: boolean;
			code?: string;
			error?: string;
		}>;
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
		isClaudeAvailable: () => Promise<boolean>;
		onParsed: (callback: (data: Record<string, unknown>) => void) => void;
		removeParseListener: () => void;
		onSetScript: (callback: (data: { text: string }) => void) => void;
		onTriggerParse: (callback: () => void) => void;
		onStatusRequest: (callback: (data: { requestId: string }) => void) => void;
		sendStatusResponse: (
			requestId: string,
			result?: Record<string, unknown>,
			error?: string
		) => void;
		removeMoyinBridgeListeners: () => void;
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
