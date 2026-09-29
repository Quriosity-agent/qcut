import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSharedFrameCaches } from "@/lib/preview/shared-frame-cache";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { TimelineTrack } from "@/types/timeline";
import { useFrameCache } from "../use-frame-cache";

function imageData({ bytes }: { bytes: number }): ImageData {
	return {
		data: new Uint8ClampedArray(bytes),
		width: bytes / 4,
		height: 1,
		colorSpace: "srgb",
	} as ImageData;
}

afterEach(() => clearSharedFrameCaches());

describe("useFrameCache", () => {
	it("does not traverse tracks for uncached indicator samples, but invalidates edited cached frames", () => {
		const elements = vi.fn(() => []);
		const track: TimelineTrack = {
			id: "main",
			name: "Main",
			type: "media",
			get elements() {
				return elements();
			},
		};
		const { result } = renderHook(() =>
			useFrameCache({ namespace: "indicator" })
		);
		for (let time = 0; time < 2000; time++) {
			expect(result.current.getRenderStatus(time, [track], [], null)).toBe(
				"not-cached"
			);
		}
		expect(elements).not.toHaveBeenCalled();
		act(() =>
			result.current.cacheFrame(1, imageData({ bytes: 8 }), [track], [], null)
		);
		expect(result.current.getRenderStatus(1, [track], [], null)).toBe("cached");
		expect(elements).toHaveBeenCalled();
		const edited: TimelineTrack = {
			...track,
			elements: [
				{
					id: "new",
					type: "text",
					name: "Text",
					content: "Changed",
					startTime: 0,
					duration: 5,
					trimStart: 0,
					trimEnd: 0,
					fontSize: 24,
					fontFamily: "Arial",
					color: "#ffffff",
					backgroundColor: "transparent",
					textAlign: "center",
					fontWeight: "normal",
					fontStyle: "normal",
					textDecoration: "none",
					x: 0,
					y: 0,
					rotation: 0,
					opacity: 1,
				},
			],
		};
		expect(result.current.getRenderStatus(1, [edited], [], null)).toBe(
			"not-cached"
		);
	});

	it("isolates cached frames by cache identity", () => {
		const tracks: TimelineTrack[] = [];
		const mediaItems: MediaItem[] = [];
		const { result, rerender } = renderHook(
			({ cacheIdentity }: { cacheIdentity: string }) =>
				useFrameCache({
					namespace: "project-a",
					cacheIdentity,
				}),
			{
				initialProps: { cacheIdentity: "preview-quality:smooth" },
			}
		);

		act(() => {
			result.current.cacheFrame(
				1,
				imageData({ bytes: 8 }),
				tracks,
				mediaItems,
				null
			);
		});

		expect(result.current.getCachedFrame(1, tracks, mediaItems, null)).not.toBe(
			null
		);

		rerender({ cacheIdentity: "preview-quality:original" });

		expect(
			result.current.getCachedFrame(1, tracks, mediaItems, null)
		).toBeNull();
	});

	it("invalidates on hidden tracks but ignores muting (QTL-010)", () => {
		const baseTrack: TimelineTrack = {
			id: "main",
			name: "Main",
			type: "media",
			isMain: true,
			elements: [
				{
					id: "clip",
					name: "clip",
					type: "media",
					mediaId: "media-1",
					duration: 5,
					startTime: 0,
					trimStart: 0,
					trimEnd: 0,
				},
			],
		};
		const mediaItems: MediaItem[] = [];
		const { result } = renderHook(() =>
			useFrameCache({ namespace: "project-b", cacheIdentity: "q" })
		);

		act(() => {
			result.current.cacheFrame(
				1,
				imageData({ bytes: 8 }),
				[baseTrack],
				mediaItems,
				null
			);
		});

		// Muting is audio-only: the cached visual frame stays valid.
		expect(
			result.current.getCachedFrame(
				1,
				[{ ...baseTrack, muted: true }],
				mediaItems,
				null
			)
		).not.toBeNull();

		// Hiding removes the track from the render: the frame must miss.
		expect(
			result.current.getCachedFrame(
				1,
				[{ ...baseTrack, hidden: true }],
				mediaItems,
				null
			)
		).toBeNull();
	});
});
