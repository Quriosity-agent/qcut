export const COLOR_PREVIEW_MAX_WIDTH = 480;
export const PORTRAIT_PREVIEW_MAX_EDGE = 1920;

function validSize({ width, height }: { width: number; height: number }) {
	return (
		Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
	);
}

export function portraitPreviewCanvasSize({
	width,
	height,
}: {
	width: number;
	height: number;
}) {
	if (!validSize({ width, height })) return { width: 0, height: 0 };
	const scale = Math.min(
		1,
		PORTRAIT_PREVIEW_MAX_EDGE / Math.max(width, height)
	);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

export function colorPreviewCanvasSize({
	width,
	height,
}: {
	width: number;
	height: number;
}) {
	if (!validSize({ width, height })) return { width: 0, height: 0 };
	const scale = Math.min(1, COLOR_PREVIEW_MAX_WIDTH / width);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}
