// @vitest-environment node
import type { ElectronApplication } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installSegmentedRequestObserver,
	readSegmentedRequests,
	type SegmentedRenderRequest,
	verifySegmentCacheReuse,
} from "../body-segmented-playback-requests";

type Handler = (event: unknown, request: unknown) => unknown;

const CHANNELS = [
	"jianying-portrait-adjustment:render",
	"jianying-portrait-adjustment:cancel",
	"beauty-lab:render-independent-sequence-frame",
	"beauty-lab:cancel-independent",
];

async function setupObserver({
	channel,
	handler,
}: {
	channel: string;
	handler: Handler;
}) {
	const handlers = new Map<string, Handler>(
		CHANNELS.map((name) => [name, () => undefined])
	);
	handlers.set(channel, handler);
	const electron = { ipcMain: { _invokeHandlers: handlers } };
	const app = {
		evaluate: async (
			callback: (mainProcess: typeof electron, argument?: number) => unknown,
			argument?: number
		) => callback(electron, argument),
	} as unknown as ElectronApplication;
	await installSegmentedRequestObserver({ app });
	const observed = handlers.get(channel);
	if (!observed) throw new Error(`Missing observed channel ${channel}`);
	return { app, observed };
}

describe("segmented body IPC observation", () => {
	beforeEach(() => vi.stubGlobal("__segmentedBodyRequests", undefined));
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		true,
		false,
	])("records native boolean cancellation %s without changing the return value", async (cancelled) => {
		const original = vi.fn(() => cancelled);
		const { app, observed } = await setupObserver({
			channel: "jianying-portrait-adjustment:cancel",
			handler: original,
		});
		const event = {};
		const request = { requestId: "native-pending" };
		expect(observed(event, request)).toBe(cancelled);
		expect(original).toHaveBeenCalledWith(event, request);
		const [entry] = await readSegmentedRequests({ app });
		expect(entry).toMatchObject({
			requestId: request.requestId,
			status: "completed",
			result: { cancelled },
		});
		expect(entry.completedAt).toBeTypeOf("number");
	});

	it.each([
		true,
		false,
	])("keeps the independent cancellation object and promise identity for %s", async (cancelled) => {
		const receipt = { cancelled };
		let resolveReceipt!: (value: typeof receipt) => void;
		const promise = new Promise<typeof receipt>((resolve) => {
			resolveReceipt = resolve;
		});
		const { app, observed } = await setupObserver({
			channel: "beauty-lab:cancel-independent",
			handler: () => promise,
		});
		expect(observed({}, { requestId: "independent-pending" })).toBe(promise);
		expect((await readSegmentedRequests({ app }))[0].status).toBe("pending");
		resolveReceipt(receipt);
		expect(await promise).toBe(receipt);
		expect((await readSegmentedRequests({ app }))[0]).toMatchObject({
			status: "completed",
			result: { cancelled },
		});
	});

	it("preserves a cancelled native render promise and its rejection", async () => {
		const error = new DOMException(
			"Native portrait render cancelled",
			"AbortError"
		);
		let rejectRender!: (reason: Error) => void;
		const promise = new Promise<never>((_resolve, reject) => {
			rejectRender = reject;
		});
		const { app, observed } = await setupObserver({
			channel: "jianying-portrait-adjustment:render",
			handler: () => promise,
		});
		expect(
			observed(
				{},
				{
					requestId: "native-pending",
					adjustments: { values: { body_adjust_SlimBody: 60 } },
				}
			)
		).toBe(promise);
		const rejection = expect(promise).rejects.toBe(error);
		rejectRender(error);
		await rejection;
		expect((await readSegmentedRequests({ app }))[0]).toMatchObject({
			status: "rejected",
			error: "Native portrait render cancelled",
			values: { body_adjust_SlimBody: 60 },
		});
	});

	it("records a synchronous handler error and rethrows the original error", async () => {
		const error = new Error("Untrusted request");
		const { app, observed } = await setupObserver({
			channel: "jianying-portrait-adjustment:cancel",
			handler: () => {
				throw error;
			},
		});
		expect(() => observed({}, { requestId: "untrusted" })).toThrow(error);
		expect((await readSegmentedRequests({ app }))[0]).toMatchObject({
			status: "rejected",
			error: error.message,
		});
	});

	it("does not reinterpret a render boolean as a cancellation receipt", async () => {
		const { app, observed } = await setupObserver({
			channel: "jianying-portrait-adjustment:render",
			handler: () => true,
		});
		expect(observed({}, { requestId: "render" })).toBe(true);
		const [entry] = await readSegmentedRequests({ app });
		expect(entry.status).toBe("completed");
		expect(entry.result).toBeUndefined();
	});

	it.each([
		true,
		false,
	])("preserves native needsSourcePreRoll=%s in render evidence", async (needsSourcePreRoll) => {
		const receipt = {
			needsSourcePreRoll,
			sourceWindowCacheHit: false,
			nativeRenderCount: 9,
		};
		const { app, observed } = await setupObserver({
			channel: "jianying-portrait-adjustment:render",
			handler: () => receipt,
		});
		expect(observed({}, { requestId: "native-history" })).toBe(receipt);
		expect((await readSegmentedRequests({ app }))[0].result).toMatchObject(
			receipt
		);
	});
});

