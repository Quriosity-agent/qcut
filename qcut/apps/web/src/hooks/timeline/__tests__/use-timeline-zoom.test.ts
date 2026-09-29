import { act, cleanup, renderHook } from "@testing-library/react";
import type { PointerEvent, WheelEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIMELINE_ZOOM_EVENT } from "@/lib/editor-shortcut-events";
import { useTimelineZoom } from "../use-timeline-zoom";

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;

function flushFrame() {
	act(() => {
		const pending = [...frames.values()];
		frames.clear();
		for (const callback of pending) callback(0);
	});
}

function wheel({
	deltaY = -1,
	ctrlKey = true,
}: {
	deltaY?: number;
	ctrlKey?: boolean;
} = {}) {
	return {
		deltaY,
		deltaX: 0,
		ctrlKey,
		metaKey: false,
		preventDefault: vi.fn(),
	} as unknown as WheelEvent;
}

describe("timeline zoom scheduling", () => {
	beforeEach(() => {
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			frames.set(++frameId, callback);
			return frameId;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
	});
	afterEach(() => {
		cleanup();
		frames.clear();
		vi.unstubAllGlobals();
	});

	it("coalesces wheel events without dropping accumulated input", () => {
		const { result } = renderHook(() =>
			useTimelineZoom({ containerRef: { current: null } })
		);
		act(() => {
			for (let index = 0; index < 20; index++)
				result.current.handleWheel(wheel());
		});
		expect(frames.size).toBe(1);
		expect(result.current.zoomLevel).toBe(1);
		flushFrame();
		expect(result.current.zoomLevel).toBeCloseTo(4);
		act(() => result.current.handleWheel(wheel({ deltaY: 1 })));
		flushFrame();
		expect(result.current.zoomLevel).toBeCloseTo(3.85);
	});

	it("combines pending toolbar, keyboard and wheel zoom without stale state", () => {
		const { result } = renderHook(() =>
			useTimelineZoom({ containerRef: { current: null } })
		);
		act(() => {
			result.current.setZoomLevel(2);
			window.dispatchEvent(
				new CustomEvent(TIMELINE_ZOOM_EVENT, { detail: "in" })
			);
			result.current.handleWheel(wheel());
		});
		flushFrame();
		expect(result.current.zoomLevel).toBeCloseTo(2.65);
	});

	it("ignores non-zoom scrolling, zero deltas and non-finite zoom; clamps bounds", () => {
		const { result } = renderHook(() =>
			useTimelineZoom({ containerRef: { current: null } })
		);
		act(() => {
			result.current.handleWheel(wheel({ ctrlKey: false }));
			result.current.handleWheel(wheel({ deltaY: 0 }));
			result.current.setZoomLevel(Number.NaN);
		});
		expect(frames.size).toBe(0);
		act(() => result.current.setZoomLevel(100));
		flushFrame();
		expect(result.current.zoomLevel).toBe(10);
		act(() => result.current.setZoomLevel(-100));
		flushFrame();
		expect(result.current.zoomLevel).toBe(0.1);
	});

	it("handles touch pinch and resets its origin after release", () => {
		const { result } = renderHook(() =>
			useTimelineZoom({ containerRef: { current: null } })
		);
		const target = {
			setPointerCapture: vi.fn(),
			hasPointerCapture: () => true,
			releasePointerCapture: vi.fn(),
		};
		const pointer = ({
			id,
			x,
			type = "touch",
		}: {
			id: number;
			x: number;
			type?: string;
		}) =>
			({
				pointerId: id,
				clientX: x,
				clientY: 0,
				pointerType: type,
				currentTarget: target,
			}) as unknown as PointerEvent;
		act(() => {
			result.current.pinchHandlers.onPointerDown(
				pointer({ id: 9, x: 0, type: "mouse" })
			);
			result.current.pinchHandlers.onPointerDown(pointer({ id: 1, x: 0 }));
			result.current.pinchHandlers.onPointerDown(pointer({ id: 2, x: 100 }));
			result.current.pinchHandlers.onPointerMove(pointer({ id: 2, x: 100 }));
			result.current.pinchHandlers.onPointerMove(pointer({ id: 2, x: 200 }));
			result.current.pinchHandlers.onPointerMove(pointer({ id: 2, x: 300 }));
		});
		expect(target.setPointerCapture).toHaveBeenCalledTimes(2);
		expect(frames.size).toBe(1);
		flushFrame();
		expect(result.current.zoomLevel).toBe(3);
		act(() => {
			result.current.pinchHandlers.onPointerCancel(pointer({ id: 2, x: 300 }));
			result.current.pinchHandlers.onPointerDown(pointer({ id: 3, x: 100 }));
			result.current.pinchHandlers.onPointerMove(pointer({ id: 3, x: 100 }));
			result.current.pinchHandlers.onPointerMove(pointer({ id: 3, x: 50 }));
		});
		flushFrame();
		expect(result.current.zoomLevel).toBe(1.5);
	});

	it("cancels queued zoom on unmount", () => {
		const { result, unmount } = renderHook(() =>
			useTimelineZoom({ containerRef: { current: null } })
		);
		act(() => result.current.handleWheel(wheel()));
		unmount();
		expect(frames.size).toBe(0);
	});
});
