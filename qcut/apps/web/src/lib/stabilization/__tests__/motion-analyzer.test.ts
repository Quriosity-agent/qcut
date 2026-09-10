import { describe, expect, it, vi } from "vitest";
import type {
	PlanarFrameSource,
	PlanarFrameSourceMetadata,
} from "@/lib/tracking/mediabunny-planar-frame-source";
import type { MotionAnalysisClient } from "../motion-analysis-client";
import { analyzeMotion } from "../motion-analyzer";
import {
	type MotionAnalysisFrame,
	STABILIZATION_ANALYSIS_VERSION,
} from "../stabilization-protocol";

function fakeFrameSource({
	frames,
	metadata,
}: {
	frames: MotionAnalysisFrame[];
	metadata: PlanarFrameSourceMetadata;
}): PlanarFrameSource & { disposed: boolean } {
	const source = {
		disposed: false,
		metadata: async () => metadata,
		frameAt: async () => frames[0],
		async *forwardFrames({ afterPtsUs }: { afterPtsUs: number }) {
			for (const frame of frames) {
				if (frame.ptsUs > afterPtsUs) yield frame;
			}
		},
		async *backwardFrames() {},
		dispose: async () => {
			source.disposed = true;
		},
	};
	return source;
}

function fakeClient() {
	const pushed: number[] = [];
	const client = {
		initialize: vi.fn(async () => ({ providerVersion: "test" })),
		push: vi.fn(async ({ frame }: { frame: MotionAnalysisFrame }) => {
			pushed.push(frame.ptsUs);
			return {
				ptsUs: frame.ptsUs,
				dx: pushed.length,
				dy: 0,
				rotation: 0,
				scale: 1,
				tracked: 10,
				inliers: 9,
			};
		}),
		reset: vi.fn(async () => {}),
		terminate: vi.fn(),
	};
	return {
		client: client as unknown as MotionAnalysisClient,
		pushed,
		spies: client,
	};
}

const metadata: PlanarFrameSourceMetadata = {
	analysisWidth: 320,
	analysisHeight: 180,
	firstPtsUs: 0,
	endPtsUs: 100_000,
	sourceDisplayWidth: 1920,
	sourceDisplayHeight: 1080,
};

describe("analyzeMotion", () => {
	it("pushes every decoded frame in order and records the source geometry", async () => {
		const frames = [0, 33_333, 66_667, 100_000].map((ptsUs) => ({
			gray: new Uint8Array(320 * 180),
			width: 320,
			height: 180,
			ptsUs,
		}));
		const frameSource = fakeFrameSource({ frames, metadata });
		const { client, pushed, spies } = fakeClient();
		const progress: number[] = [];
		const analysis = await analyzeMotion({
			file: new File([new Uint8Array([1, 2, 3])], "clip.mp4"),
			frameSource,
			client,
			onProgress: ({ progress: value }) => progress.push(value),
		});
		expect(pushed).toEqual([0, 33_333, 66_667, 100_000]);
		expect(analysis).toMatchObject({
			version: STABILIZATION_ANALYSIS_VERSION,
			sourceWidth: 1920,
			sourceHeight: 1080,
			analysisWidth: 320,
			analysisHeight: 180,
		});
		expect(analysis.contentSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(analysis.frames.map((frame) => frame.dx)).toEqual([1, 2, 3, 4]);
		expect(progress.at(-1)).toBe(1);
		expect(progress).toEqual([...progress].sort((a, b) => a - b));
		expect(spies.terminate).toHaveBeenCalled();
		expect(frameSource.disposed).toBe(true);
	});

	it("uses a provided content hash and fails on an empty clip", async () => {
		const frameSource = fakeFrameSource({ frames: [], metadata });
		const { client } = fakeClient();
		await expect(
			analyzeMotion({
				file: new File([], "empty.mp4"),
				contentSha256: "a".repeat(64),
				frameSource,
				client,
			})
		).rejects.toThrow(/no decodable frames/);
		expect(frameSource.disposed).toBe(true);
	});
});
