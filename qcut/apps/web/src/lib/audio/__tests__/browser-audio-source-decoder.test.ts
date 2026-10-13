import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@/stores/media/media-store-types";
import type { MediaElement } from "@/types/timeline";
import { decodeBrowserAudioExportClips } from "../browser-audio-export-clips";

const fixture = vi.hoisted(() => ({
	absent: false,
	decodable: true,
	duration: 0.01,
	sampleRate: 1000,
	channels: 2,
	chunks: [] as { buffer: AudioBuffer; timestamp: number }[],
	failure: null as Error | null,
	dispose: vi.fn(),
	input: vi.fn(),
}));
vi.mock("mediabunny", () => ({
	ALL_FORMATS: [],
	BlobSource: class {},
	Input: class {
		constructor() {
			fixture.input();
		}
		dispose = fixture.dispose;
		async getPrimaryAudioTrack() {
			return fixture.absent
				? null
				: {
						canDecode: async () => fixture.decodable,
						computeDuration: async () => fixture.duration,
						getSampleRate: async () => fixture.sampleRate,
						getNumberOfChannels: async () => fixture.channels,
					};
		}
	},
	AudioBufferSink: class {
		async *buffers() {
			for (const chunk of fixture.chunks) yield chunk;
			if (fixture.failure) throw fixture.failure;
		}
	},
}));

function audioBuffer({
	length,
	sampleRate = 1000,
	channels = 2,
	value = 0,
}: {
	length: number;
	sampleRate?: number;
	channels?: number;
	value?: number;
}): AudioBuffer {
	const data = Array.from({ length: channels }, (_, channel) =>
		new Float32Array(length).fill(value ? value + channel : 0)
	);
	return {
		length,
		sampleRate,
		numberOfChannels: channels,
		duration: length / sampleRate,
		getChannelData: (channel: number) => data[channel],
	} as AudioBuffer;
}
function setup({ type = "video" }: { type?: "video" | "audio" } = {}) {
	const decodeAudioData = vi.fn(async () => audioBuffer({ length: 3 }));
	const createBuffer = vi.fn(
		(channels: number, length: number, sampleRate: number) =>
			audioBuffer({ channels, length, sampleRate })
	);
	const context = {
		decodeAudioData,
		createBuffer,
	} as unknown as BaseAudioContext;
	const clip = {
		mediaItem: {
			id: "source",
			name: "source.mp4",
			type,
			file: { size: 2, arrayBuffer: async () => new ArrayBuffer(2) },
		} as unknown as MediaItem,
		element: { id: "clip", mediaId: "source" } as MediaElement,
	};
	return { context, clip, decodeAudioData, createBuffer };
}
function chunk({
	timestamp,
	length = 4,
	value = 1,
	sampleRate = 1000,
	channels = 2,
}: {
	timestamp: number;
	length?: number;
	value?: number;
	sampleRate?: number;
	channels?: number;
}) {
	return {
		timestamp,
		buffer: audioBuffer({ length, value, sampleRate, channels }),
	};
}

