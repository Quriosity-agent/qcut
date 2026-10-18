import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	BeautyLabIndependentSequenceFrameRequest,
	BeautyLabIndependentSequenceFrameResult,
} from "@/types/electron";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { MediaElement, MediaPortraitAdjustments } from "@/types/timeline";
import {
	createIndependentBodyVideoDecoder,
	independentBodyVideoApplies,
	independentBodyVideoCapability,
	independentBodyVideoClipIdentity,
	independentBodyVideoFrameCount,
	independentBodyVideoFrameIndex,
	independentBodyVideoSourceTime,
	renderIndependentBodyVideoFrame,
	resetIndependentBodyVideoCapability,
} from "../independent-body-video";

const bodyEdit: MediaPortraitAdjustments = {
	enabled: true,
	engine: "independent",
	values: { body_adjust_SlimBody: 40, face_adjust_Whiten: 0 },
};

function element(overrides: Partial<MediaElement> = {}): MediaElement {
	return {
		id: "clip-1",
		type: "media",
		name: "clip",
		mediaId: "media-1",
		startTime: 2.5,
		duration: 10,
		trimStart: 1,
		trimEnd: 2,
		portraitAdjustments: bodyEdit,
		...overrides,
	} as MediaElement;
}

function mediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
	return {
		id: "media-1",
		name: "clip.mp4",
		type: "video",
		file: new File([new Uint8Array(16)], "clip.mp4", {
			type: "video/mp4",
			lastModified: 1_700_000_000_000,
		}),
		...overrides,
	} as MediaItem;
}

const clip = { element: element(), mediaItem: mediaItem(), fps: 24 };

describe("independent body video applicability", () => {
	it("needs an independent body edit on a video clip at a usable frame rate", () => {
		expect(
			independentBodyVideoApplies({
				adjustments: bodyEdit,
				mediaType: "video",
				fps: 24,
			})
		).toBe(true);
		for (const change of [
			{ adjustments: { ...bodyEdit, engine: undefined } },
			{ adjustments: { ...bodyEdit, enabled: false } },
			{ adjustments: { ...bodyEdit, values: { face_adjust_Whiten: 40 } } },
			{ adjustments: { ...bodyEdit, values: { body_adjust_SlimBody: 0 } } },
			{ mediaType: "image" },
			{ fps: 9 },
			{ fps: 241 },
			{ fps: Number.NaN },
		])
			expect(
				independentBodyVideoApplies({
					adjustments: bodyEdit,
					mediaType: "video",
					fps: 24,
					...(change as object),
				})
			).toBe(false);
	});
});

describe("independent body video clip frames", () => {
	it("counts the clip's timeline frames and clamps timeline times into them", () => {
		// 7 s of source at 1x: 168 frames at 24 fps.
		expect(independentBodyVideoFrameCount({ clip })).toBe(168);
		expect(
			independentBodyVideoFrameCount({
				clip: { ...clip, element: element({ playbackRate: 2 }) },
			})
		).toBe(84);
		expect(independentBodyVideoFrameIndex({ clip, timelineTime: 2.5 })).toBe(0);
		expect(
			independentBodyVideoFrameIndex({ clip, timelineTime: 2.5 + 10 / 24 })
		).toBe(10);
		expect(independentBodyVideoFrameIndex({ clip, timelineTime: 1 })).toBe(0);
		expect(independentBodyVideoFrameIndex({ clip, timelineTime: 60 })).toBe(
			167
		);
	});
	it("samples each clip frame's source time like the export does", () => {
		expect(independentBodyVideoSourceTime({ clip, frame: 0 })).toBeCloseTo(
			1 + 0.5 / 24,
			12
		);
		expect(independentBodyVideoSourceTime({ clip, frame: 24 })).toBeCloseTo(
			2 + 0.5 / 24,
			12
		);
		expect(
			independentBodyVideoSourceTime({
				clip: { ...clip, element: element({ playbackRate: 2 }) },
				frame: 24,
			})
		).toBeCloseTo(1 + 2 + 1 / 24, 12);
	});
	it("names the clip by its element, media, timing and edit, not by its timeline position", async () => {
		const identity = await independentBodyVideoClipIdentity({ clip });
		expect(identity).toMatch(/^[a-f0-9]{64}$/);
		expect(
			await independentBodyVideoClipIdentity({
				clip: { ...clip, element: element({ startTime: 7 }) },
			})
		).toBe(identity);
		for (const changed of [
			{ ...clip, element: element({ id: "clip-2" }) },
			{ ...clip, element: element({ trimStart: 1.5 }) },
			{ ...clip, element: element({ playbackRate: 2 }) },
			{ ...clip, element: element({ reverse: true }) },
			{
				...clip,
				element: element({
					portraitAdjustments: {
						...bodyEdit,
						values: { body_adjust_SlimBody: 41 },
					},
				}),
			},
			{ ...clip, fps: 30 },
			{ ...clip, mediaItem: mediaItem({ id: "media-2" }) },
			{
				...clip,
				mediaItem: mediaItem({
					file: new File([new Uint8Array(17)], "clip.mp4", {
						lastModified: 1_700_000_000_000,
					}),
				}),
			},
		])
			expect(
				await independentBodyVideoClipIdentity({ clip: changed })
			).not.toBe(identity);
	});
});

