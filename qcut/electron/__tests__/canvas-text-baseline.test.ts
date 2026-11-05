import { describe, expect, it } from "vitest";
import { canvasTextAssBaselineOffset } from "../types/canvas-text-baseline.js";

const arialMetrics = {
	ascentEm: 1854 / 2048,
	descentEm: 434 / 2048,
	canvasAscentEm: 1491 / 1922,
};

describe("Canvas em-top to ASS baseline", () => {
	it.each([
		{ verticalAlign: "top" as const, offset: -6.73046875 },
		{ verticalAlign: "middle" as const, offset: -8.88359375 },
		{ verticalAlign: "bottom" as const, offset: -11.03671875 },
	])("matches the measured Chromium Arial52 baseline for $verticalAlign", ({
		verticalAlign,
		offset,
	}) => {
		expect(
			canvasTextAssBaselineOffset({
				fontSize: 52,
				lineHeight: 1.2,
				verticalAlign,
				metrics: arialMetrics,
			})
		).toBeCloseTo(offset, 8);
	});

	it.each([
		undefined,
		{ ascentEm: 0.9 },
		{ ...arialMetrics, canvasAscentEm: Number.NaN },
		{ ...arialMetrics, descentEm: -0.1 },
		{ ...arialMetrics, canvasAscentEm: 1.1 },
	])("leaves unavailable or invalid baseline measurements uncorrected", (metrics) => {
		expect(
			canvasTextAssBaselineOffset({
				fontSize: 52,
				lineHeight: 1.2,
				verticalAlign: "middle",
				metrics,
			})
		).toBeUndefined();
	});
});
