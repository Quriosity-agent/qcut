import { beforeEach, describe, expect, it } from "vitest";
import type { MediaElement, TimelineTrack } from "@/types/timeline";
import { useStabilizationStore } from "@/stores/stabilization-store";
import {
	STABILIZATION_ANALYSIS_VERSION,
	identityFrameMotion,
} from "@/lib/stabilization/stabilization-protocol";
import {
	destroyExportStabilizationCanvases,
	stabilizeExportFrame,
	timelineHasStabilization,
} from "../export-stabilization";

function mediaElement({
	stabilization,
}: {
	stabilization?: number;
}): MediaElement {
	return {
		id: "element-1",
		type: "media",
		name: "clip",
		mediaId: "media-1",
		startTime: 0,
		duration: 2,
		trimStart: 0,
		trimEnd: 0,
		...(stabilization === undefined
			? {}
			: {
					enhancements: {
						stabilization,
						denoise: 0,
						clarity: 0,
						upscale: 1,
						relight: 0,
						beauty: 0,
					},
				}),
	} as MediaElement;
}

function track({ element }: { element: MediaElement }): TimelineTrack {
	return {
		id: "track-1",
		name: "Video",
		type: "media",
		elements: [element],
		muted: false,
	} as TimelineTrack;
}

describe("timelineHasStabilization", () => {
	it("detects any media element with a positive stabilization value", () => {
		expect(
			timelineHasStabilization({
				tracks: [track({ element: mediaElement({ stabilization: 50 }) })],
			})
		).toBe(true);
		expect(
			timelineHasStabilization({
				tracks: [track({ element: mediaElement({ stabilization: 0 }) })],
			})
		).toBe(false);
		expect(
			timelineHasStabilization({
				tracks: [track({ element: mediaElement({}) })],
			})
		).toBe(false);
	});
});

describe("stabilizeExportFrame", () => {
	beforeEach(() => {
		destroyExportStabilizationCanvases();
		useStabilizationStore.setState({ entries: {} });
	});

	it("refuses to render without a ready analysis", () => {
		expect(() =>
			stabilizeExportFrame({
				element: mediaElement({ stabilization: 50 }),
				mediaItem: { id: "media-1", name: "clip.mp4" },
				source: document.createElement("canvas"),
				sourceWidth: 64,
				sourceHeight: 36,
				sourceTimestamp: 0,
			})
		).toThrow(/not ready/);
	});

	it("draws through the plan once the analysis is in the store", () => {
		useStabilizationStore.setState({
			entries: {
				"media-1": {
					status: "ready",
					progress: 1,
					error: null,
					analysis: {
						version: STABILIZATION_ANALYSIS_VERSION,
						contentSha256: "x".repeat(64),
						sourceWidth: 64,
						sourceHeight: 36,
						analysisWidth: 64,
						analysisHeight: 36,
						frames: [0, 33_333, 66_667].map((ptsUs) =>
							identityFrameMotion({ ptsUs })
						),
					},
				},
			},
		});
		const source = document.createElement("canvas");
		const calls: Array<[number, number, number, number, number, number]> = [];
		const fakeContext = {
			save() {},
			restore() {},
			clearRect() {},
			setTransform(...args: number[]) {
				if (args.length === 6)
					calls.push(args as [number, number, number, number, number, number]);
			},
			drawImage() {},
		};
		const getContext = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function patched() {
			return fakeContext as never;
		} as never;
		try {
			const output = stabilizeExportFrame({
				element: mediaElement({ stabilization: 50 }),
				mediaItem: { id: "media-1", name: "clip.mp4" },
				source,
				sourceWidth: 64,
				sourceHeight: 36,
				sourceTimestamp: 0.0333,
			});
			expect(output.width).toBe(64);
			expect(output.height).toBe(36);
			// Identity motion at the recommended level: only the crop zoom (1/0.9).
			const zoom = calls.at(-1);
			expect(zoom?.[0]).toBeCloseTo(1 / 0.9, 5);
			expect(zoom?.[1]).toBeCloseTo(0, 9);
		} finally {
			HTMLCanvasElement.prototype.getContext = getContext;
		}
	});
});
