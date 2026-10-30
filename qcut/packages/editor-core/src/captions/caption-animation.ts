import type { SubtitleStyle } from "../types/timeline.js";

export const CAPTION_ANIMATION_TYPES = [
	"none",
	"fade",
	"slide-up",
	"slide-left",
] as const;

export interface CaptionAnimationState {
	opacity: number;
	offsetX: number;
	offsetY: number;
}

function clamp({
	value,
	min,
	max,
}: {
	value: number;
	min: number;
	max: number;
}) {
	return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function resolveCaptionAnimation({ style }: { style: SubtitleStyle }) {
	return {
		type: style.animationType,
		duration: clamp({ value: style.animationDuration, min: 0.1, max: 10 }),
		delay: clamp({ value: style.animationDelay, min: 0, max: 60 }),
	};
}

/**
 * A caption's own fade in and out (N25), in seconds: `fadeInFrames` and
 * `fadeOutFrames` at `fps`; 0 when it has none (or no rate is known).
 */
export function resolveCaptionFades({
	style,
	fps,
}: {
	style: Pick<SubtitleStyle, "fadeInFrames" | "fadeOutFrames">;
	fps?: number;
}): { fadeIn: number; fadeOut: number } {
	const seconds = (frames: number | undefined) =>
		typeof frames === "number" && frames > 0 && fps !== undefined && fps > 0
			? frames / fps
			: 0;
	return {
		fadeIn: seconds(style.fadeInFrames),
		fadeOut: seconds(style.fadeOutFrames),
	};
}

/**
 * The fade an ASS event draws a caption with, its times in ms from the
 * event's start: `\fade` ramps alpha in over [t1, t2] and out over [t3, t4],
 * the way `getCaptionAnimationState` ramps opacity. Undefined when the
 * caption has no fade frames, so its animation keeps its own tags.
 */
export function captionAssFade({
	style,
	fps,
	duration,
}: {
	style: SubtitleStyle;
	fps?: number;
	/** The event's length in seconds. */
	duration: number;
}): string | undefined {
	const { fadeIn, fadeOut } = resolveCaptionFades({ style, fps });
	if (fadeIn <= 0 && fadeOut <= 0) return undefined;
	const animation = resolveCaptionAnimation({ style });
	const ms = (seconds: number) => Math.max(0, Math.round(seconds * 1000));
	const [t1, t2] =
		fadeIn > 0
			? [0, ms(fadeIn)]
			: animation.type === "none"
				? [0, 0]
				: [ms(animation.delay), ms(animation.delay + animation.duration)];
	const end = ms(duration);
	const t3 = fadeOut > 0 ? Math.max(t2, end - ms(fadeOut)) : end;
	return `\\fade(255,0,255,${t1},${t2},${t3},${end})`;
}

export function getCaptionAnimationState({
	style,
	startTime,
	currentTime,
	endTime,
	fps,
}: {
	style: SubtitleStyle;
	startTime: number;
	currentTime: number;
	/** With `fps`, for the caption's own fade frames. */
	endTime?: number;
	fps?: number;
}): CaptionAnimationState {
	const state = animatedState({ style, startTime, currentTime });
	// The caption's own fade frames: a fade-in takes over the animation's
	// opacity ramp (a slide still moves), a fade-out ends at the caption's end.
	const { fadeIn, fadeOut } = resolveCaptionFades({ style, fps });
	if (fadeIn <= 0 && fadeOut <= 0) return state;
	const ramp = (value: number) => clamp({ value, min: 0, max: 1 });
	const fadeInOpacity =
		fadeIn > 0 ? ramp((currentTime - startTime) / fadeIn) : state.opacity;
	const fadeOutOpacity =
		fadeOut > 0 && endTime !== undefined
			? ramp((endTime - currentTime) / fadeOut)
			: 1;
	return { ...state, opacity: fadeInOpacity * fadeOutOpacity };
}

function animatedState({
	style,
	startTime,
	currentTime,
}: {
	style: SubtitleStyle;
	startTime: number;
	currentTime: number;
}): CaptionAnimationState {
	const animation = resolveCaptionAnimation({ style });
	if (animation.type === "none") {
		return { opacity: 1, offsetX: 0, offsetY: 0 };
	}

	const elapsed = currentTime - startTime - animation.delay;
	const progress = clamp({
		value: elapsed / animation.duration,
		min: 0,
		max: 1,
	});
	const remaining = 1 - progress;

	if (animation.type === "slide-up") {
		return { opacity: progress, offsetX: 0, offsetY: 80 * remaining };
	}
	if (animation.type === "slide-left") {
		return { opacity: progress, offsetX: 120 * remaining, offsetY: 0 };
	}
	return { opacity: progress, offsetX: 0, offsetY: 0 };
}
