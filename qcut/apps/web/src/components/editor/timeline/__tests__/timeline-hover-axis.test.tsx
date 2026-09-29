import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	HOVER_PREVIEW_DELAY_MS,
	TimelineHoverAxis,
} from "../timeline-hover-axis";
import { usePlaybackStore } from "@/stores/editor/playback-store";
import { resetPlaybackStore } from "@/test/helpers/reset-playback-store";

vi.mock("@/stores/project-store", () => ({
	useProjectStore: {
		getState: () => ({ activeProject: { fps: 30 } }),
	},
}));

const TIMELINE_RECT = {
	left: 0,
	top: 0,
	right: 800,
	bottom: 400,
	width: 800,
	height: 400,
	x: 0,
	y: 0,
	toJSON: () => ({}),
} as DOMRect;

const VIEWPORT_RECT = {
	...TIMELINE_RECT,
	left: 224,
	x: 224,
	width: 576,
} as DOMRect;

function createRefs() {
	const timeline = document.createElement("div");
	timeline.getBoundingClientRect = () => TIMELINE_RECT;
	const viewport = document.createElement("div");
	viewport.getBoundingClientRect = () => VIEWPORT_RECT;
	const labels = document.createElement("div");
	Object.defineProperty(labels, "offsetWidth", { value: 224 });
	return {
		timelineRef: { current: timeline },
		tracksScrollRef: { current: viewport },
		trackLabelsRef: { current: labels },
	};
}

async function flushScrubFrame() {
	await act(async () => {
		vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS);
	});
}

function movePointer({
	clientX,
	clientY,
	buttons = 0,
}: {
	clientX: number;
	clientY: number;
	buttons?: number;
}) {
	act(() => {
		document.dispatchEvent(
			new MouseEvent("pointermove", {
				clientX,
				clientY,
				buttons,
				bubbles: true,
			})
		);
	});
}

