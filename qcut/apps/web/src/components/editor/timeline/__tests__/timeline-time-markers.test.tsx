import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getVisibleTimeMarkers,
	TimelineTimeMarkers,
} from "../timeline-time-markers";

describe("visible timeline ruler ticks", () => {
	it.each([
		0.1, 1, 4, 10,
	])("bounds ticks at zoom %s independently of timeline length", (zoomLevel) => {
		const viewport = { zoomLevel, scrollLeft: 0, width: 1400 };
		const normal = getVisibleTimeMarkers({ ...viewport, duration: 7200 });
		const long = getVisibleTimeMarkers({ ...viewport, duration: 86400 });
		expect(normal.length).toBeGreaterThan(0);
		expect(normal.length).toBeLessThan(100);
		expect(long).toEqual(normal);
	});

	it("keeps time and absolute tick positions aligned at a distant scroll offset", () => {
		const markers = getVisibleTimeMarkers({
			duration: 7200,
			zoomLevel: 10,
			scrollLeft: 1800000,
			width: 1000,
		});
		expect(
			markers.some(({ time, label }) => time === 3600 && label === "1:00:00")
		).toBe(true);
		expect(markers.every(({ left, time }) => left === time * 500)).toBe(true);
		expect(markers.length).toBeLessThan(30);
	});

	it("clips short timelines and fractional endpoints without phantom ticks", () => {
		const markers = getVisibleTimeMarkers({
			duration: 0.3,
			zoomLevel: 4,
			scrollLeft: 0,
			width: 1000,
		});
		expect(markers).toHaveLength(4);
		expect(markers.at(-1)?.time).toBeCloseTo(0.3);
		expect(markers[0].main).toBe(true);
		expect(markers[1].main).toBe(false);
	});

	it("returns no ticks for hidden, invalid or out-of-range viewports", () => {
		const input = { duration: 7200, zoomLevel: 1, scrollLeft: 0, width: 1000 };
		for (const invalid of [
			{ width: 0 },
			{ zoomLevel: 0 },
			{ duration: -1 },
			{ scrollLeft: Number.NaN },
			{ scrollLeft: 1e9 },
		]) {
			expect(getVisibleTimeMarkers({ ...input, ...invalid })).toEqual([]);
		}
	});
});

describe("ruler viewport subscription", () => {
	let resize: () => void;
	const disconnect = vi.fn();
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: () => void) {
					resize = callback;
				}
				observe() {}
				disconnect = disconnect;
			}
		);
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("updates scrolling, resizing and zoom, then releases observers and frames", () => {
		const viewport = document.createElement("div");
		Object.defineProperty(viewport, "clientWidth", {
			value: 1000,
			configurable: true,
		});
		const scrollContainerRef = { current: viewport };
		const { container, rerender, unmount } = render(
			<TimelineTimeMarkers
				duration={7200}
				zoomLevel={1}
				scrollContainerRef={scrollContainerRef}
			/>
		);
		const times = () =>
			[
				...container.querySelectorAll<HTMLElement>("[data-timeline-marker]"),
			].map((node) => Number(node.dataset.timelineMarker));
		expect(times()).toContain(0);
		viewport.scrollLeft = 180000;
		fireEvent.scroll(viewport);
		act(() => vi.advanceTimersByTime(20));
		expect(times()).toContain(3600);
		expect(times()).not.toContain(0);
		rerender(
			<TimelineTimeMarkers
				duration={7200}
				zoomLevel={2}
				scrollContainerRef={scrollContainerRef}
			/>
		);
		expect(times()).toContain(1800);
		const count = times().length;
		Object.defineProperty(viewport, "clientWidth", { value: 1600 });
		act(() => {
			resize();
			vi.advanceTimersByTime(20);
		});
		expect(times().length).toBeGreaterThan(count);
		fireEvent.scroll(viewport);
		unmount();
		expect(disconnect).toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
