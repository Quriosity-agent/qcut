/**
 * Sticker Overlay Filter Building
 *
 * Builds FFmpeg complex filter chains for sticker overlays.
 * Extracted from export-engine-cli.ts lines 883-955.
 */

import type { StickerSourceForFilter } from "../types";

/**
 * Logger function type for dependency injection.
 */
type LogFn = (...args: unknown[]) => void;

/**
 * Build FFmpeg complex filter chain for sticker overlays.
 *
 * Filter chain structure:
 * 1. Scale each sticker to desired dimensions
 * 2. Apply rotation if needed (prevents edge clipping)
 * 3. Apply opacity using format+geq (alpha blending)
 * 4. Overlay on previous layer at specific position with timing
 *
 * @param stickerSources - Array of sticker data with position, size, timing
 * @param totalDuration - Total video duration for timing constraints
 * @param logger - Optional logger function (defaults to console.log)
 * @returns FFmpeg complex filter chain string
 */
export function buildStickerOverlayFilters(
	stickerSources: StickerSourceForFilter[],
	totalDuration: number,
	logger: LogFn = console.log
): string {
	if (!stickerSources || stickerSources.length === 0) {
		return "";
	}

	logger(
		`[StickerOverlay] Building filters for ${stickerSources.length} stickers`
	);

	const filters: string[] = [];
	let lastOutput = "0:v"; // Start with base video stream

	for (const [index, sticker] of stickerSources.entries()) {
		const inputIndex = index + 1; // Sticker inputs start at 1 (0 is base video)
		const isLast = index === stickerSources.length - 1;
		const outputLabel = isLast ? "" : `[v${index + 1}]`;

		let currentInput = `[${inputIndex}:v]`;

		// Scale sticker to desired size
		const scaleFilter = `${currentInput}scale=${sticker.width}:${sticker.height}[scaled${index}]`;
		filters.push(scaleFilter);
		currentInput = `[scaled${index}]`;

		// Apply rotation if needed (before opacity)
		if (sticker.rotation !== undefined && sticker.rotation !== 0) {
			const rotateFilter = `${currentInput}rotate=${sticker.rotation}*PI/180:c=none[rotated${index}]`;
			filters.push(rotateFilter);
			currentInput = `[rotated${index}]`;
		}

		// Build overlay parameters
		const overlayParams = [`x=${sticker.x}`, `y=${sticker.y}`];

		// Add timing constraint
		if (sticker.startTime !== 0 || sticker.endTime !== totalDuration) {
			overlayParams.push(
				`enable='between(t,${sticker.startTime},${sticker.endTime})'`
			);
		}

		// Handle opacity
		if (sticker.opacity !== undefined && sticker.opacity < 1) {
			// Apply opacity using format and geq filters before overlay
			const opacityFilter = `${currentInput}format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${sticker.opacity}*alpha(X,Y)'[alpha${index}]`;
			filters.push(opacityFilter);

			// Update overlay to use opacity-adjusted input
			const overlayFilter = `[${lastOutput}][alpha${index}]overlay=${overlayParams.join(":")}${outputLabel}`;
			filters.push(overlayFilter);
		} else {
			// Direct overlay without opacity adjustment
			const overlayFilter = `[${lastOutput}]${currentInput}overlay=${overlayParams.join(":")}${outputLabel}`;
			filters.push(overlayFilter);
		}

		// Update last output for chaining
		if (outputLabel) {
			lastOutput = outputLabel.replace("[", "").replace("]", "");
		}
	}

	const filterChain = filters.join(";");
	logger(`[StickerOverlay] Generated filter chain: ${filterChain}`);

	return filterChain;
}
