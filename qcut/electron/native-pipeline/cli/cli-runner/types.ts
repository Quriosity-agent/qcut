/**
 * Types for CLI Pipeline Runner.
 * @module electron/native-pipeline/cli/cli-runner/types
 */

export interface CLIRunOptions {
	command: string;
	model?: string;
	text?: string;
	imageUrl?: string;
	videoUrl?: string;
	audioUrl?: string;
	outputDir: string;
	config?: string;
	input?: string;
	duration?: string;
	aspectRatio?: string;
	resolution?: string;
	saveIntermediates: boolean;
	parallel?: boolean;
	maxWorkers?: number;
	json: boolean;
	verbose: boolean;
	quiet: boolean;
	category?: string;
	prompt?: string;
	layout?: string;
	upscale?: string;
	keyName?: string;
	keyValue?: string;
	idea?: string;
	script?: string;
	novel?: string;
	title?: string;
	maxScenes?: number;
	scriptsOnly?: boolean;
	storyboardOnly?: boolean;
	noPortraits?: boolean;
	llmModel?: string;
	imageModel?: string;
	videoModel?: string;
	image?: string;
	stream?: boolean;
	configDir?: string;
	cacheDir?: string;
	stateDir?: string;
	negativePrompt?: string;
	voiceId?: string;
	directory?: string;
	dryRun?: boolean;
	recursive?: boolean;
	includeOutput?: boolean;
	source?: string;
	reveal?: boolean;
	noConfirm?: boolean;
	promptFile?: string;
	portraits?: string;
	views?: string;
	maxCharacters?: number;
	saveRegistry?: boolean;
	style?: string;
	referenceModel?: string;
	referenceStrength?: number;
	// transcribe options
	language?: string;
	noDiarize?: boolean;
	noTagEvents?: boolean;
	keyterms?: string[];
	srt?: boolean;
	srtMaxWords?: number;
	srtMaxDuration?: number;
	rawJson?: boolean;
	// transfer-motion options
	orientation?: string;
	noSound?: boolean;
	// generate-avatar options
	referenceImages?: string[];
	// analyze-video options
	analysisType?: string;
	outputFormat?: string;
	// upscale-image options
	target?: string;
	// vimax options
	noReferences?: boolean;
	projectId?: string;
	// grid upscale
	gridUpscale?: number;
	// editor options
	mediaId?: string;
	elementId?: string;
	jobId?: string;
	trackId?: string;
	toTrack?: string;
	splitTime?: number;
	startTime?: number;
	endTime?: number;
	newName?: string;
	changes?: string;
	updates?: string;
	elements?: string;
	cuts?: string;
	items?: string;
	preset?: string;
	threshold?: number;
	timestamps?: string;
	host?: string;
	port?: string;
	token?: string;
	poll?: boolean;
	pollInterval?: number;
	replace?: boolean;
	ripple?: boolean;
	crossTrackRipple?: boolean;
	removeFillers?: boolean;
	removeSilences?: boolean;
	html?: string;
	message?: string;
	stack?: string;
	addToTimeline?: boolean;
	includeFillers?: boolean;
	includeSilences?: boolean;
	includeScenes?: boolean;
	toolName?: string;
	clearLog?: boolean;
	data?: string;
	url?: string;
	filename?: string;
	mode?: string;
	gap?: number;
	// generate-remotion options
	fps?: number;
	width?: number;
	height?: number;
	timeout?: number;
	provider?: string;
	loadSpeech?: boolean;
	// screen-recording options
	sourceId?: string;
	discard?: boolean;
	// ui options
	panel?: string;
}

export interface CLIResult {
	success: boolean;
	outputPath?: string;
	outputPaths?: string[];
	error?: string;
	cost?: number;
	duration?: number;
	data?: unknown;
}

export type ProgressFn = (progress: {
	stage: string;
	percent: number;
	message: string;
	model?: string;
}) => void;
