import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createCanvasPlaybackReader,
	PLAYBACK_BITMAP_MAX_FRAMES,
} from "../canvas-composition-playback-reader";
import { streamFixture } from "./canvas-playback-stream-fixtures";

vi.mock("../canvas-composition-playback-preparation", () => ({
	prepareCanvasPlaybackFrames: vi.fn(),
}));

const disposals: Array<() => Promise<void>> = [];

function fixture({ segmentFrames }: { segmentFrames: number }) {
	const value = streamFixture({ maxBytes: segmentFrames * 3 * 65_553 });
	const reads = vi.spyOn(value.stream, "read");
	const images: ImageBitmap[] = [];
	const reader = createCanvasPlaybackReader({
		cache: value.stream,
		width: value.plan.width,
		height: value.plan.height,
		frames: 20,
		maxFrames: Math.min(
			PLAYBACK_BITMAP_MAX_FRAMES,
			value.stream.stats.segmentFrames + 1
		),
		decode: async () => {
			const image = {
				width: value.plan.width,
				height: value.plan.height,
				close: vi.fn(),
			} as unknown as ImageBitmap;
			images.push(image);
			return image;
		},
	});
	const result = {
		...value,
		reader,
		reads,
		images,
		seek({ frame }: { frame: number }) {
			value.stream.setTarget({ frame });
			reader.setTarget({ frame });
		},
		async dispose() {
			reader.dispose();
			await value.dispose();
			await vi.waitFor(() => expect(reader.stats.inFlightFrames).toBe(0));
		},
	};
	disposals.push(() => result.dispose());
	return result;
}

beforeEach(() => vi.resetAllMocks());
afterEach(async () => {
	await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("rolling stream and decoded playback reader", () => {
	it("reloads a cached target after a one-frame forward and backward seek in a minimum window", async () => {
		const value = fixture({ segmentFrames: 1 });
		const { stream, reader, requestAt, settle, cache, reads } = value;
		stream.setTarget({ frame: 0 });
		await (await requestAt({ index: 0 })).complete();
		await (await requestAt({ index: 1 })).complete();
		await settle();
		expect(stream.stats).toMatchObject({
			segmentFrames: 1,
			windowEnd: 2,
			residentFrames: 2,
		});
		reader.setTarget({ frame: 0 });
		await vi.waitFor(() => expect(reader.get({ frame: 1 })).toBeDefined());
		const first = reader.get({ frame: 0 });
		expect(first).toBeDefined();

		value.seek({ frame: 1 });
		const obsolete = await requestAt({ index: 2 });
		expect(obsolete.request).toMatchObject({ startFrame: 2, frames: 1 });
		expect(first?.close).toHaveBeenCalledOnce();
		value.seek({ frame: 0 });
		expect(obsolete.request.signal.aborted).toBe(true);
		obsolete.gate.resolve();
		await settle();

		expect(cache.has({ frame: 0 })).toBe(true);
		await vi.waitFor(() => expect(reader.get({ frame: 0 })).toBeDefined());
		expect(reader.get({ frame: 0 })).not.toBe(first);
		expect(reader.stats).toMatchObject({
			maxFrames: 2,
			frames: 2,
			inFlightFrames: 0,
		});
		expect(
			reads.mock.calls
				.filter(([{ frame }]) => frame >= 2)
				.every(([{ signal }]) => signal.aborted)
		).toBe(true);
		expect(stream.error).toBeUndefined();
		expect(reader.error).toBeUndefined();
		expect(stream.stats.preparedTotal).toBe(2);
	});

	it("releases future waits when returning to the last frame of a two-frame segment", async () => {
		const value = fixture({ segmentFrames: 2 });
		const { stream, reader, requestAt, settle, cache, images } = value;
		stream.setTarget({ frame: 1 });
		await (await requestAt({ index: 0 })).complete();
		await (await requestAt({ index: 1 })).complete();
		await settle();
		reader.setTarget({ frame: 1 });
		await vi.waitFor(() => expect(reader.get({ frame: 3 })).toBeDefined());
		const first = reader.get({ frame: 1 });

		value.seek({ frame: 2 });
		const obsolete = await requestAt({ index: 2 });
		expect(obsolete.request).toMatchObject({ startFrame: 4, frames: 2 });
		value.seek({ frame: 1 });
		obsolete.gate.resolve();
		await settle();
		expect(cache.has({ frame: 1 })).toBe(true);
		await vi.waitFor(() => expect(reader.get({ frame: 1 })).toBeDefined());
		expect(reader.get({ frame: 1 })).not.toBe(first);
		expect(first?.close).toHaveBeenCalledOnce();
		expect(reader.stats).toMatchObject({
			maxFrames: 3,
			frames: 3,
			inFlightFrames: 0,
		});
		expect(stream.stats.preparedTotal).toBe(4);
		expect(reader.error).toBeUndefined();
		await value.dispose();
		for (const image of images) expect(image.close).toHaveBeenCalledOnce();
	});
});
