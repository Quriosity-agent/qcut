import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filmstripCache } from "@/lib/filmstrip/filmstrip-cache";
import {
	DEBOUNCE_MS,
	MAX_FILMSTRIP_TILES,
	calculateFilmstripLayout,
	useFilmstripThumbnails,
	type UseFilmstripOptions,
} from "../use-filmstrip-thumbnails";

const extractFrames = vi.hoisted(() => vi.fn());

vi.mock("@/lib/filmstrip/filmstrip-extractor", () => ({
	extractFrames,
}));

describe("filmstrip layout", () => {
	it("uses natural thumbnail tiles for ordinary clips", () => {
		const layout = calculateFilmstripLayout({
			clipWidthPx: 300,
			trackHeight: 65,
			enabled: true,
		});

		expect(layout.tileCount).toBe(3);
		expect(layout.tileWidth).toBeCloseTo((65 - 8) * (16 / 9));
	});

	it("bounds extraction for very long clips while covering their full width", () => {
		const clipWidthPx = 180_000;
		const layout = calculateFilmstripLayout({
			clipWidthPx,
			trackHeight: 65,
			enabled: true,
		});

		expect(layout.tileCount).toBe(MAX_FILMSTRIP_TILES);
		expect(layout.tileCount * layout.tileWidth).toBeCloseTo(clipWidthPx);
	});
});

describe("useFilmstripThumbnails", () => {
	// 300 px wide at a 65 px track → 3 tiles, sampled at 2 s, 6 s and 10 s.
	const options: UseFilmstripOptions = {
		mediaId: "m1",
		file: new File(["video"], "clip.mp4", { type: "video/mp4" }),
		duration: 12,
		trimStart: 0,
		trimEnd: 0,
		zoomLevel: 1,
		trackHeight: 65,
		clipWidthPx: 300,
		enabled: true,
	};

	async function settle() {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
		});
	}

	beforeEach(() => {
		vi.useFakeTimers();
		filmstripCache.clear();
		extractFrames.mockReset();
		extractFrames.mockImplementation(
			async ({
				mediaId,
				timestamps,
			}: {
				mediaId: string;
				timestamps: number[];
			}) => {
				const result = new Map<number, string>();
				for (const t of timestamps) {
					result.set(t, filmstripCache.set(mediaId, t, `blob:${mediaId}-${t}`));
				}
				return result;
			}
		);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows the cache-owned URL for each frame and retains it while shown", async () => {
		const { result } = renderHook(() => useFilmstripThumbnails(options));
		expect(result.current.frames).toEqual([]);

		await settle();

		expect(result.current.frames.map((frame) => frame.time)).toEqual([
			2, 6, 10,
		]);
		for (const frame of result.current.frames) {
			expect(frame.url).toBe(`blob:m1-${frame.time}`);
			expect(filmstripCache.retainCount("m1", frame.time)).toBe(1);
		}
		expect(extractFrames).toHaveBeenCalledTimes(1);
	});

	it("prefers the cache's URL over the one extraction returns", async () => {
		extractFrames.mockImplementation(
			async ({
				mediaId,
				timestamps,
			}: {
				mediaId: string;
				timestamps: number[];
			}) => {
				const result = new Map<number, string>();
				for (const t of timestamps) {
					filmstripCache.set(mediaId, t, `blob:owned-${t}`);
					result.set(t, `blob:stale-${t}`);
				}
				return result;
			}
		);
		const { result } = renderHook(() => useFilmstripThumbnails(options));

		await settle();

		expect(result.current.frames.map((frame) => frame.url)).toEqual([
			"blob:owned-2",
			"blob:owned-6",
			"blob:owned-10",
		]);
	});

	it("releases frames when the clip leaves the viewport and on unmount", async () => {
		const { result, rerender, unmount } = renderHook(
			(props: UseFilmstripOptions) => useFilmstripThumbnails(props),
			{ initialProps: options }
		);
		await settle();
		expect(filmstripCache.retainCount("m1", 2)).toBe(1);

		rerender({ ...options, enabled: false });
		expect(result.current.frames).toEqual([]);
		expect(filmstripCache.retainCount("m1", 2)).toBe(0);

		rerender({ ...options, enabled: true });
		await settle();
		expect(filmstripCache.retainCount("m1", 2)).toBe(1);
		// Everything was cached the second time, so nothing was re-extracted.
		expect(extractFrames).toHaveBeenCalledTimes(1);

		unmount();
		expect(filmstripCache.retainCount("m1", 2)).toBe(0);
	});

	it("two clips of one media hold their own references to shared frames", async () => {
		const first = renderHook(() => useFilmstripThumbnails(options));
		const second = renderHook(() => useFilmstripThumbnails(options));

		await settle();

		expect(first.result.current.frames.map((frame) => frame.url)).toEqual(
			second.result.current.frames.map((frame) => frame.url)
		);
		expect(filmstripCache.retainCount("m1", 2)).toBe(2);

		first.unmount();

		expect(filmstripCache.retainCount("m1", 2)).toBe(1);
		expect(second.result.current.frames[0]?.url).toBe("blob:m1-2");
	});
});
