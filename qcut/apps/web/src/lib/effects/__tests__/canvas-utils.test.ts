import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	html2canvas: vi.fn(),
}));

vi.mock("html2canvas", () => ({
	default: mocks.html2canvas,
}));

import { captureFrameToCanvas, captureWithFallback } from "../canvas-utils";

describe("canvas frame capture", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		{ width: 0, height: 100 },
		{ width: 100, height: 0 },
		{ width: -1, height: 100 },
		{ width: Number.NaN, height: 100 },
		{ width: 100, height: Number.POSITIVE_INFINITY },
	])("skips invalid capture dimensions: $width x $height", async (options) => {
		const element = document.createElement("div");

		await expect(captureFrameToCanvas(element, options)).resolves.toBeNull();
		await expect(captureWithFallback(element, options)).resolves.toBeNull();
		expect(mocks.html2canvas).not.toHaveBeenCalled();
	});

	it("captures image data for a drawable area", async () => {
		const imageData = {
			data: new Uint8ClampedArray(100 * 50 * 4),
			width: 100,
			height: 50,
			colorSpace: "srgb",
		} as ImageData;
		const getImageData = vi.fn(() => imageData);
		mocks.html2canvas.mockResolvedValue({
			getContext: vi.fn(() => ({ getImageData })),
		});

		const result = await captureFrameToCanvas(document.createElement("div"), {
			width: 100,
			height: 50,
		});

		expect(result).toBe(imageData);
		expect(mocks.html2canvas).toHaveBeenCalledOnce();
		expect(getImageData).toHaveBeenCalledWith(0, 0, 100, 50);
	});

	it("prunes unrelated editor subtrees while preserving capture ancestors and styles", async () => {
		const owner = document.implementation.createHTMLDocument("Capture");
		owner.head.innerHTML =
			'<style>.caption { color: red }</style><link rel="stylesheet" href="theme.css">';
		owner.body.innerHTML =
			'<main><aside><canvas></canvas></aside><section><div id="surface"><video></video><span class="caption">Hello</span></div><div id="controls"></div></section></main><div id="timeline"><span>Clip</span></div>';
		const surface = owner.getElementById("surface")!;
		mocks.html2canvas.mockResolvedValue({ getContext: () => null });
		await captureFrameToCanvas(surface, { width: 100, height: 50 });
		const options = mocks.html2canvas.mock.calls[0][1] as {
			ignoreElements: (element: Element) => boolean;
		};
		for (const selector of [
			"html",
			"head",
			"style",
			"link",
			"body",
			"main",
			"section",
			"#surface",
			"video",
			".caption",
		]) {
			expect(options.ignoreElements(owner.querySelector(selector)!)).toBe(
				false
			);
		}
		for (const selector of [
			"aside",
			"aside canvas",
			"#controls",
			"#timeline",
			"#timeline span",
		]) {
			expect(options.ignoreElements(owner.querySelector(selector)!)).toBe(true);
		}
	});
});
