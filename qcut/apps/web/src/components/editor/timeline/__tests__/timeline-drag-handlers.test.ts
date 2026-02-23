import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDragHandlers } from "../timeline-drag-handlers";

const {
	addTextToNewTrack,
	addMarkdownToNewTrack,
	addMediaToNewTrack,
	mockedTimelineStore,
} = vi.hoisted(() => {
	const addTextToNewTrackFn = vi.fn();
	const addMarkdownToNewTrackFn = vi.fn();
	const addMediaToNewTrackFn = vi.fn();
	const mockedTimelineStoreFn = Object.assign(vi.fn(), {
		getState: vi.fn(() => ({
			addTextToNewTrack: addTextToNewTrackFn,
			addMarkdownToNewTrack: addMarkdownToNewTrackFn,
			addMediaToNewTrack: addMediaToNewTrackFn,
		})),
	});
	return {
		addTextToNewTrack: addTextToNewTrackFn,
		addMarkdownToNewTrack: addMarkdownToNewTrackFn,
		addMediaToNewTrack: addMediaToNewTrackFn,
		mockedTimelineStore: mockedTimelineStoreFn,
	};
});

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: mockedTimelineStore,
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
	},
}));

function createDragEvent({
	itemData = "",
	types = [],
}: {
	itemData?: string;
	types?: string[];
}): React.DragEvent<HTMLDivElement> {
	return {
		preventDefault: vi.fn(),
		dataTransfer: {
			types,
			getData: (key: string) =>
				key === "application/x-media-item" ? itemData : "",
			files: null,
		},
	} as unknown as React.DragEvent<HTMLDivElement>;
}

describe("useDragHandlers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedTimelineStore.getState.mockReturnValue({
			addTextToNewTrack,
			addMarkdownToNewTrack,
			addMediaToNewTrack,
		});
	});

	it("returns dragProps object with 4 handlers", () => {
		const { result } = renderHook(() =>
			useDragHandlers({
				mediaItems: [],
				addMediaItem: undefined,
				activeProject: null,
			})
		);

		expect(result.current.dragProps).toMatchObject({
			onDragEnter: expect.any(Function),
			onDragOver: expect.any(Function),
			onDragLeave: expect.any(Function),
			onDrop: expect.any(Function),
		});
	});

	it("handleDragEnter sets isDragOver to true", () => {
		const { result } = renderHook(() =>
			useDragHandlers({
				mediaItems: [],
				addMediaItem: undefined,
				activeProject: null,
			})
		);

		act(() => {
			result.current.dragProps.onDragEnter(createDragEvent({}));
		});

		expect(result.current.isDragOver).toBe(true);
	});

	it("handleDragLeave with counter=0 clears isDragOver", () => {
		const { result } = renderHook(() =>
			useDragHandlers({
				mediaItems: [],
				addMediaItem: undefined,
				activeProject: null,
			})
		);

		act(() => {
			result.current.dragProps.onDragEnter(createDragEvent({}));
		});
		expect(result.current.isDragOver).toBe(true);

		act(() => {
			result.current.dragProps.onDragLeave(createDragEvent({}));
		});

		expect(result.current.isDragOver).toBe(false);
	});

	it("handleDrop processes media drag data", async () => {
		const mediaItem = {
			id: "media-1",
			name: "Clip",
			type: "video" as const,
			file: new File(["content"], "clip.mp4", { type: "video/mp4" }),
		};

		const { result } = renderHook(() =>
			useDragHandlers({
				mediaItems: [mediaItem],
				addMediaItem: undefined,
				activeProject: { id: "project-1" },
			})
		);

		const dragData = JSON.stringify({
			id: "media-1",
			type: "video",
			name: "Clip",
		});

		await act(async () => {
			await result.current.dragProps.onDrop(
				createDragEvent({
					itemData: dragData,
				})
			);
		});

		expect(addMediaToNewTrack).toHaveBeenCalledWith(mediaItem);
	});

	it("handleDrop processes markdown drag data", async () => {
		const { result } = renderHook(() =>
			useDragHandlers({
				mediaItems: [],
				addMediaItem: undefined,
				activeProject: { id: "project-1" },
			})
		);

		const dragData = JSON.stringify({
			id: "markdown-1",
			type: "markdown",
			name: "Markdown",
			markdownContent: "# Hello",
		});

		await act(async () => {
			await result.current.dragProps.onDrop(
				createDragEvent({
					itemData: dragData,
					types: ["application/x-media-item"],
				})
			);
		});

		expect(addMarkdownToNewTrack).toHaveBeenCalledWith({
			id: "markdown-1",
			type: "markdown",
			name: "Markdown",
			markdownContent: "# Hello",
		});
	});
});
