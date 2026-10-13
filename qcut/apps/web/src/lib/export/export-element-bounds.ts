import type { TimelineElement } from "@/types/timeline";
import { mediaObjectFitBounds } from "../media/media-object-fit-bounds";

/** Calculate element bounds using the same object-fit semantics as preview. */
export function calculateElementBounds(
	element: TimelineElement,
	mediaWidth: number,
	mediaHeight: number,
	canvasWidth: number,
	canvasHeight: number
): { x: number; y: number; width: number; height: number } {
	if (element.type === "media")
		return mediaObjectFitBounds({
			sourceWidth: mediaWidth,
			sourceHeight: mediaHeight,
			canvasWidth,
			canvasHeight,
			fitMode: element.fitMode ?? "cover",
		});
	const canvasAspect = canvasWidth / canvasHeight;
	const mediaAspect = mediaWidth / mediaHeight;

	let width: number;
	let height: number;

	const isSmaller = mediaWidth <= canvasWidth && mediaHeight <= canvasHeight;
	if (isSmaller) {
		width = mediaWidth;
		height = mediaHeight;
	} else if (mediaAspect > canvasAspect) {
		width = canvasWidth;
		height = width / mediaAspect;
	} else {
		width = canvasHeight * mediaAspect;
		height = canvasHeight;
	}

	const x = (canvasWidth - width) / 2;
	const y = (canvasHeight - height) / 2;

	const isTextLike = element.type === "text" || element.type === "markdown";
	const elementX = isTextLike ? element.x : undefined;
	const elementY = isTextLike ? element.y : undefined;

	return {
		x: elementX ?? x,
		y: elementY ?? y,
		width,
		height,
	};
}
