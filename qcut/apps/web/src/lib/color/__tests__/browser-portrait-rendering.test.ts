import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderJianyingPortraitAdjustmentPreview } from "@/lib/portrait/jianying-portrait-adjustment-preview";
import { drawMediaSourceWithMasks } from "@/lib/video/media-mask-canvas";
import {
	drawColorGradedSourceStack,
	drawColorGradedSourceWithMasks,
} from "../browser-color-rendering";
import { DEFAULT_MEDIA_COLOR_SETTINGS } from "../color-properties";

vi.mock("@/lib/portrait/jianying-portrait-adjustment-preview", () => ({
	renderJianyingPortraitAdjustmentPreview: vi.fn(),
}));
vi.mock("@/lib/video/media-mask-canvas", () => ({
	drawMediaSourceWithMasks: vi.fn(),
}));

describe("portrait source detail reaches the native renderer", () => {
	const source = document.createElement("canvas");
	source.width = 4000;
	source.height = 6000;
	const context = {
		drawImage: vi.fn(),
		getImageData: vi.fn(
			(_x: number, _y: number, width: number, height: number) =>
				({
					width,
					height,
					data: new Uint8ClampedArray(0),
					colorSpace: "srgb",
				}) as ImageData
		),
		putImageData: vi.fn(),
	};
	const args = {
		context: context as unknown as CanvasRenderingContext2D,
		source,
		x: 12,
		y: 24,
		width: 1080,
		height: 1620,
		masks: [],
		settings: DEFAULT_MEDIA_COLOR_SETTINGS,
		layers: [{ settings: DEFAULT_MEDIA_COLOR_SETTINGS, masks: [] }],
		sourceKey: "portrait-fixture",
		frameSeed: 60,
		timestampSeconds: 2,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			context as unknown as ReturnType<HTMLCanvasElement["getContext"]>
		);
		vi.mocked(renderJianyingPortraitAdjustmentPreview).mockImplementation(
			async ({ source }) => source
		);
	});
	afterEach(() => vi.restoreAllMocks());

	it.each([
		{ name: "single layer", draw: drawColorGradedSourceWithMasks },
		{ name: "export stack", draw: drawColorGradedSourceStack },
	])("processes detailed pixels but preserves output geometry: $name", async ({
		draw,
	}) => {
		const adjustments = {
			enabled: true,
			values: { face_adjust_SpotAcne: 100 },
		};
		await draw({ ...args, portraitAdjustments: adjustments });
		expect(context.drawImage).toHaveBeenCalledWith(source, 0, 0, 2160, 3240);
		expect(renderJianyingPortraitAdjustmentPreview).toHaveBeenCalledWith({
			source: expect.objectContaining({ width: 2160, height: 3240 }),
			adjustments,
			sourceKey: args.sourceKey,
			frameNumber: 60,
			timestampSeconds: 2,
		});
		expect(drawMediaSourceWithMasks).toHaveBeenCalledWith(
			expect.objectContaining({
				x: 12,
				y: 24,
				width: 1080,
				height: 1620,
				source: expect.objectContaining({ width: 2160, height: 3240 }),
			})
		);
	});

	it.each([
		undefined,
		{ enabled: false, values: { face_adjust_SpotAcne: 100 } },
		{ enabled: true, values: { face_adjust_SpotAcne: 0 } },
	])("preserves the original source for inactive adjustments: %j", async (portraitAdjustments) => {
		await drawColorGradedSourceStack({ ...args, portraitAdjustments });
		expect(renderJianyingPortraitAdjustmentPreview).not.toHaveBeenCalled();
		expect(context.drawImage).not.toHaveBeenCalled();
		expect(drawMediaSourceWithMasks).toHaveBeenCalledWith(
			expect.objectContaining({ source })
		);
	});

	it("keeps the original source when the native renderer is unavailable", async () => {
		vi.mocked(renderJianyingPortraitAdjustmentPreview).mockResolvedValue(null);
		await drawColorGradedSourceStack({
			...args,
			portraitAdjustments: {
				enabled: true,
				values: { face_adjust_SpotAcne: 50 },
			},
		});
		expect(context.putImageData).not.toHaveBeenCalled();
		expect(drawMediaSourceWithMasks).toHaveBeenCalledWith(
			expect.objectContaining({ source })
		);
	});
	it("forwards the source decoder and cancellation through the color stack", async () => {
		const signal = new AbortController().signal;
		const readPortraitSourcePreRoll = vi.fn(async () => undefined);
		await drawColorGradedSourceStack({
			...args,
			portraitAdjustments: {
				enabled: true,
				values: { face_adjust_EnlargeEye: 60 },
			},
			readPortraitSourcePreRoll,
			signal,
		});
		expect(renderJianyingPortraitAdjustmentPreview).toHaveBeenCalledWith(
			expect.objectContaining({
				readSourcePreRoll: readPortraitSourcePreRoll,
				signal,
				timestampSeconds: 2,
				sourceKey: args.sourceKey,
			})
		);
	});
});
