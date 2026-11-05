import type { CaptionTextMeasurer } from "@qcut/editor-core";
import { canvasFontFamily } from "@/lib/text/canvas-font";

export function createCanvasCaptionMeasurer({
	context,
}: {
	context: CanvasRenderingContext2D;
}): CaptionTextMeasurer {
	return (request) => {
		context.save();
		context.font = `${request.italic ? "italic" : "normal"} ${request.fontWeight} ${request.fontSize}px ${canvasFontFamily(request.fontFamily)}`;
		context.letterSpacing = `${request.letterSpacing}px`;
		const width = context.measureText(request.text).width;
		context.restore();
		return width;
	};
}

export function createBrowserCaptionMeasurer():
	| CaptionTextMeasurer
	| undefined {
	if (
		typeof document === "undefined" ||
		typeof CanvasRenderingContext2D === "undefined"
	)
		return;
	const context = document.createElement("canvas").getContext("2d");
	if (!context) return;
	return createCanvasCaptionMeasurer({ context });
}
