import type { MediaPortraitAdjustments } from "@/types/timeline";

const MAX_PROCESSING_DIMENSION = 4096;
const MAX_PROCESSING_PIXELS = 3840 * 2160;
export const INDEPENDENT_PORTRAIT_MAX_EDGE = MAX_PROCESSING_DIMENSION;
export const INDEPENDENT_PORTRAIT_MAX_PIXELS = MAX_PROCESSING_PIXELS;

export function independentPortraitDimensionsValid({
	width,
	height,
}: {
	width: number;
	height: number;
}) {
	return (
		[width, height].every(
			(value) =>
				Number.isInteger(value) &&
				value > 0 &&
				value <= INDEPENDENT_PORTRAIT_MAX_EDGE
		) && width * height <= INDEPENDENT_PORTRAIT_MAX_PIXELS
	);
}

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
	if (adjustments?.engine === "independent") {
		if (![width, height].every((value) => Number.isFinite(value) && value > 0))
			return base;
		const scale = Math.min(
			1,
			INDEPENDENT_PORTRAIT_MAX_EDGE / Math.max(width, height),
			Math.sqrt(INDEPENDENT_PORTRAIT_MAX_PIXELS / (width * height))
		);
		if (scale === 1) return base;
		return {
			width: Math.max(1, Math.floor(width * scale)),
			height: Math.max(1, Math.floor(height * scale)),
		};
	}
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
