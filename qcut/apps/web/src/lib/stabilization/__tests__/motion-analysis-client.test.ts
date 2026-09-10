import { afterEach, describe, expect, it, vi } from "vitest";
import { MotionAnalysisClient } from "../motion-analysis-client";
import type {
	MotionEstimatorWorkerRequest,
	MotionEstimatorWorkerResponse,
} from "../stabilization-protocol";

class WorkerHarness extends EventTarget {
	readonly terminate = vi.fn();
	readonly requests: MotionEstimatorWorkerRequest[] = [];
	readonly transfers: Transferable[][] = [];
	constructor(
		private readonly onPostMessage: (input: {
			message: MotionEstimatorWorkerRequest;
		}) => void
	) {
		super();
	}
	postMessage(
		message: MotionEstimatorWorkerRequest,
		transfer: Transferable[] = []
	): void {
		this.requests.push(message);
		this.transfers.push(transfer);
		this.onPostMessage({ message });
	}
	respond({ response }: { response: MotionEstimatorWorkerResponse }): void {
		this.dispatchEvent(new MessageEvent("message", { data: response }));
	}
}

function frame({ ptsUs }: { ptsUs: number }) {
	return { gray: new Uint8Array(16), width: 4, height: 4, ptsUs };
}

afterEach(() => vi.restoreAllMocks());

describe("MotionAnalysisClient", () => {
	it("initializes once, transfers frame buffers and returns motions", async () => {
		let worker!: WorkerHarness;
		worker = new WorkerHarness(({ message }) => {
			queueMicrotask(() => {
				if (message.type === "initialize") {
					worker.respond({
						response: {
							id: message.id,
							type: "initialized",
							providerVersion: "test",
						},
					});
				} else if (message.type === "push") {
					worker.respond({
						response: {
							id: message.id,
							type: "motion",
							motion: {
								ptsUs: message.frame.ptsUs,
								dx: 1,
								dy: -2,
								rotation: 0.01,
								scale: 1.001,
								tracked: 50,
								inliers: 40,
							},
						},
					});
				}
			});
		});
		const client = new MotionAnalysisClient({
			createWorker: () => worker as unknown as Worker,
		});
		const first = frame({ ptsUs: 0 });
		const buffer = first.gray.buffer;
		const motion = await client.push({ frame: first });
		await client.push({ frame: frame({ ptsUs: 33_333 }) });
		expect(motion).toMatchObject({ dx: 1, dy: -2, inliers: 40 });
		expect(worker.requests.map((request) => request.type)).toEqual([
			"initialize",
			"push",
			"push",
		]);
		expect(worker.transfers[1]).toEqual([buffer]);
		expect(worker.requests[0]).toMatchObject({
			runtimeUrl: expect.stringContaining("opencv/opencv.js"),
		});
	});

	it("surfaces worker errors and rejects after termination", async () => {
		let worker!: WorkerHarness;
		worker = new WorkerHarness(({ message }) => {
			queueMicrotask(() =>
				worker.respond({
					response:
						message.type === "initialize"
							? { id: message.id, type: "initialized", providerVersion: "t" }
							: { id: message.id, type: "error", message: "wasm oom" },
				})
			);
		});
		const client = new MotionAnalysisClient({
			createWorker: () => worker as unknown as Worker,
		});
		await expect(client.push({ frame: frame({ ptsUs: 0 }) })).rejects.toThrow(
			"wasm oom"
		);
		client.terminate();
		expect(worker.terminate).toHaveBeenCalledTimes(1);
		await expect(client.push({ frame: frame({ ptsUs: 1 }) })).rejects.toThrow(
			/terminated/
		);
	});
});
