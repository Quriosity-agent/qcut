import { describe, expect, it } from "vitest";
import { calculateElementBounds } from "@/lib/export/export-element-bounds";
import type { MediaElement, MediaPortraitAdjustments } from "@/types/timeline";
import { prepareColorPreviewInput } from "../color-preview-input";

function portraitImage({ width, height }: { width: number; height: number }) {
	const source = document.createElement("img");
	Object.defineProperties(source, {
		naturalWidth: { value: width },
		naturalHeight: { value: height },
	});
	return source;
}

const element: MediaElement = {
	id: "portrait",
	type: "media",
	mediaId: "source",
	name: "Portrait",
	startTime: 0,
	duration: 2,
	trimStart: 0,
	trimEnd: 0,
};

describe("portrait preview engine input", () => {
	it.each([
		{ fitMode: "cover" as const },
		{ fitMode: "contain" as const },
		{ fitMode: "fill" as const },
	])("uses the same uncropped $fitMode bounds as export for both engines", ({
		fitMode,
	}) => {
		const source = portraitImage({ width: 360, height: 659 });
		const bounds = calculateElementBounds(
			{ ...element, fitMode },
			360,
			659,
			1080,
			1920
		);
		for (const engine of ["native", "independent"] as const) {
			const input = prepareColorPreviewInput({
				source,
				canvasSize: { width: 540, height: 960 },
				portraitRenderSize: { width: 1080, height: 1920 },
				fitMode,
				adjustments: {
					enabled: true,
					engine,
					values: { face_adjust_Whiten: 45 },
				},
			});
			expect(input?.source).toBe(source);
			expect(input?.geometry.bounds).toEqual(bounds);
			expect(input?.geometry.processing).toEqual({
				width: Math.round(bounds.width),
				height: Math.round(bounds.height),
			});
			expect(input?.preRollFit).toBe("fill");
		}
	});

	it("bounds panoramic cover input by the same independent pixel budget", () => {
		const input = prepareColorPreviewInput({
			source: portraitImage({ width: 3840, height: 2160 }),
			canvasSize: { width: 1080, height: 1920 },
			portraitRenderSize: { width: 2160, height: 3840 },
			fitMode: "cover",
			adjustments: {
				enabled: true,
				engine: "independent",
				values: { face_adjust_Whiten: 45 },
			},
		});
		expect(input?.geometry.bounds.width).toBeCloseTo((3840 * 3840) / 2160);
		expect(input?.geometry.processing).toEqual({ width: 3840, height: 2159 });
	});

	it("retains high-resolution native blemish sampling without an early crop", () => {
		const source = portraitImage({ width: 4000, height: 6000 });
		const adjustments: MediaPortraitAdjustments = {
			enabled: true,
			values: { face_adjust_SpotAcne: 50 },
		};
		const input = prepareColorPreviewInput({
			source,
			canvasSize: { width: 1080, height: 1620 },
			fitMode: "fill",
			adjustments,
		});
		expect(input?.source).toBe(source);
		expect(input?.geometry.processing).toEqual({ width: 2160, height: 3240 });
	});

	it("uses display dimensions until a logical render size is available", () => {
		const input = prepareColorPreviewInput({
			source: portraitImage({ width: 1080, height: 1920 }),
			canvasSize: { width: 270, height: 480 },
			portraitRenderSize: { width: Number.NaN, height: 1920 },
			fitMode: "fill",
			adjustments: {
				enabled: true,
				engine: "independent",
				values: { face_adjust_Whiten: 45 },
			},
		});
		expect(input?.geometry.logicalSize).toEqual({ width: 270, height: 480 });
	});

	it("does not process sources before their dimensions are known", () => {
		expect(
			prepareColorPreviewInput({
				source: portraitImage({ width: 0, height: 0 }),
				canvasSize: { width: 1080, height: 1920 },
				fitMode: "cover",
			})
		).toBeUndefined();
	});
});
