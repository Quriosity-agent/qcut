import { StrictMode } from "react";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as difference from "@/lib/portrait/beauty-lab-difference";
import type { BeautyLabFrame } from "@/lib/portrait/beauty-lab-difference";
import {
	BeautyLabResults,
	type BeautyLabResultsProps,
} from "../beauty-lab/beauty-lab-results";

function makeFrame({
	name,
	red,
	width = 1,
	height = 1,
	alpha = 255,
}: {
	name: string;
	red: number;
	width?: number;
	height?: number;
	alpha?: number;
}): BeautyLabFrame {
	const rgba = new Uint8Array(width * height * 4);
	for (let offset = 0; offset < rgba.length; offset += 4) {
		rgba[offset] = red;
		rgba[offset + 3] = alpha;
	}
	return { name, width, height, rgba };
}

const input = makeFrame({ name: "input.png", red: 0 });
const native = makeFrame({ name: "native.png", red: 2 });
const candidate = makeFrame({ name: "candidate.png", red: 8 });
const props: BeautyLabResultsProps = {
	input,
	native,
	candidate,
	gain: 4,
	nativeLabel: "Native renderer",
	candidateLabel: "QCut renderer",
	locale: "en",
};

const callbacks = new Map<number, FrameRequestCallback>();
let nextRequestId = 0;
const schedule = vi.fn((callback: FrameRequestCallback) => {
	nextRequestId += 1;
	callbacks.set(nextRequestId, callback);
	return nextRequestId;
});
const cancel = vi.fn((id: number) => callbacks.delete(id));
const createImageData = vi.fn(
	(width: number, height: number) =>
		({
			width,
			height,
			data: new Uint8ClampedArray(width * height * 4),
			colorSpace: "srgb",
		}) as ImageData
);
const putImageData = vi.fn<(image: ImageData, x: number, y: number) => void>();
const context = {
	createImageData,
	putImageData,
} as unknown as CanvasRenderingContext2D;
const getCanvasContext = ((contextId: string) =>
	contextId === "2d" ? context : null) as HTMLCanvasElement["getContext"];

function flushComparisons() {
	act(() => {
		const pending = [...callbacks.values()];
		callbacks.clear();
		for (const callback of pending) callback(0);
	});
}

function getFigure({ name }: { name: string }) {
	return screen.getByRole("figure", { name });
}

