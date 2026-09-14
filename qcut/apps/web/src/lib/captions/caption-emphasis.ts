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

type EmphasisCaption = Pick<
	CaptionElement,
	"id" | "style" | "emphasis" | "emphasisBaseStyle"
>;

export interface CaptionEmphasisUpdate {
	id: string;
	updates: Pick<CaptionElement, "emphasis" | "emphasisBaseStyle" | "style">;
}

/**
 * Updates that mark captions as key points with a preset. A caption's own
 * look is remembered the first time it is emphasized, so clearing can bring
 * it back; re-applying never overwrites that memory with a highlight look.
 */
export function applyEmphasisUpdates({
	captions,
	ids,
	preset,
}: {
	captions: readonly EmphasisCaption[];
	ids: readonly string[];
	preset: CaptionStylePreset;
}): CaptionEmphasisUpdate[] {
	const targets = new Set(ids);
	return captions
		.filter((caption) => targets.has(caption.id))
		.map((caption) => ({
			id: caption.id,
			updates: {
				emphasis: true,
				style: structuredClone(preset.style),
				...(caption.emphasis
					? {}
					: { emphasisBaseStyle: resolveSubtitleStyle(caption.style) }),
			},
		}));
}

/**
 * Updates that clear every key point: each caption gets back the look it had
 * before, or the lane's plain look when none was remembered (captions created
 * already highlighted). The store merges styles, so keys only the highlight
 * carried, such as its karaoke settings, are cleared explicitly.
 */
export function clearEmphasisUpdates({
	captions,
}: {
	captions: readonly EmphasisCaption[];
}): CaptionEmphasisUpdate[] {
	const laneBase = resolveLaneBaseStyle({ captions });
	return captions
		.filter((caption) => caption.emphasis)
		.map((caption) => {
			const restored = structuredClone(caption.emphasisBaseStyle ?? laneBase);
			const cleared: Partial<Record<keyof SubtitleStyle, undefined>> = {};
			for (const key of Object.keys(caption.style ?? {})) {
				cleared[key as keyof SubtitleStyle] = undefined;
			}
			return {
				id: caption.id,
				updates: {
					emphasis: false,
					emphasisBaseStyle: undefined,
					style: { ...cleared, ...restored },
				},
			};
		});
}
