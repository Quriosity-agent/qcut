export function mediaObjectFitBounds({
	sourceWidth,
	sourceHeight,
	canvasWidth,
	canvasHeight,
	fitMode,
}: {
	sourceWidth: number;
	sourceHeight: number;
	canvasWidth: number;
	canvasHeight: number;
	fitMode: "cover" | "contain" | "fill";
}) {
	if (fitMode === "fill")
		return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
	const scale =
		fitMode === "cover"
			? Math.max(canvasWidth / sourceWidth, canvasHeight / sourceHeight)
			: Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
	const width = sourceWidth * scale;
	const height = sourceHeight * scale;
	return {
		x: (canvasWidth - width) / 2,
		y: (canvasHeight - height) / 2,
		width,
		height,
	};
}