beforeEach(() => {
	callbacks.clear();
	nextRequestId = 0;
	schedule.mockClear();
	cancel.mockClear();
	createImageData.mockClear();
	putImageData.mockReset();
	vi.stubGlobal("requestAnimationFrame", schedule);
	vi.stubGlobal("cancelAnimationFrame", cancel);
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
		getCanvasContext
	);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("BeautyLabResults", () => {
	it("presents all six slots and renders each real frame and shared-gain difference", () => {
		const compare = vi.spyOn(difference, "compareBeautyLabFrames");
		render(<BeautyLabResults {...props} />);
		expect(screen.getAllByRole("figure")).toHaveLength(6);
		expect(screen.getAllByRole("img")).toHaveLength(3);
		expect(compare).not.toHaveBeenCalled();
		expect(screen.getAllByText("Comparing...")).toHaveLength(3);
		flushComparisons();
		expect(screen.getAllByRole("img")).toHaveLength(6);
		expect(compare.mock.calls.map(([options]) => options)).toEqual([
			{ reference: input, candidate: native, gain: 4 },
			{ reference: input, candidate, gain: 4 },
			{ reference: native, candidate, gain: 4 },
		]);
		expect(
			putImageData.mock.calls.map(([image]) => Array.from(image.data))
		).toEqual([
			[0, 0, 0, 255],
			[2, 0, 0, 255],
			[8, 0, 0, 255],
			[8, 8, 8, 255],
			[32, 32, 32, 255],
			[24, 24, 24, 255],
		]);
		expect(
			within(getFigure({ name: "Original → Native renderer" })).getByText(
				"0.667"
			)
		).toBeVisible();
		expect(
			within(getFigure({ name: "Original → QCut renderer" })).getByText("2.667")
		).toBeVisible();
		expect(
			within(getFigure({ name: "Native renderer → QCut renderer" })).getByText(
				"2.000"
			)
		).toBeVisible();
		expect(screen.getByText("RGB x4")).toBeVisible();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
		expect(screen.queryByRole("slider")).not.toBeInTheDocument();
	});

	it("shows all explicit empty slots without fabricated results or metrics", () => {
		const compare = vi.spyOn(difference, "compareBeautyLabFrames");
		render(
			<BeautyLabResults
				{...props}
				input={null}
				native={null}
				candidate={null}
			/>
		);
		expect(screen.getAllByRole("figure")).toHaveLength(6);
		expect(screen.getByText("No input frame")).toBeVisible();
		expect(screen.getByText("No native result")).toBeVisible();
		expect(screen.getByText("No candidate result")).toBeVisible();
		expect(screen.getAllByText(/^Missing:/)).toHaveLength(3);
		expect(screen.queryByRole("img")).not.toBeInTheDocument();
		expect(screen.queryByText("Changed")).not.toBeInTheDocument();
		expect(screen.queryByText(/parity/i)).not.toBeInTheDocument();
		expect(compare).not.toHaveBeenCalled();
		expect(schedule).not.toHaveBeenCalled();
	});

	it.each([
		{
			slot: "input",
			empty: "No input frame",
			validPair: "Native renderer → QCut renderer",
		},
		{
			slot: "native",
			empty: "No native result",
			validPair: "Original → QCut renderer",
		},
		{
			slot: "candidate",
			empty: "No candidate result",
			validPair: "Original → Native renderer",
		},
	])("never substitutes an original for a missing $slot", ({
		slot,
		empty,
		validPair,
	}) => {
		const compare = vi.spyOn(difference, "compareBeautyLabFrames");
		render(<BeautyLabResults {...props} {...{ [slot]: null }} />);
		flushComparisons();
		expect(screen.getByText(empty)).toBeVisible();
		expect(screen.getAllByText(/^Missing:/)).toHaveLength(2);
		expect(screen.getAllByRole("img")).toHaveLength(3);
		expect(compare).toHaveBeenCalledTimes(1);
		expect(
			within(getFigure({ name: validPair })).getByText("Changed")
		).toBeVisible();
		expect(screen.getAllByText("Changed")).toHaveLength(1);
		expect(screen.queryByText(/parity/i)).not.toBeInTheDocument();
	});

	it("reports mismatched dimensions even with equal pixel and byte counts", () => {
		const compare = vi.spyOn(difference, "compareBeautyLabFrames");
		const portrait = makeFrame({
			name: "portrait",
			red: 0,
			width: 1,
			height: 2,
		});
		const landscape = makeFrame({
			name: "landscape",
			red: 0,
			width: 2,
			height: 1,
		});
		render(
			<BeautyLabResults
				{...props}
				input={portrait}
				native={portrait}
				candidate={landscape}
			/>
		);
		flushComparisons();
		expect(screen.getAllByText("Size mismatch: 1x2 / 2x1")).toHaveLength(2);
		expect(compare).toHaveBeenCalledTimes(1);
		expect(screen.getAllByText("Changed")).toHaveLength(1);
	});

	it("shows a genuine native-candidate match without erasing changes from the original", () => {
		const replay = {
			...native,
			name: "Matching replay",
			rgba: native.rgba.slice(),
		};
		render(<BeautyLabResults {...props} candidate={replay} />);
		flushComparisons();
		for (const name of [
			"Original → Native renderer",
			"Original → QCut renderer",
		]) {
			expect(within(getFigure({ name })).getByText("1 / 1")).toBeVisible();
		}
		const match = within(
			getFigure({ name: "Native renderer → QCut renderer" })
		);
		expect(match.getByText("0 / 1")).toBeVisible();
		expect(match.getByText("0.000")).toBeVisible();
		expect(match.getByRole("img")).toBeVisible();
		expect(Array.from(putImageData.mock.calls[5][0].data)).toEqual([
			0, 0, 0, 255,
		]);
	});

	it("uses a stable original aspect ratio for populated, pending, and empty slots", () => {
		const portrait = makeFrame({
			name: "portrait",
			red: 0,
			width: 2,
			height: 3,
		});
		const { rerender } = render(
			<BeautyLabResults
				{...props}
				input={portrait}
				native={null}
				candidate={null}
			/>
		);
		for (const viewport of screen.getAllByTestId("beauty-lab-frame-viewport")) {
			expect(viewport.style.aspectRatio).toBe("2 / 3");
		}
		rerender(
			<BeautyLabResults
				{...props}
				input={portrait}
				native={portrait}
				candidate={portrait}
			/>
		);
		flushComparisons();
		for (const viewport of screen.getAllByTestId("beauty-lab-frame-viewport")) {
			expect(viewport.style.aspectRatio).toBe("2 / 3");
		}
		for (const section of screen.getAllByRole("region")) {
			const grid = section.querySelector(".grid");
			expect(grid).toHaveClass("grid-cols-1", "@min-[40rem]:grid-cols-3");
		}
	});

	it("does not rescan pixels or redraw canvases on pointer events and stable-reference rerenders", () => {
		const compare = vi.spyOn(difference, "compareBeautyLabFrames");
		const { rerender } = render(<BeautyLabResults {...props} />);
		flushComparisons();
		const images = screen.getAllByRole("img");
		compare.mockClear();
		putImageData.mockClear();
		schedule.mockClear();
		fireEvent.pointerMove(screen.getByTestId("beauty-lab-results"));
		rerender(<BeautyLabResults {...props} />);
		rerender(
			<BeautyLabResults
				{...props}
				nativeLabel="Updated native label"
				locale="zh-CN"
			/>
		);
		expect(compare).not.toHaveBeenCalled();
		expect(schedule).not.toHaveBeenCalled();
		expect(putImageData).not.toHaveBeenCalled();
		expect(screen.getAllByRole("img")).toEqual(images);
		expect(screen.getByText("原图")).toBeVisible();
	});

	it("recomputes only affected pairs when one result reference changes", () => {
		const compare = vi.spyOn(difference, "compareBeautyLabFrames");
		const { rerender } = render(<BeautyLabResults {...props} />);
		flushComparisons();
		compare.mockClear();
		putImageData.mockClear();
		const replacement = makeFrame({ name: "next", red: 3 });
		rerender(<BeautyLabResults {...props} native={replacement} />);
		expect(compare).not.toHaveBeenCalled();
		expect(screen.getAllByText("Comparing...")).toHaveLength(2);
		flushComparisons();
		expect(compare).toHaveBeenCalledTimes(2);
		expect(putImageData).toHaveBeenCalledTimes(3);
		expect(compare.mock.calls.map(([options]) => options)).toEqual([
			{ reference: input, candidate: replacement, gain: 4 },
			{ reference: replacement, candidate, gain: 4 },
		]);
	});

	it("coalesces changing gain without synchronously computing or displaying stale metrics", () => {
		const compare = vi.spyOn(difference, "compareBeautyLabFrames");
		const { rerender } = render(<BeautyLabResults {...props} />);
		flushComparisons();
		compare.mockClear();
		putImageData.mockClear();
		rerender(<BeautyLabResults {...props} gain={8} />);
		rerender(<BeautyLabResults {...props} gain={16} />);
		rerender(<BeautyLabResults {...props} gain={32} />);
		expect(compare).not.toHaveBeenCalled();
		expect(screen.queryByText("Changed")).not.toBeInTheDocument();
		expect(callbacks.size).toBe(3);
		flushComparisons();
		expect(compare).toHaveBeenCalledTimes(3);
		expect(compare.mock.calls.map(([options]) => options.gain)).toEqual([
			32, 32, 32,
		]);
		expect(putImageData.mock.calls.map(([image]) => image.data[0])).toEqual([
			64, 255, 192,
		]);
	});

	it("shows alpha differences in metrics even when every difference image is black", () => {
		const transparent = makeFrame({ name: "transparent", red: 0, alpha: 0 });
		const half = makeFrame({ name: "half", red: 0, alpha: 127 });
		render(
			<BeautyLabResults
				{...props}
				input={transparent}
				native={half}
				candidate={input}
			/>
		);
		flushComparisons();
		const figure = within(getFigure({ name: "Original → Native renderer" }));
		expect(figure.getByText("1 / 1")).toBeVisible();
		expect(figure.getByText("0.000")).toBeVisible();
		expect(figure.getByText("127")).toBeVisible();
		expect(
			putImageData.mock.calls.slice(3).map(([image]) => image.data[0])
		).toEqual([0, 0, 0]);
	});

	it.each([
		{ gain: 0 },
		{ gain: 33 },
		{ gain: 1.5 },
	])("does not present invalid gain $gain as a match", ({ gain }) => {
		render(<BeautyLabResults {...props} gain={gain} />);
		flushComparisons();
		expect(screen.getAllByText("Comparison unavailable")).toHaveLength(3);
		expect(screen.queryByText("Changed")).not.toBeInTheDocument();
		expect(screen.getAllByRole("img")).toHaveLength(3);
	});

	it("rejects malformed frames before allocating a canvas or comparing them", () => {
		const compare = vi.spyOn(difference, "compareBeautyLabFrames");
		const invalid = { ...candidate, width: 5000, rgba: new Uint8Array(0) };
		render(<BeautyLabResults {...props} candidate={invalid} />);
		flushComparisons();
		expect(screen.getByText("Invalid frame")).toBeVisible();
		expect(screen.getAllByText(/^Missing:.*QCut renderer/)).toHaveLength(2);
		expect(compare).toHaveBeenCalledTimes(1);
		expect(createImageData.mock.calls.every(([width]) => width === 1)).toBe(
			true
		);
	});

	it("removes old metrics immediately when a successful candidate disappears", () => {
		const { rerender } = render(<BeautyLabResults {...props} />);
		flushComparisons();
		expect(screen.getAllByText("Changed")).toHaveLength(3);
		rerender(<BeautyLabResults {...props} candidate={null} />);
		expect(screen.getAllByText("Changed")).toHaveLength(1);
		expect(screen.getByText("No candidate result")).toBeVisible();
		expect(screen.getAllByText(/^Missing:.*QCut renderer/)).toHaveLength(2);
	});

	it("cancels pending work and ignores callbacks that outlive their render", () => {
		const compare = vi.spyOn(difference, "compareBeautyLabFrames");
		const { rerender, unmount } = render(<BeautyLabResults {...props} />);
		const stale = [...callbacks.values()];
		rerender(<BeautyLabResults {...props} candidate={null} />);
		unmount();
		expect(callbacks.size).toBe(0);
		expect(cancel).toHaveBeenCalledTimes(3);
		act(() => {
			for (const callback of stale) callback(0);
		});
		expect(compare).not.toHaveBeenCalled();
	});

	it("restores canvas backing stores after StrictMode cleanup and releases them on unmount", () => {
		const { unmount } = render(
			<StrictMode>
				<BeautyLabResults {...props} />
			</StrictMode>
		);
		flushComparisons();
		const canvases = screen.getAllByRole("img") as HTMLCanvasElement[];
		for (const canvas of canvases) {
			expect(canvas.width).toBe(1);
			expect(canvas.height).toBe(1);
		}
		unmount();
		for (const canvas of canvases) {
			expect(canvas.width).toBe(0);
			expect(canvas.height).toBe(0);
		}
		expect(callbacks.size).toBe(0);
	});

	it("reports unavailable 2D contexts instead of showing a blank result canvas", () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
		render(<BeautyLabResults {...props} native={null} candidate={null} />);
		expect(screen.getByText("Canvas unavailable")).toBeVisible();
		expect(screen.queryByRole("img")).not.toBeInTheDocument();
	});

	it("recovers from a transient context failure during StrictMode setup", () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext")
			.mockReturnValueOnce(null)
			.mockImplementation(getCanvasContext);
		render(
			<StrictMode>
				<BeautyLabResults {...props} native={null} candidate={null} />
			</StrictMode>
		);
		expect(screen.queryByText("Canvas unavailable")).not.toBeInTheDocument();
		expect(screen.getByRole("img", { name: "Original" })).toBeVisible();
	});

	it("handles drawing failures and recovers with a new frame reference", () => {
		putImageData.mockImplementationOnce(() => {
			throw new Error("drawing failed");
		});
		const { rerender } = render(
			<BeautyLabResults {...props} native={null} candidate={null} />
		);
		expect(screen.getByText("Canvas unavailable")).toBeVisible();
		rerender(
			<BeautyLabResults
				{...props}
				input={native}
				native={null}
				candidate={null}
			/>
		);
		expect(screen.queryByText("Canvas unavailable")).not.toBeInTheDocument();
		expect(screen.getByRole("img", { name: "Original" })).toBeVisible();
	});

	it("localizes explicit empty states while preserving supplied renderer labels", () => {
		render(
			<BeautyLabResults
				{...props}
				input={null}
				native={null}
				candidate={null}
				locale="zh-Hans"
			/>
		);
		expect(screen.getByText("暂无输入图像")).toBeVisible();
		expect(screen.getByText("暂无原生结果")).toBeVisible();
		expect(screen.getByText("暂无候选结果")).toBeVisible();
		expect(screen.getByText("Native renderer")).toBeVisible();
		expect(screen.getByText("QCut renderer")).toBeVisible();
	});
});
