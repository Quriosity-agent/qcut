/**
 * Export Mode Decision Logic for CLI Export
 *
 * Resolves word filter segments and builds the final export options object.
 */

import { useWordTimelineStore } from "@/stores/timeline/word-timeline-store";
import { WORD_FILTER_STATE } from "@/types/word-timeline";
import { calculateKeepSegments } from "../transcription/segment-calculator";
import { debugLog, debugWarn } from "@/lib/debug/debug-config";
import type { ExportAnalysis } from "./export-analysis";
import type {
	AudioFileInput,
	VideoSourceInput,
	StickerSourceForFilter,
	ImageSourceInput,
} from "../export-cli/types";

export interface WordFilterResult {
	hasWordFilters: boolean;
	wordFilterSegments?: Array<{ start: number; end: number }>;
}

export function resolveWordFilters(
	totalDuration: number,
	videoInput: { path: string; trimStart: number; trimEnd: number } | null
): WordFilterResult {
	const wordTimelineData = useWordTimelineStore.getState().data;
	const hasWordFilters =
		wordTimelineData?.words.some(
			(word) =>
				word.filterState === WORD_FILTER_STATE.AI ||
				word.filterState === WORD_FILTER_STATE.USER_REMOVE
		) || false;

	debugLog(
		`[CLI Export] Word timeline data: ${wordTimelineData ? `${wordTimelineData.words.length} words` : "null"}`
	);
	if (wordTimelineData) {
		const stateCounts: Record<string, number> = {};
		for (const w of wordTimelineData.words) {
			stateCounts[w.filterState] = (stateCounts[w.filterState] || 0) + 1;
		}
		debugLog("[CLI Export] Filter state breakdown:", stateCounts);
	}
	debugLog(
		`[CLI Export] hasWordFilters: ${hasWordFilters}, videoInput: ${!!videoInput}`
	);

	let wordFilterSegments: Array<{ start: number; end: number }> | undefined;

	if (hasWordFilters && videoInput && wordTimelineData) {
		const filteredWords = wordTimelineData.words.filter(
			(w) =>
				w.filterState === WORD_FILTER_STATE.AI ||
				w.filterState === WORD_FILTER_STATE.USER_REMOVE
		);
		console.log(
			`[CLI Export] Word filters active: ${filteredWords.length} words marked for removal`
		);
		for (const w of filteredWords) {
			console.log(
				`  [REMOVE] "${w.text}" (${w.start.toFixed(2)}s\u2013${w.end.toFixed(2)}s) state=${w.filterState}`
			);
		}

		const keepSegments = calculateKeepSegments({
			words: wordTimelineData.words,
			videoDuration: totalDuration,
			options: { bufferMs: 50, crossfadeMs: 30, minGapMs: 50 },
		});

		console.log(
			`[CLI Export] Keep segments (${keepSegments.length}):`,
			keepSegments.map(
				(s) => `${s.start.toFixed(2)}s\u2013${s.end.toFixed(2)}s`
			)
		);

		const isFullLengthSegment =
			keepSegments.length === 1 &&
			Math.abs(keepSegments[0].start - 0) < 0.001 &&
			Math.abs(keepSegments[0].end - totalDuration) < 0.001;
		if (!isFullLengthSegment) {
			wordFilterSegments = keepSegments;
		}
	} else if (hasWordFilters && !videoInput) {
		debugWarn(
			"[CLI Export] Word filter cuts requested, but no single video input is available. Falling back to standard export."
		);
	}

	return { hasWordFilters, wordFilterSegments };
}

export interface BuildExportOptionsParams {
	sessionId: string;
	canvasWidth: number;
	canvasHeight: number;
	quality: string;
	totalDuration: number;
	audioFiles: AudioFileInput[];
	combinedFilterChain: string;
	textFilterChain: string;
	stickerFilterChain: string | undefined;
	stickerSources: StickerSourceForFilter[];
	imageFilterChain: string | undefined;
	imageSources: ImageSourceInput[];
	exportAnalysis: ExportAnalysis | null;
	hasTextFilters: boolean;
	hasStickerFilters: boolean;
	wordFilterSegments: Array<{ start: number; end: number }> | undefined;
	videoSources: VideoSourceInput[];
	videoInput: { path: string; trimStart: number; trimEnd: number } | null;
}

export function buildExportOptions(params: BuildExportOptionsParams) {
	const {
		sessionId,
		canvasWidth,
		canvasHeight,
		quality,
		totalDuration,
		audioFiles,
		combinedFilterChain,
		textFilterChain,
		stickerFilterChain,
		stickerSources,
		imageFilterChain,
		imageSources,
		exportAnalysis,
		hasTextFilters,
		hasStickerFilters,
		wordFilterSegments,
		videoSources,
		videoInput,
	} = params;

	const hasImageFilters = imageSources.length > 0;

	return {
		sessionId,
		width: canvasWidth,
		height: canvasHeight,
		fps: 30,
		quality: quality || "medium",
		duration: totalDuration,
		audioFiles,
		filterChain: combinedFilterChain || undefined,
		textFilterChain: hasTextFilters ? textFilterChain : undefined,
		stickerFilterChain,
		stickerSources,
		imageFilterChain,
		imageSources,
		useDirectCopy: !!(
			exportAnalysis?.canUseDirectCopy &&
			exportAnalysis?.optimizationStrategy !== "video-normalization" &&
			!hasTextFilters &&
			!hasStickerFilters &&
			!hasImageFilters &&
			!wordFilterSegments
		),
		videoSources: videoSources.length > 0 ? videoSources : undefined,
		useVideoInput: !!videoInput,
		videoInputPath: videoInput?.path,
		trimStart: videoInput?.trimStart || 0,
		trimEnd: videoInput?.trimEnd || 0,
		wordFilterSegments,
		crossfadeMs: 30,
		optimizationStrategy: exportAnalysis?.optimizationStrategy,
	};
}