describe("TimelineHoverAxis", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetPlaybackStore();
		usePlaybackStore.getState().setDuration(10);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllTimers();
		vi.useRealTimers();
		resetPlaybackStore();
	});

	it("follows a buttonless hover and publishes the frame-snapped scrub time", async () => {
		render(<TimelineHoverAxis {...createRefs()} zoomLevel={1} />);
		const axis = screen.getByTestId("timeline-hover-axis");
		expect(axis.style.display).toBe("none");

		movePointer({ clientX: 324, clientY: 100 });

		expect(axis.style.display).toBe("");
		// contentX = 324 - 224 = 100px -> 2s at 50px/s, on the frame grid.
		expect(axis.style.left).toBe("324px");
		await flushScrubFrame();
		expect(usePlaybackStore.getState().previewScrubTime).toBe(2);
	});

	it("hides and clears the scrub while any mouse button is held", () => {
		render(<TimelineHoverAxis {...createRefs()} zoomLevel={1} />);
		const axis = screen.getByTestId("timeline-hover-axis");
		movePointer({ clientX: 324, clientY: 100 });
		expect(axis.style.display).toBe("");

		movePointer({ clientX: 330, clientY: 100, buttons: 1 });

		expect(axis.style.display).toBe("none");
		expect(usePlaybackStore.getState().previewScrubTime).toBeNull();
	});

	it("hides when the pointer leaves the timeline or crosses the labels column", () => {
		render(<TimelineHoverAxis {...createRefs()} zoomLevel={1} />);
		const axis = screen.getByTestId("timeline-hover-axis");
		movePointer({ clientX: 324, clientY: 100 });
		expect(axis.style.display).toBe("");

		movePointer({ clientX: 100, clientY: 100 });
		expect(axis.style.display).toBe("none");
		expect(usePlaybackStore.getState().previewScrubTime).toBeNull();

		movePointer({ clientX: 324, clientY: 100 });
		expect(axis.style.display).toBe("");
		movePointer({ clientX: 324, clientY: 500 });
		expect(axis.style.display).toBe("none");
	});

	it("hides during native drag-and-drop", () => {
		render(<TimelineHoverAxis {...createRefs()} zoomLevel={1} />);
		const axis = screen.getByTestId("timeline-hover-axis");
		movePointer({ clientX: 324, clientY: 100 });
		expect(axis.style.display).toBe("");

		act(() => {
			document.dispatchEvent(new Event("dragover", { bubbles: true }));
		});

		expect(axis.style.display).toBe("none");
		expect(usePlaybackStore.getState().previewScrubTime).toBeNull();
	});

	it("stays visual-only during playback", async () => {
		usePlaybackStore.setState({ isPlaying: true });
		render(<TimelineHoverAxis {...createRefs()} zoomLevel={1} />);
		const axis = screen.getByTestId("timeline-hover-axis");

		movePointer({ clientX: 324, clientY: 100 });

		expect(axis.style.display).toBe("");
		await flushScrubFrame();
		expect(usePlaybackStore.getState().previewScrubTime).toBeNull();
	});

	it("clears the scrub override on unmount", async () => {
		const { unmount } = render(
			<TimelineHoverAxis {...createRefs()} zoomLevel={1} />
		);
		movePointer({ clientX: 324, clientY: 100 });
		await flushScrubFrame();
		expect(usePlaybackStore.getState().previewScrubTime).toBe(2);

		unmount();

		expect(usePlaybackStore.getState().previewScrubTime).toBeNull();
	});

	it("moves the line continuously but renders only the latest settled frame", async () => {
		render(<TimelineHoverAxis {...createRefs()} zoomLevel={1} />);
		for (let index = 0; index < 60; index++) {
			movePointer({ clientX: 324 + index * 2, clientY: 100 });
			act(() => vi.advanceTimersByTime(16));
			expect(usePlaybackStore.getState().previewScrubTime).toBeNull();
		}
		expect(screen.getByTestId("timeline-hover-axis").style.display).toBe("");
		await flushScrubFrame();
		expect(usePlaybackStore.getState().previewScrubTime).toBeCloseTo(4.3666667);
		expect(usePlaybackStore.getState().currentTime).toBe(0);
	});

	it.each([
		"pointerdown",
		"dragover",
		"mouseleave",
		"blur",
	])("cancels pending hover on %s", async (event) => {
		render(<TimelineHoverAxis {...createRefs()} zoomLevel={1} />);
		movePointer({ clientX: 324, clientY: 100 });
		act(() => {
			const target =
				event === "blur"
					? window
					: event === "mouseleave"
						? document.documentElement
						: document;
			target.dispatchEvent(new Event(event));
		});
		await flushScrubFrame();
		expect(usePlaybackStore.getState().previewScrubTime).toBeNull();
	});

	it("cancels pending work when playback starts even if it pauses before the deadline", async () => {
		render(<TimelineHoverAxis {...createRefs()} zoomLevel={1} />);
		movePointer({ clientX: 324, clientY: 100 });
		act(() => {
			usePlaybackStore.setState({ isPlaying: true });
			usePlaybackStore.setState({ isPlaying: false });
		});
		await flushScrubFrame();
		expect(usePlaybackStore.getState().previewScrubTime).toBeNull();
	});

	it("uses the latest zoom and scroll position under a stationary pointer", async () => {
		const refs = createRefs();
		const { rerender } = render(<TimelineHoverAxis {...refs} zoomLevel={1} />);
		movePointer({ clientX: 324, clientY: 100 });
		rerender(<TimelineHoverAxis {...refs} zoomLevel={2} />);
		await flushScrubFrame();
		expect(usePlaybackStore.getState().previewScrubTime).toBe(1);
		act(() => {
			refs.tracksScrollRef.current.scrollLeft = 100;
			refs.tracksScrollRef.current.dispatchEvent(new Event("scroll"));
		});
		await flushScrubFrame();
		expect(usePlaybackStore.getState().previewScrubTime).toBe(2);
	});

	it("does not leave a pending callback after unmount", async () => {
		const { unmount } = render(
			<TimelineHoverAxis {...createRefs()} zoomLevel={1} />
		);
		movePointer({ clientX: 324, clientY: 100 });
		unmount();
		await flushScrubFrame();
		expect(usePlaybackStore.getState().previewScrubTime).toBeNull();
	});
});
