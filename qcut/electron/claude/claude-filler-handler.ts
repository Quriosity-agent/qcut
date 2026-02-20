/**
 * Claude Filler Detection HTTP Handler
 * Thin HTTP wrapper around the existing ai-filler-handler.ts IPC logic.
 * Returns filler words, silence gaps, and timing summaries.
 */

import { claudeLog } from "./utils/logger.js";
import { sanitizeProjectId } from "./utils/helpers.js";
import { analyzeFillersWithPriority } from "../ai-filler-handler.js";
import type {
	FillerAnalysisRequest,
	FillerAnalysisResult,
	FillerWord,
	SilenceGap,
} from "../types/claude-api";

const HANDLER_NAME = "Filler";
const LONG_SILENCE_THRESHOLD = 1.0; // seconds

/**
 * Analyze words for fillers and silence gaps.
 * Wraps the existing tri-provider filler analysis (Gemini → Claude → pattern).
 */
export async function analyzeFillers(
	projectId: string,
	request: FillerAnalysisRequest
): Promise<FillerAnalysisResult> {
	const safeProjectId = sanitizeProjectId(projectId);

	claudeLog.info(
		HANDLER_NAME,
		`Filler analysis: project=${safeProjectId}, words=${request.words.length}`
	);

	if (!request.words || request.words.length === 0) {
		return {
			fillers: [],
			silences: [],
			totalFillerTime: 0,
			totalSilenceTime: 0,
		};
	}

	// Call existing tri-provider analysis
	const result = await analyzeFillersWithPriority({
		request: {
			words: request.words,
			languageCode: "auto",
		},
	});

	claudeLog.info(
		HANDLER_NAME,
		`Provider: ${result.provider}, filtered: ${result.filteredWordIds.length}`
	);

	// Build lookup of filtered word IDs
	const filteredIds = new Set(result.filteredWordIds.map((d) => d.id));
	const reasonMap = new Map(
		result.filteredWordIds.map((d) => [d.id, d.reason])
	);

	// Separate fillers and silences
	const fillers: FillerWord[] = [];
	const silences: SilenceGap[] = [];

	for (const word of request.words) {
		if (word.type === "spacing") {
			const duration = Math.max(0, word.end - word.start);
			if (duration > LONG_SILENCE_THRESHOLD) {
				silences.push({
					start: word.start,
					end: word.end,
					duration: Math.round(duration * 100) / 100,
				});
			}
			continue;
		}

		if (filteredIds.has(word.id)) {
			fillers.push({
				word: word.text,
				start: word.start,
				end: word.end,
				reason: reasonMap.get(word.id) || "AI suggestion",
			});
		}
	}

	const totalFillerTime = fillers.reduce(
		(sum, f) => sum + Math.max(0, f.end - f.start),
		0
	);
	const totalSilenceTime = silences.reduce((sum, s) => sum + s.duration, 0);

	return {
		fillers,
		silences,
		totalFillerTime: Math.round(totalFillerTime * 100) / 100,
		totalSilenceTime: Math.round(totalSilenceTime * 100) / 100,
	};
}

// CommonJS export for compatibility
module.exports = { analyzeFillers };
