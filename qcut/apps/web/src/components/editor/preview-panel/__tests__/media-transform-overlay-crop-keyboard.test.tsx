import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import type { MediaElement } from "@/types/timeline";
import { MediaTransformOverlay } from "../media-transform-overlay";

const baseElement = {
	id: "clip-1",
	type: "media",
	name: "clip",
	mediaId: "media-1",
	startTime: 0,
	duration: 4,
	trimStart: 0,
	trimEnd: 0,
} as MediaElement;

const original = useTimelineStore.getState();
const updateMediaElement = vi.fn();

function renderOverlay({ element }: { element: MediaElement }) {
	const previewRef = createRef<HTMLDivElement>();
	render(
		<div ref={previewRef}>
			<MediaTransformOverlay
				targets={[{ trackId: "track-1", element }]}
				canvasSize={{ width: 1920, height: 1080 }}
				previewRef={previewRef}
				currentTime={1}
				fps={30}
			/>
		</div>
	);
	fireEvent.click(screen.getByRole("button", { name: "Crop media" }));
}

function lastCrop() {
	const call = updateMediaElement.mock.calls.at(-1);
	return (call?.[2] as Partial<MediaElement> | undefined)?.crop;
}

beforeEach(() => {
	updateMediaElement.mockClear();
	useTimelineStore.setState({ updateMediaElement, pushHistory: vi.fn() });
});

afterEach(() => {
	useTimelineStore.setState({
		updateMediaElement: original.updateMediaElement,
		pushHistory: original.pushHistory,
	});
});

/** Keyboard crop goes through the same write-back as a dragged crop handle. */
describe("MediaTransformOverlay keyboard crop", () => {
	it("crops from the focused handle with the arrow keys", () => {
		renderOverlay({ element: baseElement });

		fireEvent.keyDown(screen.getByTestId("media-crop-handle-left"), {
			key: "ArrowRight",
			shiftKey: true,
		});

		expect(updateMediaElement).toHaveBeenCalledOnce();
		expect(lastCrop()?.left).toBeCloseTo(10 / 1920);
	});

	it("resets an existing crop", () => {
		renderOverlay({
			element: {
				...baseElement,
				crop: { left: 0.2, right: 0.1, top: 0, bottom: 0 },
			} as MediaElement,
		});

		fireEvent.click(screen.getByRole("button", { name: "Reset crop" }));

		expect(lastCrop()).toMatchObject({ left: 0, right: 0, top: 0, bottom: 0 });
	});
});