describe("timestamped browser export audio", () => {
	beforeEach(() => {
		fixture.absent = false;
		fixture.decodable = true;
		fixture.duration = 0.01;
		fixture.sampleRate = 1000;
		fixture.channels = 2;
		fixture.chunks = [
			chunk({ timestamp: 0 }),
			chunk({ timestamp: 0.006, value: 3 }),
		];
		fixture.failure = null;
		fixture.dispose.mockClear();
		fixture.input.mockClear();
	});
	it("preserves source clock gaps and both channels instead of shortened decodeAudioData", async () => {
		const { context, clip, decodeAudioData, createBuffer } = setup();
		const [result] = await decodeBrowserAudioExportClips({
			context,
			clips: [clip],
		});
		expect(result.buffer.length).toBe(10);
		expect([...result.buffer.getChannelData(0)]).toEqual([
			1, 1, 1, 1, 0, 0, 3, 3, 3, 3,
		]);
		expect([...result.buffer.getChannelData(1)]).toEqual([
			2, 2, 2, 2, 0, 0, 4, 4, 4, 4,
		]);
		expect(createBuffer).toHaveBeenCalledWith(2, 10, 1000);
		expect(decodeAudioData).not.toHaveBeenCalled();
		expect(fixture.dispose).toHaveBeenCalledOnce();
	});
	it("clips negative preroll and overlaps without removing later timeline samples", async () => {
		fixture.chunks = [
			chunk({ timestamp: -0.002 }),
			chunk({ timestamp: 0.001, value: 3 }),
			chunk({ timestamp: 0.008, value: 5 }),
		];
		const { context, clip } = setup();
		const [result] = await decodeBrowserAudioExportClips({
			context,
			clips: [clip],
		});
		expect([...result.buffer.getChannelData(0)]).toEqual([
			1, 3, 3, 3, 3, 0, 0, 0, 5, 5,
		]);
	});
	it("keeps a positive first audio PTS relative to container zero", async () => {
		fixture.chunks = [chunk({ timestamp: 0.005 })];
		const { context, clip } = setup();
		const [result] = await decodeBrowserAudioExportClips({
			context,
			clips: [clip],
		});
		expect([...result.buffer.getChannelData(0)]).toEqual([
			0, 0, 0, 0, 0, 1, 1, 1, 1, 0,
		]);
	});
	it("retains source sample rate for Web Audio to resample once", async () => {
		fixture.sampleRate = 44100;
		fixture.duration = 1;
		fixture.chunks = [chunk({ timestamp: 0, sampleRate: 44100 })];
		const { context, clip, createBuffer } = setup();
		const [result] = await decodeBrowserAudioExportClips({
			context,
			clips: [clip],
		});
		expect(result.buffer.sampleRate).toBe(44100);
		expect(createBuffer).toHaveBeenCalledWith(2, 44100, 44100);
	});
	it("uses the actual first decoded format for extended AAC configurations", async () => {
		fixture.sampleRate = 22050;
		fixture.channels = 1;
		fixture.duration = 1;
		fixture.chunks = [chunk({ timestamp: 0, sampleRate: 44100, channels: 2 })];
		const { context, clip, createBuffer } = setup();
		await decodeBrowserAudioExportClips({ context, clips: [clip] });
		expect(createBuffer).toHaveBeenCalledWith(2, 44100, 44100);
	});
	it("shares one decode between multiple trims of the same media", async () => {
		const { context, clip } = setup();
		const result = await decodeBrowserAudioExportClips({
			context,
			clips: [
				clip,
				{ ...clip, element: { ...clip.element, id: "second", trimStart: 1 } },
			],
		});
		expect(result[0].buffer).toBe(result[1].buffer);
		expect(fixture.input).toHaveBeenCalledOnce();
	});
	it("skips only a video with a confirmed absent audio track", async () => {
		fixture.absent = true;
		const { context, clip } = setup();
		expect(
			await decodeBrowserAudioExportClips({ context, clips: [clip] })
		).toEqual([]);
		expect(fixture.dispose).toHaveBeenCalledOnce();
	});
	it("rejects an audio asset without an audio track", async () => {
		fixture.absent = true;
		const { context, clip } = setup({ type: "audio" });
		await expect(
			decodeBrowserAudioExportClips({
				context,
				clips: [clip],
				onDecodeError: vi.fn(),
			})
		).rejects.toThrow(/audio track/i);
	});
	it.each([
		"unsupported",
		"failed",
		"empty",
		"invalid timestamp",
		"changed rate",
		"changed channels",
		"invalid duration",
	])("propagates %s audio failures and disposes the input", async (kind) => {
		if (kind === "unsupported") fixture.decodable = false;
		if (kind === "failed") fixture.failure = new Error("Decoder failed");
		if (kind === "empty") fixture.chunks = [];
		if (kind === "invalid timestamp") fixture.chunks[0].timestamp = Number.NaN;
		if (kind === "changed rate")
			fixture.chunks.push(chunk({ timestamp: 0.009, sampleRate: 48000 }));
		if (kind === "changed channels")
			fixture.chunks.push(chunk({ timestamp: 0.009, channels: 1 }));
		if (kind === "invalid duration")
			fixture.duration = Number.POSITIVE_INFINITY;
		const { context, clip } = setup();
		await expect(
			decodeBrowserAudioExportClips({
				context,
				clips: [clip],
				onDecodeError: vi.fn(),
			})
		).rejects.toThrow();
		expect(fixture.dispose).toHaveBeenCalledOnce();
	});
});
