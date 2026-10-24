// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ElectronApplication } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installBodyWorkerObserver,
	readBodyWorkerObservation,
} from "../body-video-worker-observer";

type Handler = (event: unknown, request: unknown) => unknown;
const SEQUENCE = "beauty-lab:render-independent-sequence-frame";

async function fixture({ handler }: { handler: Handler }) {
	class Child extends EventEmitter {
		pid = 91;
		stdout = new PassThrough();
		stdin = new Writable({ write: (_chunk, _encoding, done) => done() });
		spawn(_options: { args: string[] }) {
			return 0;
		}
	}
	const builtin = process.getBuiltinModule.bind(process);
	vi.spyOn(process, "getBuiltinModule").mockImplementation((name) =>
		name === "node:child_process" ? { ChildProcess: Child } : builtin(name)
	);
	const handlers = new Map<string, Handler>([
		[SEQUENCE, handler],
		["beauty-lab:cancel-independent", () => ({ cancelled: true })],
	]);
	const electron = { ipcMain: { _invokeHandlers: handlers } };
	const app = {
		evaluate: async (callback: (main: typeof electron) => unknown) =>
			callback(electron),
	} as unknown as ElectronApplication;
	await installBodyWorkerObserver({ app });
	const observed = handlers.get(SEQUENCE)!;
	const child = new Child();
	expect(
		child.spawn({ args: ["python", "/owned/independent_worker.py"] })
	).toBe(0);
	return { app, observed, child };
}

function request({ id = "outer-a", frame = 3, replay = false } = {}) {
	return {
		requestId: id,
		sequence: { frame, clip: "clip-a", fps: 30, replay },
		adjustments: {
			bodyVideoProfile: "swing-coreml-v1",
			values: { body_adjust_SlimBody: 40 },
		},
	};
}

function worker({
	id = "worker-a",
	outerRequestId = "outer-a",
	frame = 3,
}: {
	id?: string;
	outerRequestId?: string | null;
	frame?: number;
} = {}) {
	return {
		id,
		...(outerRequestId === null ? {} : { outerRequestId }),
		sequence: {
			frame,
			session: "session-a",
			timestamp: frame / 30,
			checkpoints: "/private/session-a",
			executionProfile: "swing-coreml-v1",
			executionGeneration: "session-a",
		},
	};
}