const engines = ["native", "independent"] as const;
const unchangedValues = {
	body_adjust_SlimBody: 55,
	body_adjust_StretchLeg: 20,
};

function cacheReceipt({
	engine,
	frame,
}: {
	engine: (typeof engines)[number];
	frame: number;
}): SegmentedRenderRequest {
	return {
		channel:
			engine === "native"
				? "jianying-portrait-adjustment:render"
				: "beauty-lab:render-independent-sequence-frame",
		status: "completed",
		enteredAt: 1,
		preRollFrames: 8,
		values: unchangedValues,
		...(engine === "native"
			? {
					sourceKey: "unchanged-b",
					freshTracking: true,
					frameNumber: frame,
					result: { sourceWindowCacheHit: true, nativeRenderCount: 0 },
				}
			: {
					sequence: {
						clip: "unchanged-b",
						frame: frame - 360,
						fps: 30,
						replay: false,
					},
					result: { cached: true },
				}),
	};
}

function cacheSegment({ engine }: { engine: (typeof engines)[number] }) {
	return Array.from({ length: 60 }, (_, index) =>
		cacheReceipt({ engine, frame: 420 + index })
	);
}

function verifyCacheSegment({
	engine,
	requests,
}: {
	engine: (typeof engines)[number];
	requests: SegmentedRenderRequest[];
}) {
	return verifySegmentCacheReuse({
		engine,
		requests,
		startFrame: 420,
		endFrame: 480,
		clipStartFrame: 360,
		values: unchangedValues,
	});
}

describe("unchanged segment cache evidence", () => {
	it.each(
		engines
	)("requires every target frame for %s, independent of receipt order or duplicates", (engine) => {
		const requests = cacheSegment({ engine });
		const result = verifyCacheSegment({
			engine,
			requests: [...requests].reverse().concat(requests[0]),
		});
		expect(result.frames).toEqual(
			Array.from({ length: 60 }, (_, index) => 420 + index)
		);
		expect(result.requests).toHaveLength(61);
	});

	it.each(
		engines
	)("rejects %s duplicates standing in for a missing frame", (engine) => {
		const requests = cacheSegment({ engine });
		requests[59] = requests[0];
		expect(() => verifyCacheSegment({ engine, requests })).toThrow(
			"missing cache receipts: 479"
		);
	});

	it.each(
		engines
	)("excludes %s misses in adjacent prefetch segments", (engine) => {
		const requests = cacheSegment({ engine });
		for (const frame of [419, 480]) {
			const receipt = cacheReceipt({ engine, frame });
			receipt.result = {
				cached: false,
				sourceWindowCacheHit: false,
				nativeRenderCount: 9,
			};
			requests.push(receipt);
		}
		expect(verifyCacheSegment({ engine, requests }).requests).toHaveLength(60);
	});

	it.each(
		engines
	)("rejects any %s target miss even with complete coverage", (engine) => {
		const requests = cacheSegment({ engine });
		requests[30].result = { cached: false, sourceWindowCacheHit: false };
		expect(() => verifyCacheSegment({ engine, requests })).toThrow(
			`Unchanged ${engine} frame 450 was rendered again`
		);
	});

	it.each(
		engines
	)("cannot use another clip's parameters to complete %s coverage", (engine) => {
		const requests = cacheSegment({ engine });
		requests[0].values = { ...unchangedValues, body_adjust_StretchLeg: 30 };
		expect(() => verifyCacheSegment({ engine, requests })).toThrow(
			"missing cache receipts: 420"
		);
	});

	it.each([
		{ freshTracking: false },
		{ sourceKey: "" },
	])("excludes native requests outside source-window mode: %j", (override) => {
		const requests = cacheSegment({ engine: "native" });
		requests[0] = { ...requests[0], ...override };
		expect(() => verifyCacheSegment({ engine: "native", requests })).toThrow(
			"missing cache receipts: 420"
		);
	});

	it("excludes independent source-history replay from the target segment proof", () => {
		const requests = cacheSegment({ engine: "independent" });
		requests[0].sequence = {
			clip: "unchanged-b",
			frame: 60,
			fps: 30,
			replay: true,
		};
		expect(() =>
			verifyCacheSegment({ engine: "independent", requests })
		).toThrow("missing cache receipts: 420");
	});

	it("rejects a native hit that nevertheless ran native render commands", () => {
		const requests = cacheSegment({ engine: "native" });
		requests[0].result = { sourceWindowCacheHit: true, nativeRenderCount: 1 };
		expect(() => verifyCacheSegment({ engine: "native", requests })).toThrow(
			"Unchanged native frame 420 was rendered again"
		);
	});
});
