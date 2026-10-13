import { afterEach, describe, expect, it, vi } from "vitest";
import {
	captureExportFrameEvidence,
	type ExportFrameEvidence,
} from "../export-frame-evidence";

function createFrame({
	signal,
}: {
	signal?: AbortSignal;
} = {}): ExportFrameEvidence {
	return {
		canvas: document.createElement("canvas"),
		frameIndex: 30,
		timeSeconds: 1,
		fps: 30,
		signal: signal ?? new AbortController().signal,
	};
}

describe("pre-encode export evidence", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("does not read pixels when disarmed", async () => {
		const frame = createFrame();
		const read = vi.spyOn(frame.canvas, "getContext");
		await captureExportFrameEvidence(frame);
		expect(read).not.toHaveBeenCalled();
	});

	it("passes the actual canvas and timing only for selected frames", async () => {
		const capture = vi.fn();
		vi.stubGlobal("window", {
			__qcutExportFrameEvidence: { frameIndices: [30], capture },
		});
		const frame = createFrame();
		await captureExportFrameEvidence({ ...frame, frameIndex: 29 });
		expect(capture).not.toHaveBeenCalled();
		await captureExportFrameEvidence(frame);
		expect(capture).toHaveBeenCalledExactlyOnceWith(frame);
	});

	it("waits for capture completion and propagates capture errors", async () => {
		let finish: () => void = () => {};
		const capture = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				})
		);
		vi.stubGlobal("window", {
			__qcutExportFrameEvidence: { frameIndices: [30], capture },
		});
		let completed = false;
		const pending = captureExportFrameEvidence(createFrame()).then(() => {
			completed = true;
		});
		await Promise.resolve();
		expect(completed).toBe(false);
		finish();
		await pending;
		expect(completed).toBe(true);
		capture.mockRejectedValueOnce(new Error("Evidence write failed"));
		await expect(captureExportFrameEvidence(createFrame())).rejects.toThrow(
			"Evidence write failed"
		);
	});

	it.each([
		[Array.from({ length: 33 }, (_, index) => index)],
		[[-1]],
		[[1.5]],
		[[Number.NaN]],
	])("rejects invalid or unbounded frame selections", async (frameIndices) => {
		const capture = vi.fn();
		vi.stubGlobal("window", {
			__qcutExportFrameEvidence: { frameIndices, capture },
		});
		await expect(captureExportFrameEvidence(createFrame())).rejects.toThrow(
			"at most 32"
		);
		expect(capture).not.toHaveBeenCalled();
	});

	it("does not capture after cancellation and rejects cancellation during capture", async () => {
		const controller = new AbortController();
		const capture = vi.fn(() => controller.abort());
		vi.stubGlobal("window", {
			__qcutExportFrameEvidence: { frameIndices: [30], capture },
		});
		const frame = createFrame({ signal: controller.signal });
		await expect(captureExportFrameEvidence(frame)).rejects.toThrow();
		expect(capture).toHaveBeenCalledTimes(1);
		await expect(captureExportFrameEvidence(frame)).rejects.toThrow();
		expect(capture).toHaveBeenCalledTimes(1);
	});

	it("cancels a sink that never settles and removes its abort listener", async () => {
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, "removeEventListener");
		const capture = vi.fn(() => new Promise<void>(() => {}));
		vi.stubGlobal("window", {
			__qcutExportFrameEvidence: { frameIndices: [30], capture },
		});
		const pending = captureExportFrameEvidence(
			createFrame({ signal: controller.signal })
		);
		const rejected = expect(pending).rejects.toThrow("Capture cancelled");
		await Promise.resolve();
		expect(capture).toHaveBeenCalledOnce();
		controller.abort(new Error("Capture cancelled"));
		await rejected;
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
	});

	it("bounds a stalled sink even when the export was not cancelled", async () => {
		vi.useFakeTimers();
		const frame = createFrame();
		const remove = vi.spyOn(frame.signal, "removeEventListener");
		vi.stubGlobal("window", {
			__qcutExportFrameEvidence: {
				frameIndices: [30],
				capture: () => new Promise<void>(() => {}),
			},
		});
		const pending = captureExportFrameEvidence(frame);
		const rejected = expect(pending).rejects.toThrow("capture timed out");
		await vi.advanceTimersByTimeAsync(30_000);
		await rejected;
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
		expect(vi.getTimerCount()).toBe(0);
	});
});
