import type { MediaPortraitAdjustments } from "@/types/timeline";

const MAX_PROCESSING_DIMENSION = 4096;
const MAX_PROCESSING_PIXELS = 3840 * 2160;

export function portraitSourceDimensions({
	source,
}: {
	source: CanvasImageSource;
}) {
	if ("videoWidth" in source)
		return { width: source.videoWidth, height: source.videoHeight };
	if ("naturalWidth" in source)
		return { width: source.naturalWidth, height: source.naturalHeight };
	if ("displayWidth" in source)
		return { width: source.displayWidth, height: source.displayHeight };
	return {
		width: typeof source.width === "number" ? source.width : 0,
		height: typeof source.height === "number" ? source.height : 0,
	};
}

export function portraitProcessingSize({
	width,
	height,
	sourceWidth,
	sourceHeight,
	adjustments,
}: {
	width: number;
	height: number;
	sourceWidth: number;
	sourceHeight: number;
	adjustments?: MediaPortraitAdjustments;
}) {
	const base = { width, height };
	const hasBlemishRemoval =
		adjustments?.enabled &&
		((adjustments.values.face_adjust_SpotAcne ?? 0) > 0 ||
			adjustments.faces?.some(
				(face) => (face.values.face_adjust_SpotAcne ?? 0) > 0
			));
	if (
		!hasBlemishRemoval ||
		![width, height, sourceWidth, sourceHeight].every(
			(value) => Number.isFinite(value) && value > 0
		)
	)
		return base;

	// Preserve source freckles before GAN inference; never synthesize extra source detail.
	const scale = Math.min(
		2,
		sourceWidth / width,
		sourceHeight / height,
		MAX_PROCESSING_DIMENSION / Math.max(width, height),
		Math.sqrt(MAX_PROCESSING_PIXELS / (width * height))
	);
	if (scale <= 1) return base;
	return {
		width: Math.floor(width * scale),
		height: Math.floor(height * scale),
	};
}