beforeEach(() => vi.stubGlobal("__bodyWorkerObservation", undefined));
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("body worker transport evidence", () => {
	it("retains completed cache-hit history while preserving the original promise and bytes", async () => {
		const rgba = new Uint8Array([1, 2, 3, 255]);
		const result = { status: "rendered", cached: true, rgba };
		const promise = Promise.resolve(result);
		const handler = vi.fn(() => promise);
		const { app, observed } = await fixture({ handler });
		const input = request();
		expect(observed({}, input)).toBe(promise);
		expect(await promise).toBe(result);
		const observation = await readBodyWorkerObservation({ app });
		expect(observation.sequenceRequests).toEqual([]);
		expect(observation.sequenceHistory).toMatchObject([
			{
				requestId: "outer-a",
				frame: 3,
				clip: "clip-a",
				fps: 30,
				replay: false,
				profile: "swing-coreml-v1",
				status: "completed",
				result: { status: "rendered", cached: true },
				sessions: [],
				workerRequestIds: [],
			},
		]);
		expect(observation.sequenceHistory[0].elapsedMs).toBeGreaterThanOrEqual(0);
		expect(JSON.stringify(observation)).not.toContain('"rgba"');
		expect(handler).toHaveBeenCalledWith({}, input);
	});

	it("keeps replay/gap outcomes and binds a worker by its explicit outer transport id", async () => {
		let finish!: (value: unknown) => void;
		const promise = new Promise((resolve) => {
			finish = resolve;
		});
		const { app, observed, child } = await fixture({ handler: () => promise });
		expect(observed({}, request({ replay: true }))).toBe(promise);
		const bytes = `${JSON.stringify(worker())}\n`;
		const written: string[] = [];
		child.stdin._write = ((original) =>
			function (this: Writable, chunk, encoding, callback) {
				written.push(String(chunk));
				original.call(this, chunk, encoding, callback);
			})(child.stdin._write);
		child.stdin.write(bytes);
		child.stdout.write(
			`${JSON.stringify({ id: "worker-a", ok: false, error: "gap", gap: { restartFrom: 0 } })}\n`
		);
		finish({ status: "replay", from: 0 });
		await promise;
		const observation = await readBodyWorkerObservation({ app });
		expect(written).toEqual([bytes]);
		expect(observation.pending).toEqual([]);
		expect(observation.workerHistory).toMatchObject([
			{
				id: "worker-a",
				outerRequestId: "outer-a",
				association: "transport-id",
				outcome: "gap",
				restartFrom: 0,
			},
		]);
		expect(observation.sequenceHistory[0]).toMatchObject({
			replay: true,
			result: { status: "replay", from: 0 },
			sessions: ["session-a"],
			workerRequestIds: ["worker-a"],
		});
		expect(observation.evidenceErrors).toEqual([]);
	});

	it("leaves legacy workers unassociated even when exactly one IPC request is active", async () => {
		const { app, observed, child } = await fixture({
			handler: () => Promise.resolve({ status: "rendered" }),
		});
		observed({}, request());
		child.stdin.write(`${JSON.stringify(worker({ outerRequestId: null }))}\n`);
		child.emit("exit");
		const observation = await readBodyWorkerObservation({ app });
		expect(observation.workerHistory[0]).toMatchObject({
			association: "unavailable",
			outcome: "exit",
		});
		expect(observation.workerHistory[0].outerRequestId).toBeUndefined();
		expect(observation.sequenceHistory[0].workerRequestIds).toEqual([]);
	});

	it.each([
		{ outerRequestId: "unknown" },
		{ frame: 4 },
	])("rejects false worker association %o without changing the transport", async (invalid) => {
		const { app, observed, child } = await fixture({
			handler: () => Promise.resolve({ status: "rendered" }),
		});
		observed({}, request());
		child.stdin.write(`${JSON.stringify(worker(invalid))}\n`);
		const observation = await readBodyWorkerObservation({ app });
		expect(observation.evidenceErrors).toEqual([
			"Worker outer request identity mismatch: worker-a",
		]);
		expect(observation.workerHistory[0].association).toBe(
			"invalid-transport-id"
		);
		expect(observation.sequenceHistory[0].workerRequestIds).toEqual([]);
	});

	it("keeps distinct concurrent outer requests associated by id rather than arrival order", async () => {
		const { app, observed, child } = await fixture({
			handler: () => Promise.resolve({ status: "rendered" }),
		});
		observed({}, request({ id: "outer-a" }));
		observed({}, request({ id: "outer-b" }));
		child.stdin.write(
			`${JSON.stringify(worker({ outerRequestId: "outer-b" }))}\n`
		);
		const observation = await readBodyWorkerObservation({ app });
		expect(observation.sequenceHistory[0].workerRequestIds).toEqual([]);
		expect(observation.sequenceHistory[1].workerRequestIds).toEqual([
			"worker-a",
		]);
	});

	it.each([
		0.083417, 0.1,
	])("validates decoded source PTS independently of the timeline clock (%s)", async (timestamp) => {
		const { app, observed, child } = await fixture({
			handler: () => Promise.resolve({ status: "rendered" }),
		});
		const input = request();
		observed(
			{},
			{
				...input,
				sequence: { ...input.sequence, sourceTimestampSeconds: 0.083417 },
			}
		);
		const job = worker();
		child.stdin.write(
			`${JSON.stringify({ ...job, sequence: { ...job.sequence, timestamp } })}\n`
		);
		const observation = await readBodyWorkerObservation({ app });
		expect(observation.sequenceHistory[0].sourceTimestampSeconds).toBe(
			0.083417
		);
		expect(observation.workerHistory[0].association).toBe(
			timestamp === 0.083417 ? "transport-id" : "invalid-transport-id"
		);
		expect(observation.evidenceErrors).toEqual(
			timestamp === 0.083417
				? []
				: ["Worker outer request identity mismatch: worker-a"]
		);
	});

	it.each([
		false,
		true,
	])("records rejection without replacing the original error (sync=%s)", async (sync) => {
		const error = new Error("cancelled");
		const { app, observed } = await fixture({
			handler: () => {
				if (sync) throw error;
				return Promise.reject(error);
			},
		});
		if (sync) expect(() => observed({}, request())).toThrow(error);
		else await expect(observed({}, request())).rejects.toBe(error);
		const observation = await readBodyWorkerObservation({ app });
		expect(observation.sequenceRequests).toEqual([]);
		expect(observation.sequenceHistory[0]).toMatchObject({
			status: "rejected",
			error: "cancelled",
		});
	});
});
