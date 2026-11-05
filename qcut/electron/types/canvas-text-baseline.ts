export interface CanvasTextBaselineMetrics {
	ascentEm?: number;
	descentEm?: number;
	canvasAscentEm?: number;
}

export function canvasTextAssBaselineOffset({
	fontSize,
	lineHeight,
	verticalAlign,
	metrics,
}: {
	fontSize: number;
	lineHeight: number;
	verticalAlign: "top" | "middle" | "bottom";
	metrics?: CanvasTextBaselineMetrics;
}): number | undefined {
	const { ascentEm, descentEm, canvasAscentEm } = metrics ?? {};
	if (
		ascentEm === undefined ||
		descentEm === undefined ||
		canvasAscentEm === undefined ||
		!Number.isFinite(ascentEm) ||
		!Number.isFinite(descentEm) ||
		!Number.isFinite(canvasAscentEm) ||
		ascentEm < 0 ||
		descentEm < 0 ||
		ascentEm + descentEm <= 0 ||
		canvasAscentEm < 0 ||
		canvasAscentEm > 1
	)
		return undefined;
	// Chromium normalizes OS/2 typo metrics to the em, quantized to 1/64 px.
	// ASS aligns its ascent/descent box; Canvas draws from the line box's top.
	const canvasAscent = Math.round(fontSize * canvasAscentEm * 64) / 64;
	if (verticalAlign === "top") return canvasAscent - fontSize * ascentEm;
	if (verticalAlign === "bottom") {
		return canvasAscent - fontSize * lineHeight + fontSize * descentEm;
	}
	return canvasAscent - (fontSize * (lineHeight + ascentEm - descentEm)) / 2;
}
