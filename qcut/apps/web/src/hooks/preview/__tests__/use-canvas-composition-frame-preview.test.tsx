import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	renderCanvasCompositionFrame,
	type CanvasCompositionPreviewPlan,
	type CanvasCompositionFrame,
} from "@/lib/preview/canvas-composition-frame";
import { useCanvasCompositionFramePreview } from "../use-canvas-composition-frame-preview";

vi.mock("@/lib/preview/canvas-composition-frame", () => ({
	renderCanvasCompositionFrame: vi.fn(),
}));
const render = vi.mocked(renderCanvasCompositionFrame);
const createObjectURL = vi.fn((_blob: Blob) => "blob:composition");
const revokeObjectURL = vi.fn();
const plan: CanvasCompositionPreviewPlan = {
	tracks: [],
	mediaItems: [],
	width: 1080,
	height: 1920,
	fps: 30,
	renderIndex: {
		timelineStickerIds: new Set(),
		mediaItemsById: new Map(),
		clipTransitions: {
			canvasTracks: null,
			canvasTransitions: [],
			jianyingTransitions: [],
			unsupported: [],
		},
	},
};
function capture({ frame }: { frame: number }): CanvasCompositionFrame {
	return {
		blob: new Blob(["png"], { type: "image/png" }),
		frame,
		timeSeconds: frame / 30,
		timings: { renderMs: 10, encodeMs: 5 },
		width: 1080,
		height: 1920,
	};
}
async function debounce() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(120);
	});
}

describe("canvas composition preview lifecycle", () => {
	const originalCreate = URL.createObjectURL;
	const originalRevoke = URL.revokeObjectURL;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		render.mockImplementation(async ({ frame }) => capture({ frame }));
		URL.createObjectURL = createObjectURL;
		URL.revokeObjectURL = revokeObjectURL;
	});
	afterEach(() => {
		cleanup();
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
		URL.createObjectURL = originalCreate;
		URL.revokeObjectURL = originalRevoke;
	});

	it("renders the exact clamped project frame at full resolution", async () => {
		const { result } = renderHook(() =>
			useCanvasCompositionFramePreview({
				enabled: true,
				plan,
				currentTime: 2,
				totalDuration: 2,
				backgroundColor: "#123456",
			})
		);
		expect(result.current.status).toBe("rendering");
		await debounce();
		expect(render).toHaveBeenCalledWith({
			plan,
			frame: 59,
			backgroundColor: "#123456",
			signal: expect.any(AbortSignal),
		});
		expect(result.current).toMatchObject({
			status: "ready",
			url: "blob:composition",
			frame: 59,
			width: 1080,
			height: 1920,
		});
		expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
		expect(createObjectURL.mock.calls[0]?.[0]).toMatchObject({
			type: "image/png",
		});
	});

	it("keeps only the latest seek and waits for aborted work to release its resources", async () => {
		let complete!: (frame: CanvasCompositionFrame) => void;
		render.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				})
		);
		const { result, rerender } = renderHook(
			({ currentTime }) =>
				useCanvasCompositionFramePreview({
					enabled: true,
					plan,
					currentTime,
					totalDuration: 3,
				}),
			{ initialProps: { currentTime: 0 } }
		);
		await debounce();
		const firstSignal = render.mock.calls[0][0].signal;
		rerender({ currentTime: 0.5 });
		await debounce();
		rerender({ currentTime: 1 });
		await debounce();
		expect(firstSignal.aborted).toBe(true);
		expect(render).toHaveBeenCalledTimes(1);
		expect(result.current.status).toBe("rendering");
		await act(async () => {
			complete(capture({ frame: 0 }));
		});
		expect(render.mock.calls.map(([request]) => request.frame)).toEqual([
			0, 30,
		]);
		expect(createObjectURL).toHaveBeenCalledOnce();
		expect(result.current).toMatchObject({ status: "ready", frame: 30 });
	});

	it("removes an old frame synchronously when export starts and revokes its URL", async () => {
		const disabledStates: string[] = [];
		const { result, rerender } = renderHook(
			({ enabled }) => {
				const state = useCanvasCompositionFramePreview({
					enabled,
					plan,
					currentTime: 0,
					totalDuration: 3,
				});
				if (!enabled) disabledStates.push(state.status);
				return state;
			},
			{ initialProps: { enabled: true } }
		);
		await debounce();
		expect(result.current.status).toBe("ready");
		rerender({ enabled: false });
		expect(disabledStates.every((status) => status === "idle")).toBe(true);
		expect(render.mock.calls[0][0].signal.aborted).toBe(true);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:composition");
	});

	it("does not publish a late result after disabling or unmounting", async () => {
		let complete!: (frame: CanvasCompositionFrame) => void;
		render.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				})
		);
		const { result, rerender, unmount } = renderHook(
			({ enabled }) =>
				useCanvasCompositionFramePreview({
					enabled,
					plan,
					currentTime: 0,
					totalDuration: 3,
				}),
			{ initialProps: { enabled: true } }
		);
		await debounce();
		rerender({ enabled: false });
		unmount();
		await act(async () => {
			complete(capture({ frame: 0 }));
		});
		expect(result.current.status).toBe("idle");
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it("exposes a render failure and recovers on the next frame", async () => {
		render.mockRejectedValueOnce(new Error("Portrait worker exited"));
		const { result, rerender } = renderHook(
			({ currentTime }) =>
				useCanvasCompositionFramePreview({
					enabled: true,
					plan,
					currentTime,
					totalDuration: 3,
				}),
			{ initialProps: { currentTime: 0 } }
		);
		await debounce();
		expect(result.current).toMatchObject({
			status: "error",
			error: "Portrait worker exited",
		});
		rerender({ currentTime: 1 });
		expect(result.current.status).toBe("rendering");
		await debounce();
		expect(result.current).toMatchObject({ status: "ready", frame: 30 });
	});
});
