import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { MediaElement } from "@/types/timeline";
import type { BeautyLabIndependentSequenceFrameRequest } from "@/types/electron";
import {
	createIndependentBodyVideoDecoder,
	renderIndependentBodyVideoFrame,
} from "../independent-body-video";

const mocks = vi.hoisted(() => ({
	frameAt: vi.fn(),
	dispose: vi.fn(async () => {}),
}));

vi.mock("@/lib/export/export-sequential-video-source", () => ({
	SequentialVideoRegistry: class {
		getOrOpen = async () => ({ frameAt: mocks.frameAt });
		disposeAll = mocks.dispose;
	},
}));

const clip = {
	fps: 30,
	element: {
		id: "source-clock-clip",
		type: "media",
		mediaId: "source-clock-media",
		name: "source clock",
		startTime: 10,
		duration: 2,
		trimStart: 0,
		trimEnd: 0,
	} as MediaElement,
	mediaItem: {
		id: "source-clock-media",
		type: "video",
		file: new File([new Uint8Array([1, 2, 3])], "clock.mp4"),
	} as MediaItem,
};
const rgba = new Uint8Array([1, 2, 3, 255]);
const adjustments = {
	enabled: true as const,
	bodyVideoProfile: "swing-coreml-v1" as const,
	values: { body_adjust_SlimBody: 40 },
};

describe("independent body decoded source clock", () => {
	afterEach(() => vi.restoreAllMocks());
	it("retains decoded sample PTS when multiple timeline frames cover one source frame", async () => {
		const context = {
			clearRect: vi.fn(),
			drawImage: vi.fn(),
			getImageData: () => ({ data: Uint8ClampedArray.from(rgba) }),
		};
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
			context as unknown as ReturnType<HTMLCanvasElement["getContext"]>
		);
		mocks.frameAt.mockResolvedValue({
			canvas: { width: 1, height: 1 },
			timestamp: 0,
			duration: 1 / 12,
		});
		const decoder = createIndependentBodyVideoDecoder({ clip });
		try {
			const first = await decoder.frame({ frame: 0, width: 1, height: 1 });
			const second = await decoder.frame({ frame: 1, width: 1, height: 1 });
			expect(mocks.frameAt.mock.calls.map(([time]) => time)).toEqual([
				0.5 / 30,
				1.5 / 30,
			]);
			expect(first).toEqual({ rgba, sourceTimestampSeconds: 0 });
			expect(second).toEqual(first);
		} finally {
			await decoder.dispose();
		}
	});
});

describe("CoreML source clock transport", () => {
	const requests: BeautyLabIndependentSequenceFrameRequest[] = [];
	beforeEach(() => {
		requests.length = 0;
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: {
				beautyLab: {
					renderIndependentSequenceFrame: async (
						request: BeautyLabIndependentSequenceFrameRequest
					) => {
						requests.push(request);
						if (requests.length === 1)
							return {
								status: "replay",
								requestId: request.requestId,
								from: 0,
							};
						return {
							status: "rendered",
							requestId: request.requestId,
							width: 1,
							height: 1,
							rgba,
							cached: false,
						};
					},
				},
			},
		});
	});
	afterEach(() => Reflect.deleteProperty(window, "electronAPI"));

	it("submits every repeated source frame and preserves its PTS during history replay", async () => {
		const sourceTimes = [1.001, 1.001, 1.042708];
		const decoder = {
			frame: vi.fn(async ({ frame }: { frame: number }) => ({
				rgba,
				sourceTimestampSeconds: sourceTimes[frame],
			})),
			dispose: vi.fn(async () => {}),
		};
		await renderIndependentBodyVideoFrame({
			frame: { clip, frame: 2 },
			width: 1,
			height: 1,
			adjustments,
			createDecoder: () => decoder,
		});
		expect(requests.map(({ sequence }) => sequence.frame)).toEqual([
			2, 0, 1, 2,
		]);
		expect(
			requests.map(({ sequence }) => sequence.sourceTimestampSeconds)
		).toEqual([1.042708, 1.001, 1.001, 1.042708]);
		expect(requests.map(({ sequence }) => sequence.replay)).toEqual([
			false,
			true,
			true,
			false,
		]);
		expect(decoder.dispose).toHaveBeenCalledOnce();
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
		-1,
	])("rejects invalid decoded PTS %s before dispatching a CoreML request", async (sourceTimestampSeconds) => {
		const decoder = {
			frame: async () => ({ rgba, sourceTimestampSeconds }),
			dispose: vi.fn(async () => {}),
		};
		await expect(
			renderIndependentBodyVideoFrame({
				frame: { clip, frame: 0 },
				width: 1,
				height: 1,
				adjustments,
				createDecoder: () => decoder,
			})
		).rejects.toThrow("时间戳");
		expect(requests).toEqual([]);
		expect(decoder.dispose).toHaveBeenCalledOnce();
	});
	it("keeps the warm profile on its existing timeline clock", async () => {
		const decoder = {
			frame: async () => ({ rgba, sourceTimestampSeconds: Number.NaN }),
			dispose: vi.fn(async () => {}),
		};
		await renderIndependentBodyVideoFrame({
			frame: { clip, frame: 0 },
			width: 1,
			height: 1,
			adjustments: { enabled: true, values: adjustments.values },
			createDecoder: () => decoder,
		});
		expect(requests.length).toBeGreaterThan(0);
		expect(
			requests.every(({ sequence }) => !("sourceTimestampSeconds" in sequence))
		).toBe(true);
		expect(decoder.dispose).toHaveBeenCalledOnce();
	});
});
