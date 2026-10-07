import { describe, expect, it, vi } from "vitest";
import {
	processIndependentBeautySequence,
	type IndependentBeautySequenceFrame,
} from "../beauty-lab-independent-sequence";
import {
	BEAUTY_LAB_INDEPENDENT_PROVIDER,
	type BeautyLabIndependentRequest,
} from "../beauty-lab-independent-contract";

const frame = ({
	timestampSeconds = 0,
	width = 1,
}: {
	timestampSeconds?: number;
	width?: number;
} = {}): IndependentBeautySequenceFrame => ({
	width,
	height: 1,
	rgba: new Uint8Array(width * 4).fill(255),
	timestampSeconds,
});
function fixture({
	list = [frame(), frame({ timestampSeconds: 1 })],
}: {
	list?: IndependentBeautySequenceFrame[];
} = {}) {
	const returned = vi.fn();
	const read = vi.fn();
	const frames = {
		async *[Symbol.asyncIterator]() {
			try {
				for (const input of list) {
					read();
					yield input;
				}
			} finally {
				returned();
			}
		},
	};
	const render = vi.fn(
		async ({ request }: { request: BeautyLabIndependentRequest }) => ({
			provider: BEAUTY_LAB_INDEPENDENT_PROVIDER,
			requestId: request.requestId,
			sourceKey: request.sourceKey,
			width: request.width,
			height: request.height,
			rgba: request.rgba,
			png: new Uint8Array(),
			inputSha256: "input",
			outputSha256: "output",
			report: {},
		})
	);
	const cancel = vi.fn(() => ({ cancelled: true }));
	const onFrame = vi.fn(async () => {});
	const options = {
		provider: { render, cancel },
		frames,
		adjustments: { enabled: true, values: { face_adjust_Whiten: 45 } },
		sourceKey: "video-input",
		sequenceId: "sequence",
		onFrame,
	};
	return { options, render, cancel, onFrame, returned, read };
}
describe("bounded independent frame sequences", () => {
	it("preserves order, timestamps and input identity with distinct request IDs", async () => {
		const { options, render, onFrame, returned } = fixture();
		const result = await processIndependentBeautySequence(options);
		expect(result.completed).toBe(2);
		expect(result.independentTrackingVerified).toBe(false);
		expect(render.mock.calls.map(([{ request }]) => request.requestId)).toEqual(
			["sequence-0", "sequence-1"]
		);
		expect(onFrame.mock.calls).toHaveLength(2);
		expect(returned).toHaveBeenCalledOnce();
	});
	it("does not read a second frame until the output consumer acknowledges the first", async () => {
		const { options, onFrame, read } = fixture();
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		onFrame.mockImplementationOnce(() => gate);
		const pending = processIndependentBeautySequence(options);
		await vi.waitFor(() => expect(onFrame).toHaveBeenCalledOnce());
		expect(read).toHaveBeenCalledOnce();
		release();
		await pending;
		expect(read).toHaveBeenCalledTimes(2);
	});
	it("freezes sequence parameters before the first async frame read", async () => {
		const { options, render } = fixture();
		const pending = processIndependentBeautySequence(options);
		options.adjustments.values.face_adjust_Whiten = 100;
		await pending;
		for (const [{ request }] of render.mock.calls)
			expect(request.adjustments.values.face_adjust_Whiten).toBe(45);
	});
	it.each([
		NaN,
		-1,
		0,
	])("rejects invalid or repeated timestamps %s", async (timestampSeconds) => {
		const { options, render, returned } = fixture({
			list: [frame(), frame({ timestampSeconds })],
		});
		await expect(processIndependentBeautySequence(options)).rejects.toThrow(
			"timestamps"
		);
		expect(render).toHaveBeenCalledOnce();
		expect(returned).toHaveBeenCalledOnce();
	});
	it("rejects dimension changes before rendering another frame", async () => {
		const { options, render } = fixture({
			list: [frame(), frame({ timestampSeconds: 1, width: 2 })],
		});
		await expect(processIndependentBeautySequence(options)).rejects.toThrow(
			"dimensions changed"
		);
		expect(render).toHaveBeenCalledOnce();
	});
	it("enforces the frame budget and closes the input iterator", async () => {
		const { options, render, returned } = fixture();
		await expect(
			processIndependentBeautySequence({ ...options, maxFrames: 1 })
		).rejects.toThrow("budget");
		expect(render).toHaveBeenCalledOnce();
		expect(returned).toHaveBeenCalledOnce();
	});
	it("propagates sink failures and releases input resources", async () => {
		const { options, render, onFrame, returned } = fixture();
		onFrame.mockRejectedValueOnce(new Error("disk full"));
		await expect(processIndependentBeautySequence(options)).rejects.toThrow(
			"disk full"
		);
		expect(render).toHaveBeenCalledOnce();
		expect(returned).toHaveBeenCalledOnce();
	});
	it("does not publish a completed frame after cancellation", async () => {
		const { options, render, cancel, onFrame } = fixture();
		const controller = new AbortController();
		render.mockImplementationOnce(async ({ request }) => {
			controller.abort();
			return {
				provider: BEAUTY_LAB_INDEPENDENT_PROVIDER,
				requestId: request.requestId,
				sourceKey: request.sourceKey,
				width: 1,
				height: 1,
				rgba: request.rgba,
				png: new Uint8Array(),
				inputSha256: "input",
				outputSha256: "output",
				report: {},
			};
		});
		await expect(
			processIndependentBeautySequence({
				...options,
				signal: controller.signal,
			})
		).rejects.toThrow();
		expect(cancel).toHaveBeenCalledWith({
			request: { requestId: "sequence-0" },
		});
		expect(onFrame).not.toHaveBeenCalled();
	});
	it("rejects stale provider identities", async () => {
		const { options, render, onFrame } = fixture();
		render.mockImplementationOnce(async ({ request }) => ({
			provider: BEAUTY_LAB_INDEPENDENT_PROVIDER,
			requestId: "stale",
			sourceKey: request.sourceKey,
			width: 1,
			height: 1,
			rgba: request.rgba,
			png: new Uint8Array(),
			inputSha256: "input",
			outputSha256: "output",
			report: {},
		}));
		await expect(processIndependentBeautySequence(options)).rejects.toThrow(
			"identity mismatch"
		);
		expect(onFrame).not.toHaveBeenCalled();
	});
	it("rejects an empty sequence", async () => {
		const { options } = fixture({ list: [] });
		await expect(processIndependentBeautySequence(options)).rejects.toThrow(
			"no frames"
		);
	});
});
