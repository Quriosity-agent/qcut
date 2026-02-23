import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAspectRatio } from "@/hooks/use-aspect-ratio";

// Mock the store hooks
vi.mock("@/stores/editor/editor-store", () => ({
	useEditorStore: vi.fn(),
}));

vi.mock("@/hooks/use-async-media-store", () => ({
	useAsyncMediaItems: vi.fn(),
}));

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: vi.fn(),
}));

vi.mock("@/stores/media/media-store-loader", () => ({
	getMediaStoreUtils: vi.fn(),
}));

import { useEditorStore } from "@/stores/editor/editor-store";
import { useAsyncMediaItems } from "@/hooks/use-async-media-store";
import { useTimelineStore } from "@/stores/timeline/timeline-store";
import { getMediaStoreUtils } from "@/stores/media/media-store-loader";

describe("useAspectRatio", () => {
	const mockEditorStore = {
		canvasSize: { width: 1920, height: 1080 },
		canvasMode: "preset",
		canvasPresets: [
			{ name: "16:9", width: 1920, height: 1080 },
			{ name: "9:16", width: 1080, height: 1920 },
			{ name: "1:1", width: 1080, height: 1080 },
		],
	};

	const mockMediaItems = [
		{
			id: "media1",
			type: "video",
			name: "test.mp4",
			width: 1280,
			height: 720,
		},
		{
			id: "media2",
			type: "image",
			name: "test.jpg",
			width: 1000,
			height: 1000,
		},
	];

	const mockTracks = [
		{
			id: "track1",
			elements: [
				{
					id: "element1",
					type: "media",
					mediaId: "media1",
				},
			],
		},
	];

	beforeEach(() => {
		vi.clearAllMocks();

		(useEditorStore as any).mockReturnValue(mockEditorStore);
		(useAsyncMediaItems as any).mockReturnValue({
			mediaItems: mockMediaItems,
			loading: false,
			error: null,
		});
		(useTimelineStore as any).mockReturnValue({
			tracks: mockTracks,
		});
		(getMediaStoreUtils as any).mockResolvedValue({
			getMediaAspectRatio: (item: any) => item.width / item.height,
		});
	});

	it("returns current preset", async () => {
		const { result } = renderHook(() => useAspectRatio());

		// Wait for async initialization
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		expect(result.current.currentPreset).toEqual({
			name: "16:9",
			width: 1920,
			height: 1080,
		});
	});

	it("calculates current aspect ratio", () => {
		const { result } = renderHook(() => useAspectRatio());

		const aspectRatio = result.current.getCurrentAspectRatio();
		expect(aspectRatio).toBeCloseTo(1920 / 1080, 2);
	});

	it("formats aspect ratios correctly", () => {
		const { result } = renderHook(() => useAspectRatio());

		expect(result.current.formatAspectRatio(16 / 9)).toBe("16:9");
		expect(result.current.formatAspectRatio(9 / 16)).toBe("9:16");
		expect(result.current.formatAspectRatio(1)).toBe("1:1");
		expect(result.current.formatAspectRatio(1.5)).toBe("1.50");
	});

	it("detects original mode", () => {
		const { result, rerender } = renderHook(() => useAspectRatio());

		expect(result.current.isOriginal).toBe(false);

		// Update canvas mode
		(useEditorStore as any).mockReturnValue({
			...mockEditorStore,
			canvasMode: "original",
		});

		rerender();

		expect(result.current.isOriginal).toBe(true);
	});

	it("gets display name for preset", () => {
		const { result } = renderHook(() => useAspectRatio());

		expect(result.current.getDisplayName()).toBe("16:9");
	});

	it("gets display name for original mode", () => {
		(useEditorStore as any).mockReturnValue({
			...mockEditorStore,
			canvasMode: "original",
		});

		const { result } = renderHook(() => useAspectRatio());

		expect(result.current.getDisplayName()).toBe("Original");
	});

	it("gets original aspect ratio from first media", async () => {
		const { result } = renderHook(() => useAspectRatio());

		// Wait for async initialization
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		const originalRatio = result.current.getOriginalAspectRatio();
		expect(originalRatio).toBeCloseTo(1280 / 720, 2); // First video dimensions
	});

	it("returns default aspect ratio when no media", async () => {
		(useTimelineStore as any).mockReturnValue({
			tracks: [],
		});

		const { result } = renderHook(() => useAspectRatio());

		// Wait for async initialization
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		const originalRatio = result.current.getOriginalAspectRatio();
		expect(originalRatio).toBeCloseTo(16 / 9, 2);
	});

	it("handles loading state", () => {
		(useAsyncMediaItems as any).mockReturnValue({
			mediaItems: [],
			loading: true,
			error: null,
		});

		const { result } = renderHook(() => useAspectRatio());

		expect(result.current.loading).toBe(true);
	});

	it("handles error state", () => {
		const error = new Error("Failed to load media");
		(useAsyncMediaItems as any).mockReturnValue({
			mediaItems: [],
			loading: false,
			error,
		});

		const { result } = renderHook(() => useAspectRatio());

		expect(result.current.error).toBe(error);
	});
});
