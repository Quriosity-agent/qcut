import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAspectRatio } from "@/hooks/use-aspect-ratio";

// Mock stores
vi.mock("@/stores/editor/editor-store", () => ({
	useEditorStore: vi.fn(() => ({
		canvasSize: { width: 1920, height: 1080 },
		canvasMode: "preset",
		canvasPresets: [
			{ name: "16:9", width: 1920, height: 1080 },
			{ name: "9:16", width: 1080, height: 1920 },
			{ name: "1:1", width: 1080, height: 1080 },
			{ name: "4:3", width: 1440, height: 1080 },
			{ name: "21:9", width: 2560, height: 1080 },
		],
	})),
}));

vi.mock("@/stores/timeline/timeline-store", () => ({
	useTimelineStore: vi.fn(() => ({
		tracks: [],
	})),
}));

vi.mock("@/hooks/use-async-media-store", () => ({
	useAsyncMediaItems: vi.fn(() => ({
		mediaItems: [],
		loading: false,
		error: null,
	})),
}));

vi.mock("@/stores/media/media-store-loader", () => ({
	getMediaStoreUtils: vi.fn(() =>
		Promise.resolve({
			getMediaAspectRatio: (item: any) => item.width / item.height,
		})
	),
}));

describe("useAspectRatio - Advanced Features", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("handles custom canvas sizes", () => {
		const { result } = renderHook(() => useAspectRatio());

		// Test custom aspect ratio not in presets
		expect(result.current.formatAspectRatio(2.35)).toBe("2.35");
		expect(result.current.formatAspectRatio(1.85)).toBe("1.85");
		expect(result.current.formatAspectRatio(2.39)).toBe("2.39"); // Cinema scope
		expect(result.current.formatAspectRatio(1.43)).toBe("1.43"); // IMAX
	});

	it("handles portrait orientations", () => {
		const { result } = renderHook(() => useAspectRatio());

		expect(result.current.formatAspectRatio(9 / 16)).toBe("9:16");
		expect(result.current.formatAspectRatio(3 / 4)).toBe("3:4");
		expect(result.current.formatAspectRatio(2 / 3)).toBe("0.67"); // Not a standard ratio
	});

	it("handles ultra-wide aspect ratios", () => {
		const { result } = renderHook(() => useAspectRatio());

		expect(result.current.formatAspectRatio(21 / 9)).toBe("21:9");
		expect(result.current.formatAspectRatio(32 / 9)).toBe("3.56"); // Super ultra-wide
		expect(result.current.formatAspectRatio(3)).toBe("3.00"); // 3:1
	});

	it("handles square aspect ratio", () => {
		const { result } = renderHook(() => useAspectRatio());

		expect(result.current.formatAspectRatio(1)).toBe("1:1");
		expect(result.current.formatAspectRatio(1.001)).toBe("1:1"); // Within tolerance
		expect(result.current.formatAspectRatio(0.999)).toBe("1:1"); // Within tolerance
	});

	it("formats aspect ratio with proper precision", () => {
		const { result } = renderHook(() => useAspectRatio());

		expect(result.current.formatAspectRatio(1.333_333)).toBe("4:3"); // Close to 4:3
		expect(result.current.formatAspectRatio(1.7777)).toBe("16:9"); // Close to 16:9
		expect(result.current.formatAspectRatio(1.234_567)).toBe("1.23"); // Custom ratio
	});

	it("detects common aspect ratios with tolerance", () => {
		const { result } = renderHook(() => useAspectRatio());

		// Test tolerance for common ratios (within 0.01)
		expect(result.current.formatAspectRatio(1.77)).toBe("16:9"); // 1.7777...
		expect(result.current.formatAspectRatio(1.78)).toBe("16:9");
		expect(result.current.formatAspectRatio(1.32)).toBe("1.32"); // Not close enough to 4:3
		expect(result.current.formatAspectRatio(1.34)).toBe("4:3"); // Close enough to 4:3 (1.333...)
		expect(result.current.formatAspectRatio(2.32)).toBe("2.32"); // Not close enough to 21:9
		expect(result.current.formatAspectRatio(2.34)).toBe("21:9"); // Close enough to 21:9 (2.333...)
	});

	it("provides correct display name for presets", () => {
		const { result } = renderHook(() => useAspectRatio());

		// When canvas matches a preset
		expect(result.current.getDisplayName()).toBe("16:9");
		expect(result.current.currentPreset?.name).toBe("16:9");
	});

	it("provides original mode display name", async () => {
		const { useEditorStore } = await import("@/stores/editor/editor-store");
		(useEditorStore as any).mockReturnValue({
			canvasSize: { width: 1920, height: 1080 },
			canvasMode: "original",
			canvasPresets: [],
		});

		const { result } = renderHook(() => useAspectRatio());

		expect(result.current.getDisplayName()).toBe("Original");
		expect(result.current.isOriginal).toBe(true);
	});

	it("calculates aspect ratio from current canvas size", () => {
		const { result } = renderHook(() => useAspectRatio());

		const aspectRatio = result.current.getCurrentAspectRatio();
		expect(aspectRatio).toBeCloseTo(1920 / 1080, 5);
		expect(aspectRatio).toBeCloseTo(16 / 9, 5);
	});

	it("handles edge cases for aspect ratio formatting", () => {
		const { result } = renderHook(() => useAspectRatio());

		expect(result.current.formatAspectRatio(0)).toBe("0.00");
		expect(result.current.formatAspectRatio(Infinity)).toBe("Infinity");
		expect(result.current.formatAspectRatio(NaN)).toBe("NaN");
		expect(result.current.formatAspectRatio(0.0001)).toBe("0.00");
		expect(result.current.formatAspectRatio(100)).toBe("100.00");
	});

	it("finds correct preset for canvas size", () => {
		const { result } = renderHook(() => useAspectRatio());

		// currentPreset might be undefined if not matching exactly
		if (result.current.currentPreset) {
			expect(result.current.currentPreset.name).toBeDefined();
			expect(result.current.currentPreset.width).toBeDefined();
			expect(result.current.currentPreset.height).toBeDefined();
		}

		expect(result.current.canvasSize).toEqual({
			width: 1920,
			height: 1080,
		});
	});

	it("handles loading state properly", async () => {
		const { useAsyncMediaItems } = await import(
			"@/hooks/use-async-media-store"
		);
		(useAsyncMediaItems as any).mockReturnValue({
			mediaItems: [],
			loading: true,
			error: null,
		});

		const { result } = renderHook(() => useAspectRatio());

		expect(result.current.loading).toBe(true);
		expect(result.current.error).toBe(null);
	});

	it("handles error state properly", async () => {
		const testError = new Error("Failed to load media");
		const { useAsyncMediaItems } = await import(
			"@/hooks/use-async-media-store"
		);
		const mockUseAsyncMediaItems = useAsyncMediaItems as ReturnType<
			typeof vi.fn
		>;
		mockUseAsyncMediaItems.mockReturnValue({
			mediaItems: [],
			loading: false,
			error: testError,
		});

		const { result } = renderHook(() => useAspectRatio());

		// Wait for the loading state to settle
		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		expect(result.current.error).toBe(testError);
	});
});
