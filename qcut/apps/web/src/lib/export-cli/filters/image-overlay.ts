/**
 * Image Overlay Filter Building
 *
 * Builds FFmpeg complex filter chains for image overlays.
 * Pattern based on sticker-overlay.ts with aspect-ratio preservation.
 */

import type { ImageSourceInput } from "../types";

/**
 * Logger function type for dependency injection.
 */
type LogFn = (...args: unknown[]) => void;

/**
 * Build FFmpeg complex filter chain for image overlays.
 *
 * Filter chain structure:
 * 1. Scale each image to fit canvas (maintain aspect ratio)
 * 2. Pad to exact canvas size with black bars if needed
 * 3. Apply timing via setpts to position image on timeline
 * 4. Overlay on previous layer with enable timing constraint
 *
 * FFmpeg pattern for each image:
 * [img]scale=W:H:force_original_aspect_ratio=decrease,
 *      pad=W:H:(ow-iw)/2:(oh-ih)/2:black,
 *      setpts=PTS+START_TIME/TB[img_timed];
 * [base][img_timed]overlay=0:0:enable='between(t,START,END)'[out]
 *
 * @param imageSources - Array of image data with path, timing, dimensions
 * @param canvasWidth - Export canvas width in pixels
 * @param canvasHeight - Export canvas height in pixels
 * @param videoInputCount - Number of video inputs before images (for stream indexing)
 * @param logger - Optional logger function (defaults to console.log)
 * @returns FFmpeg complex filter chain string
 */
export function buildImageOverlayFilters(
	imageSources: ImageSourceInput[],
	canvasWidth: number,
	canvasHeight: number,
	videoInputCount = 1,
	logger: LogFn = console.log
): string {
	if (!imageSources || imageSources.length === 0) {
		return "";
	}

	logger(
		`[ImageOverlay] Building filters for ${imageSources.length} images (canvas: ${canvasWidth}x${canvasHeight})`
	);

	const filters: string[] = [];
	let lastOutput = "0:v"; // Start with base video stream

	for (const [index, image] of imageSources.entries()) {
		// Image inputs come after video inputs
		const inputIndex = videoInputCount + index;
		const isLast = index === imageSources.length - 1;
		const outputLabel = isLast ? "" : `[v${index + 1}]`;

		let currentInput = `[${inputIndex}:v]`;

		// Scale image to fit canvas while maintaining aspect ratio
		// force_original_aspect_ratio=decrease ensures image fits within canvas
		const scaleFilter = `${currentInput}scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease[scaled${index}]`;
		filters.push(scaleFilter);
		currentInput = `[scaled${index}]`;

		// Pad to exact canvas size with black bars if needed
		// (ow-iw)/2 centers horizontally, (oh-ih)/2 centers vertically
		const padFilter = `${currentInput}pad=${canvasWidth}:${canvasHeight}:(ow-iw)/2:(oh-ih)/2:black[padded${index}]`;
		filters.push(padFilter);
		currentInput = `[padded${index}]`;

		// Apply timing offset via setpts
		// This shifts the image PTS to align with its timeline position
		const setptsFilter = `${currentInput}setpts=PTS+${image.startTime}/TB[timed${index}]`;
		filters.push(setptsFilter);
		currentInput = `[timed${index}]`;

		// Build overlay parameters
		// Images are centered (already padded), so x=0, y=0
		const overlayParams = ["x=0", "y=0"];

		// Add timing constraint using enable filter
		const endTime = image.startTime + image.duration;
		overlayParams.push(`enable='between(t,${image.startTime},${endTime})'`);

		// Overlay image on previous layer
		const overlayFilter = `[${lastOutput}]${currentInput}overlay=${overlayParams.join(":")}${outputLabel}`;
		filters.push(overlayFilter);

		// Update last output for chaining
		if (outputLabel) {
			lastOutput = outputLabel.replace("[", "").replace("]", "");
		}

		logger(
			`[ImageOverlay] Image ${index + 1}: ${image.elementId} (${image.startTime}s-${endTime}s)`
		);
	}

	const filterChain = filters.join(";");
	logger(`[ImageOverlay] Generated filter chain: ${filterChain}`);

	return filterChain;
}

/**
 * Calculate the input stream index offset for images.
 * Images come after video inputs in the FFmpeg command.
 *
 * Input order: [video] [images...] [stickers...] [audio...]
 *
 * @param videoInputCount - Number of video inputs (typically 1)
 * @returns Starting index for image inputs
 */
export function getImageInputStartIndex(videoInputCount: number): number {
	return videoInputCount;
}
