import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeautyLabIndependentFrameRequest } from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import {
	independentPortraitErrorMessage,
	renderIndependentPortraitFrame,
} from "../independent-portrait-frame";

const adjustments: MediaPortraitAdjustments = {
	enabled: true,
	engine: "independent",
	values: { face_adjust_Whiten: 45 },
};

/** jsdom has no ImageData; this keeps the fields the frame module reads. */
class TestImageData {
	data: Uint8ClampedArray;
	width: number;
	height: number;
	colorSpace = "srgb";
	constructor(
		data: Uint8ClampedArray | number,
		width: number,
		height?: number
	) {
		this.data =
			typeof data === "number" ? new Uint8ClampedArray(data * width * 4) : data;
		this.width = typeof data === "number" ? data : width;
		this.height = typeof data === "number" ? width : (height ?? 1);
	}
}

function frame({ alpha }: { alpha: [number, number] }) {
	return new ImageData(
		new Uint8ClampedArray([10, 20, 30, alpha[0], 0, 0, 0, alpha[1]]),
		2,
		1
	);
}

let renderIndependentFrame: ReturnType<typeof vi.fn>;
let cancelIndependent: ReturnType<typeof vi.fn>;
beforeEach(() => {
	vi.stubGlobal("ImageData", TestImageData);
	renderIndependentFrame = vi.fn(
		async (request: BeautyLabIndependentFrameRequest) => ({
			requestId: request.requestId,
			width: request.width,
			height: request.height,
			rgba: new Uint8Array([90, 80, 70, 255, 5, 5, 5, 255]),
			cached: false,
		})
	);
	cancelIndependent = vi.fn(async () => ({ cancelled: true }));
	Object.defineProperty(window, "electronAPI", {
		configurable: true,
		value: { beautyLab: { renderIndependentFrame, cancelIndependent } },
	});
});
afterEach(() => {
	vi.unstubAllGlobals();
	Reflect.deleteProperty(window, "electronAPI");
});

describe("independent portrait frame", () => {
	it("sends an opaque frame and restores the source alpha", async () => {
		const output = await renderIndependentPortraitFrame({
			source: frame({ alpha: [255, 0] }),
			adjustments,
		});
		const [request] = renderIndependentFrame.mock.calls[0] as [
			BeautyLabIndependentFrameRequest,
		];
		expect(Array.from(request.rgba)).toEqual([10, 20, 30, 255, 0, 0, 0, 255]);
		expect(request.adjustments).toEqual({
			enabled: true,
			values: { face_adjust_Whiten: 45 },
		});
		expect(request.requestId).toMatch(/^timeline-/);
		expect(Array.from(output.data)).toEqual([90, 80, 70, 255, 5, 5, 5, 0]);
	});

	it("cancels the engine job when the caller aborts", async () => {
		let release!: () => void;
		renderIndependentFrame.mockImplementationOnce(
			(request: BeautyLabIndependentFrameRequest) =>
				new Promise((resolve) => {
					release = () =>
						resolve({
							requestId: request.requestId,
							width: 2,
							height: 1,
							rgba: new Uint8Array(8),
							cached: false,
						});
				})
		);
		const controller = new AbortController();
		const pending = renderIndependentPortraitFrame({
			source: frame({ alpha: [255, 255] }),
			adjustments,
			signal: controller.signal,
		});
		await Promise.resolve();
		controller.abort();
		const [request] = renderIndependentFrame.mock.calls[0] as [
			BeautyLabIndependentFrameRequest,
		];
		expect(cancelIndependent).toHaveBeenCalledWith({
			requestId: request.requestId,
		});
		release();
		await expect(pending).rejects.toThrow();
	});

	it("fails instead of falling back when the edit is out of scope", async () => {
		await expect(
			renderIndependentPortraitFrame({
				source: frame({ alpha: [255, 255] }),
				adjustments: { ...adjustments, faceTarget: { mode: "single" } },
			})
		).rejects.toThrow("自研美颜只能对全部人脸统一处理");
		expect(renderIndependentFrame).not.toHaveBeenCalled();
	});

	it("rejects frames above the engine's 4096 edge", async () => {
		await expect(
			renderIndependentPortraitFrame({
				source: new ImageData(4097, 1),
				adjustments,
			})
		).rejects.toThrow("4096");
	});

	it("preserves a 1080p vertical frame without resizing or changing pixel bytes", async () => {
		const source = new ImageData(1080, 1920);
		source.data.fill(127);
		renderIndependentFrame.mockImplementationOnce(
			async (request: BeautyLabIndependentFrameRequest) => ({
				...request,
				rgba: request.rgba.slice(),
				cached: false,
			})
		);
		const output = await renderIndependentPortraitFrame({
			source,
			adjustments,
		});
		expect(output.width).toBe(source.width);
		expect(output.height).toBe(source.height);
		expect(
			output.data.every((value, index) => value === source.data[index])
		).toBe(true);
	});

	it("rejects a frame above the pixel budget before IPC", async () => {
		await expect(
			renderIndependentPortraitFrame({
				source: new ImageData(4096, 2160),
				adjustments,
			})
		).rejects.toThrow("8294400");
		expect(renderIndependentFrame).not.toHaveBeenCalled();
	});

	it("rejects a result that belongs to another frame", async () => {
		renderIndependentFrame.mockResolvedValueOnce({
			requestId: "other",
			width: 2,
			height: 1,
			rgba: new Uint8Array(8),
			cached: false,
		});
		await expect(
			renderIndependentPortraitFrame({
				source: frame({ alpha: [255, 255] }),
				adjustments,
			})
		).rejects.toThrow("不匹配");
	});

	it("requires the desktop bridge", async () => {
		Reflect.deleteProperty(window, "electronAPI");
		await expect(
			renderIndependentPortraitFrame({
				source: frame({ alpha: [255, 255] }),
				adjustments,
			})
		).rejects.toThrow("桌面版");
	});

	it("explains engine failures instead of showing the traceback", async () => {
		renderIndependentFrame.mockRejectedValueOnce(
			new Error(
				`Error invoking remote method 'beauty-lab:render-independent-frame': Error: Independent worker failed (1): {"passed": false, "error": "Traceback (most recent call last):\\n  File \\"skin_mask_frontend.py\\", line 66, in predict_skin_mask\\n    raise ValueError(\\"unverified skin segmentation profile\\")\\nValueError: unverified skin segmentation profile\\n"}`
			)
		);
		await expect(
			renderIndependentPortraitFrame({
				source: frame({ alpha: [255, 255] }),
				adjustments,
			})
		).rejects.toThrow("暂不支持这个画面比例");
	});
});

describe("independent portrait error message", () => {
	it("keeps the final Python exception", () => {
		expect(
			independentPortraitErrorMessage({
				error: new Error(
					'Independent worker failed (1): {"error": "Traceback\\n  File \\"a.py\\"\\nKeyError: missing\\nRuntimeError: landmark model failed\\n"}'
				),
			})
		).toBe("自研美颜引擎出错：RuntimeError: landmark model failed");
	});

	it("drops the IPC wrapper from QCut's own errors", () => {
		expect(
			independentPortraitErrorMessage({
				error: new Error(
					"Error invoking remote method 'beauty-lab:render-independent-frame': Error: Independent beauty does not support face_adjust_BrightEye"
				),
			})
		).toBe("Independent beauty does not support face_adjust_BrightEye");
	});
});
