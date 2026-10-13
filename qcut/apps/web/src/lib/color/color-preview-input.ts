import { hasMediaPortraitAdjustments } from "@qcut/editor-core";
import { mediaObjectFitBounds } from "@/lib/media/media-object-fit-bounds";
import {
	portraitProcessingSize,
	portraitSourceDimensions,
} from "@/lib/portrait/portrait-processing-size";
import type { MediaPortraitAdjustments } from "@/types/timeline";

export function prepareColorPreviewInput({
	source,
	canvasSize,
	portraitRenderSize,
	fitMode,
	adjustments,
}: {
	source: CanvasImageSource;
	canvasSize: { width: number; height: number };
	portraitRenderSize?: { width: number; height: number };
	fitMode: "cover" | "contain" | "fill";
	adjustments?: MediaPortraitAdjustments;
}) {
	const sourceSize = portraitSourceDimensions({ source });
	if (sourceSize.width <= 0 || sourceSize.height <= 0) return;
	const hasPortrait = hasMediaPortraitAdjustments({ adjustments });
	const hasLogicalSize =
		portraitRenderSize &&
		[portraitRenderSize.width, portraitRenderSize.height].every(
			(value) => Number.isFinite(value) && value > 0
		);
	const logicalSize =
		hasPortrait && hasLogicalSize ? portraitRenderSize : canvasSize;
	const sourceBounds = mediaObjectFitBounds({
		sourceWidth: sourceSize.width,
		sourceHeight: sourceSize.height,
		canvasWidth: logicalSize.width,
		canvasHeight: logicalSize.height,
		fitMode,
	});
	const bounds = hasPortrait ? sourceBounds : { x: 0, y: 0, ...canvasSize };
	const processing = portraitProcessingSize({
		width: Math.max(1, Math.round(bounds.width)),
		height: Math.max(1, Math.round(bounds.height)),
		sourceWidth: sourceSize.width,
		sourceHeight: sourceSize.height,
		adjustments,
	});
	const geometry = { sourceSize, logicalSize, bounds, processing };
	if (hasPortrait)
		return {
			source,
			geometry,
			preRollFit: "fill" as const,
			portraitActive: true,
		};

	const fitted = document.createElement("canvas");
	fitted.width = canvasSize.width;
	fitted.height = canvasSize.height;
	const context = fitted.getContext("2d", {
		willReadFrequently: Boolean(adjustments?.enabled),
	});
	if (!context) return;
	context.drawImage(
		source,
		sourceBounds.x,
		sourceBounds.y,
		sourceBounds.width,
		sourceBounds.height
	);
	return {
		source: fitted,
		geometry,
		preRollFit: fitMode,
		portraitActive: false,
	};
}
