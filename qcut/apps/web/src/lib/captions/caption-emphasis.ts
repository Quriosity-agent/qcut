import {
	CAPTION_STYLE_PRESETS,
	type CaptionStylePreset,
} from "@/lib/captions/caption-style-presets";
import { resolveSubtitleStyle } from "@/lib/captions/subtitle-style";
import { getQuoteCandidateScore } from "@/lib/captions/workbench";
import type { TranscriptionSegment } from "@/types/captions";
import type { CaptionElement, SubtitleStyle } from "@/types/timeline";

export const DEFAULT_EMPHASIS_PRESET_ID = "knowledge-highlight";

/** The preset used for key-point captions; unknown ids fall back to the default. */
export function findEmphasisPreset({
	presetId,
}: {
	presetId: string;
}): CaptionStylePreset {
	return (
		CAPTION_STYLE_PRESETS.find((preset) => preset.id === presetId) ??
		CAPTION_STYLE_PRESETS.find(
			(preset) => preset.id === DEFAULT_EMPHASIS_PRESET_ID
		) ??
		CAPTION_STYLE_PRESETS[0]
	);
}

/**
 * Local fallback for 自动划重点: score every caption like the workbench's
 * quote finder and keep the strongest fifth (at least one, at most five).
 */
export function pickEmphasisCandidates({
	captions,
}: {
	captions: readonly Pick<CaptionElement, "id" | "text">[];
}): string[] {
	const limit = Math.min(5, Math.max(1, Math.round(captions.length * 0.2)));
	return captions
		.map((caption) => ({
			id: caption.id,
			score: getQuoteCandidateScore({ text: caption.text }),
		}))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((item) => item.id);
}

/** Timeline captions as the segments the key-point labeler expects (ids are indexes). */
export function captionsToSegments({
	captions,
}: {
	captions: readonly Pick<CaptionElement, "text" | "startTime" | "duration">[];
}): TranscriptionSegment[] {
	return captions.map((caption, index) => ({
		id: index,
		seek: 0,
		start: caption.startTime,
		end: caption.startTime + caption.duration,
		text: caption.text,
		tokens: [],
		temperature: 0,
		avg_logprob: 0,
		compression_ratio: 1,
		no_speech_prob: 0,
	}));
}

/**
 * The look plain captions share on this lane: the first non-emphasized
 * caption's style, else the default subtitle style.
 */
export function resolveLaneBaseStyle({
	captions,
}: {
	captions: readonly Pick<CaptionElement, "style" | "emphasis">[];
}): SubtitleStyle {
	const plain = captions.find((caption) => !caption.emphasis);
	return resolveSubtitleStyle(plain?.style);
}
