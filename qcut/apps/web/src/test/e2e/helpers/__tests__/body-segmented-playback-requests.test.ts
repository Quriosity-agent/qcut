// @vitest-environment node
import type { ElectronApplication } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installSegmentedRequestObserver,
	readSegmentedRequests,
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
});