describe("independent body video frame driver", () => {
	const width = 2,
		height = 1;
	let render: ReturnType<typeof vi.fn>;
	let inspect: ReturnType<typeof vi.fn>;
	let cancelIndependent: ReturnType<typeof vi.fn>;
	const decoded: number[] = [];
	const decoder: ReturnType<typeof createIndependentBodyVideoDecoder> = {
		frame: vi.fn(async ({ frame }: { frame: number }) => {
			decoded.push(frame);
			return new Uint8Array([frame, 0, 0, 255, 0, frame, 0, 255]);
		}),
		dispose: vi.fn(async () => {}),
	};
	const createDecoder = vi.fn(() => decoder);
	function rendered(
		request: BeautyLabIndependentSequenceFrameRequest
	): BeautyLabIndependentSequenceFrameResult {
		return {
			status: "rendered",
			requestId: request.requestId,
			width,
			height,
			rgba: new Uint8Array([9, 9, 9, 255, request.sequence.frame, 1, 1, 255]),
			cached: false,
		};
	}
	beforeEach(() => {
		decoded.length = 0;
		vi.mocked(decoder.dispose).mockClear();
		render = vi.fn(async (request: BeautyLabIndependentSequenceFrameRequest) =>
			rendered(request)
		);
		inspect = vi.fn(async () => ({ available: true, bodyVideo: true }));
		cancelIndependent = vi.fn(async () => ({ cancelled: true }));
		Object.defineProperty(window, "electronAPI", {
			configurable: true,
			value: {
				beautyLab: {
					renderIndependentSequenceFrame: render,
					inspectIndependent: inspect,
					cancelIndependent,
				},
			},
		});
		resetIndependentBodyVideoCapability();
	});
	afterEach(() => {
		Reflect.deleteProperty(window, "electronAPI");
		resetIndependentBodyVideoCapability();
	});
	const adjustments = {
		enabled: true as const,
		values: { body_adjust_SlimBody: 40 },
	};

	it("submits the decoded clip frame with its session identity", async () => {
		const output = await renderIndependentBodyVideoFrame({
			frame: { clip, frame: 5 },
			width,
			height,
			adjustments,
			createDecoder,
		});
		expect(Array.from(output)).toEqual([9, 9, 9, 255, 5, 1, 1, 255]);
		expect(decoded).toEqual([5]);
		const [request] = render.mock.calls[0] as [
			BeautyLabIndependentSequenceFrameRequest,
		];
		expect(request.sequence).toEqual({
			clip: await independentBodyVideoClipIdentity({ clip }),
			frame: 5,
			fps: 24,
			replay: false,
		});
		expect(Array.from(request.rgba)).toEqual([5, 0, 0, 255, 0, 5, 0, 255]);
		expect(request.requestId).toMatch(/^body-video-/);
		expect(decoder.dispose).toHaveBeenCalledTimes(1);
	});

	it("rebuilds the history the engine asks for, in order, before the frame itself", async () => {
		render.mockImplementationOnce(
			async (request: BeautyLabIndependentSequenceFrameRequest) => ({
				status: "replay",
				requestId: request.requestId,
				from: 3,
			})
		);
		const output = await renderIndependentBodyVideoFrame({
			frame: { clip, frame: 6 },
			width,
			height,
			adjustments,
			createDecoder,
		});
		expect(Array.from(output)).toEqual([9, 9, 9, 255, 6, 1, 1, 255]);
		expect(decoded).toEqual([6, 3, 4, 5, 6]);
		expect(
			render.mock.calls.map(([request]) => [
				(request as BeautyLabIndependentSequenceFrameRequest).sequence.frame,
				(request as BeautyLabIndependentSequenceFrameRequest).sequence.replay,
			])
		).toEqual([
			[6, false],
			[3, true],
			[4, true],
			[5, true],
			[6, false],
		]);
	});

	it("restarts a rebuild from the new point when a replayed frame meets a gap", async () => {
		let calls = 0;
		render.mockImplementation(
			async (request: BeautyLabIndependentSequenceFrameRequest) => {
				const { frame, replay } = request.sequence;
				calls += 1;
				// Frame 6 lacks history; replaying 4 finds its checkpoint gone and restarts at 2.
				if (calls === 1)
					return { status: "replay", requestId: request.requestId, from: 3 };
				if (calls === 3 && replay && frame === 4)
					return { status: "replay", requestId: request.requestId, from: 2 };
				return rendered(request);
			}
		);
		const output = await renderIndependentBodyVideoFrame({
			frame: { clip, frame: 6 },
			width,
			height,
			adjustments,
			createDecoder,
		});
		expect(Array.from(output)).toEqual([9, 9, 9, 255, 6, 1, 1, 255]);
		expect(
			render.mock.calls.map(([request]) => [
				(request as BeautyLabIndependentSequenceFrameRequest).sequence.frame,
				(request as BeautyLabIndependentSequenceFrameRequest).sequence.replay,
			])
		).toEqual([
			[6, false],
			[3, true],
			[4, true],
			[2, true],
			[3, true],
			[4, true],
			[5, true],
			[6, false],
		]);
	});

	it("gives up when the history cannot be rebuilt or the replay start is invalid", async () => {
		render.mockImplementation(
			async (request: BeautyLabIndependentSequenceFrameRequest) => ({
				status: "replay",
				requestId: request.requestId,
				from: 0,
			})
		);
		await expect(
			renderIndependentBodyVideoFrame({
				frame: { clip, frame: 2 },
				width,
				height,
				adjustments,
				createDecoder,
			})
		).rejects.toThrow("无法重建");
		render.mockImplementation(
			async (request: BeautyLabIndependentSequenceFrameRequest) => ({
				status: "replay",
				requestId: request.requestId,
				from: 9,
			})
		);
		await expect(
			renderIndependentBodyVideoFrame({
				frame: { clip, frame: 2 },
				width,
				height,
				adjustments,
				createDecoder,
			})
		).rejects.toThrow("重放起点");
	});

	it("stops at the next frame once cancelled and rejects mismatched results", async () => {
		const controller = new AbortController();
		render.mockImplementationOnce(
			async (request: BeautyLabIndependentSequenceFrameRequest) => {
				controller.abort();
				return { status: "replay", requestId: request.requestId, from: 0 };
			}
		);
		await expect(
			renderIndependentBodyVideoFrame({
				frame: { clip, frame: 4 },
				width,
				height,
				adjustments,
				signal: controller.signal,
				createDecoder,
			})
		).rejects.toThrow();
		expect(render).toHaveBeenCalledTimes(1);
		// The waiting request is withdrawn from the engine queue by its id.
		const [request] = render.mock.calls[0] as [
			BeautyLabIndependentSequenceFrameRequest,
		];
		expect(cancelIndependent).toHaveBeenCalledWith({
			requestId: request.requestId,
		});
		cancelIndependent.mockClear();
		await renderIndependentBodyVideoFrame({
			frame: { clip, frame: 1 },
			width,
			height,
			adjustments,
			signal: new AbortController().signal,
			createDecoder,
		});
		expect(cancelIndependent).not.toHaveBeenCalled();
		render.mockImplementationOnce(
			async (request: BeautyLabIndependentSequenceFrameRequest) => ({
				...rendered(request),
				requestId: "other",
			})
		);
		await expect(
			renderIndependentBodyVideoFrame({
				frame: { clip, frame: 4 },
				width,
				height,
				adjustments,
				createDecoder,
			})
		).rejects.toThrow("不匹配");
	});

	it("reads the capability once per minute from the engine status", async () => {
		expect(await independentBodyVideoCapability()).toBe(true);
		expect(await independentBodyVideoCapability()).toBe(true);
		expect(inspect).toHaveBeenCalledTimes(1);
		inspect.mockResolvedValueOnce({ available: true, bodyVideo: false });
		expect(
			await independentBodyVideoCapability({ now: Date.now() + 61_000 })
		).toBe(false);
		Reflect.deleteProperty(window, "electronAPI");
		resetIndependentBodyVideoCapability();
		expect(await independentBodyVideoCapability()).toBe(false);
	});
});
