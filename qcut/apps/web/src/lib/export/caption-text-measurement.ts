import type { CaptionTextMeasurer } from "@qcut/editor-core";

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
	return (request) => {
		const family = request.fontFamily.replaceAll('"', "");
		context.font = `${request.italic ? "italic" : "normal"} ${request.fontWeight} ${request.fontSize}px "${family}"`;
		context.letterSpacing = `${request.letterSpacing}px`;
		return context.measureText(request.text).width;
	};
}
