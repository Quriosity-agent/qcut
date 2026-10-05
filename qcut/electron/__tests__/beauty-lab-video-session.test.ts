// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	createBeautyLabVideoSession,
	type BeautyLabVideoSessionOptions,
	type BeautyLabVideoSettleResult,
	type BeautyLabVideoSubmitResult,
	type BeautyLabVideoTicket,
} from "../beauty-lab-video-session.js";

const FPS = 30;

function frame(frameNumber: number) {
	return { frameNumber, timestampSeconds: frameNumber / FPS };
}

function preview(options: Partial<BeautyLabVideoSessionOptions> = {}) {
	return createBeautyLabVideoSession({
		sessionId: "session-1",
		sourceKey: "media:clip-1",
		mode: "preview",
		maxInFlight: 1,
		frameTimeoutMs: 1000,
		maxGapSeconds: 0.25,
		...options,
	});
}

function exporter(options: Partial<BeautyLabVideoSessionOptions> = {}) {
	return createBeautyLabVideoSession({
		sessionId: "export-1",
		sourceKey: "media:clip-1",
		mode: "export",
		maxInFlight: 2,
		frameTimeoutMs: 1000,
		maxGapSeconds: 0.25,
		firstFrame: 10,
		plannedFrames: 4,
		...options,
	});
}

function ticketOf(result: BeautyLabVideoSubmitResult): BeautyLabVideoTicket {
	if (result.kind !== "dispatch")
		throw new Error(`Expected dispatch, got ${result.kind}`);
	return result.ticket;
}

function delivered(result: BeautyLabVideoSettleResult) {
	if (result.kind !== "settled")
		throw new Error(`Expected settled, got ${result.kind}`);
	return result.deliver.map((ticket) => ticket.frameNumber);
}

describe("preview sessions keep only the newest picture", () => {
	it("keeps one waiting frame and drops older waiting frames before inference", () => {
		const session = preview();
		const first = ticketOf(session.submit({ frame: frame(0), now: 0 }));
		expect(session.submit({ frame: frame(1), now: 1 })).toEqual({
			kind: "queued",
		});
		expect(session.submit({ frame: frame(2), now: 2 })).toEqual({
			kind: "queued",
			dropped: frame(1),
		});
		const settled = session.complete({ ticket: first, now: 10 });
		expect(delivered(settled)).toEqual([0]);
		expect(settled.kind === "settled" && settled.dispatch?.frameNumber).toBe(2);
		expect(session.report()).toMatchObject({
			submitted: 3,
			dispatched: 2,
			dropped: 1,
		});
	});
	it("never lets a pre-seek result replace the new generation", () => {
		const session = preview();
		const old = ticketOf(session.submit({ frame: frame(0), now: 0 }));
		expect(session.seek()).toBe(1);
		// The stale ticket still holds the only worker slot.
		expect(session.submit({ frame: frame(90), now: 5 })).toEqual({
			kind: "queued",
		});
		const settled = session.complete({ ticket: old, now: 20 });
		expect(settled.kind).toBe("stale");
		const next = settled.kind === "stale" ? settled.dispatch : undefined;
		expect(next).toMatchObject({
			frameNumber: 90,
			generation: 1,
			resetTemporalState: true,
		});
		expect(delivered(session.complete({ ticket: next!, now: 30 }))).toEqual([
			90,
		]);
		expect(session.report()).toMatchObject({
			stale: 1,
			delivered: 1,
			generations: 1,
		});
	});
	it("treats an older completion as stale once a newer frame was shown", () => {
		const session = preview({ maxInFlight: 2 });
		const older = ticketOf(session.submit({ frame: frame(0), now: 0 }));
		const newer = ticketOf(session.submit({ frame: frame(1), now: 1 }));
		expect(delivered(session.complete({ ticket: newer, now: 5 }))).toEqual([1]);
		expect(delivered(session.complete({ ticket: older, now: 6 }))).toEqual([]);
		expect(session.report()).toMatchObject({ delivered: 1, stale: 1 });
	});
	it("restarts temporal state on gaps, backwards jumps and new generations", () => {
		const session = preview({ maxInFlight: 8 });
		const resets = [0, 1, 30, 2]
			.map((number) =>
				ticketOf(session.submit({ frame: frame(number), now: number }))
			)
			.map((ticket) => ticket.resetTemporalState);
		expect(resets).toEqual([true, false, true, true]);
	});
	it("skips failed frames, restarts temporal state and fails after the limit", () => {
		const session = preview({ maxConsecutiveFailures: 2 });
		const first = ticketOf(session.submit({ frame: frame(0), now: 0 }));
		expect(session.reject({ ticket: first, reason: "decode", now: 1 })).toEqual(
			{
				kind: "settled",
				deliver: [],
			}
		);
		const second = ticketOf(session.submit({ frame: frame(1), now: 2 }));
		expect(second.resetTemporalState).toBe(true);
		expect(delivered(session.complete({ ticket: second, now: 3 }))).toEqual([
			1,
		]);
		const third = ticketOf(session.submit({ frame: frame(2), now: 4 }));
		session.reject({ ticket: third, reason: "decode", now: 5 });
		const fourth = ticketOf(session.submit({ frame: frame(3), now: 6 }));
		expect(
			session.reject({ ticket: fourth, reason: "decode", now: 7 })
		).toEqual({
			kind: "session-failed",
			reason: "2 consecutive failures",
		});
		expect(() => session.submit({ frame: frame(4), now: 8 })).toThrow(/failed/);
	});
	it("times out stuck frames through tick", () => {
		const session = preview({ frameTimeoutMs: 100 });
		ticketOf(session.submit({ frame: frame(0), now: 0 }));
		expect(session.tick({ now: 99 })).toEqual([]);
		expect(session.tick({ now: 100 })).toEqual([
			{ kind: "settled", deliver: [] },
		]);
		expect(session.report()).toMatchObject({
			timeouts: 1,
			failed: 1,
			inFlight: 0,
		});
	});
	it("binds tickets to the current source and retires the old one", () => {
		const session = preview();
		const old = ticketOf(session.submit({ frame: frame(0), now: 0 }));
		session.changeSource({ sourceKey: "media:clip-2" });
		session.submit({ frame: frame(0), now: 1 });
		const settled = session.complete({ ticket: old, now: 2 });
		expect(settled.kind === "stale" && settled.dispatch).toMatchObject({
			sourceKey: "media:clip-2",
			generation: 1,
		});
		expect(() => session.changeSource({ sourceKey: "bad key" })).toThrow();
	});
	it("cancels, drains reserved slots and only then closes", () => {
		const session = preview();
		const ticket = ticketOf(session.submit({ frame: frame(0), now: 0 }));
		session.cancel();
		expect(() => session.submit({ frame: frame(1), now: 1 })).toThrow(
			/cancelled/
		);
		expect(session.drained()).toBe(false);
		expect(() => session.close()).toThrow(/settle/);
		expect(session.complete({ ticket, now: 2 })).toEqual({ kind: "stale" });
		expect(session.drained()).toBe(true);
		session.close();
		expect(session.report().state).toBe("cancelled");
	});
	it("rejects forged or repeated tickets", () => {
		const session = preview();
		const ticket = ticketOf(session.submit({ frame: frame(0), now: 0 }));
		expect(() =>
			session.complete({ ticket: { ...ticket, generation: 7 }, now: 1 })
		).toThrow(/forged/);
		session.complete({ ticket, now: 1 });
		expect(() => session.complete({ ticket, now: 2 })).toThrow(/forged/);
	});
	it.each([
		{ frameNumber: -1, timestampSeconds: 0 },
		{ frameNumber: 1.5, timestampSeconds: 0 },
		{ frameNumber: 1, timestampSeconds: Number.NaN },
		{ frameNumber: 1, timestampSeconds: -0.1 },
	])("rejects invalid frame %j", (bad) => {
		expect(() => preview().submit({ frame: bad, now: 0 })).toThrow(/identity/);
	});
	it.each([
		{ maxInFlight: 0 },
		{ maxInFlight: 9 },
		{ frameTimeoutMs: 0 },
		{ maxGapSeconds: 0 },
		{ sessionId: "bad id" },
		{ maxConsecutiveFailures: 0 },
	])("rejects invalid options %j", (options) => {
		expect(() => preview(options)).toThrow(/options/);
	});
	it("reports nearest-rank latency percentiles and throughput", () => {
		const session = preview();
		for (const [index, latency] of [10, 20, 30, 40].entries()) {
			const start = index * 100;
			const ticket = ticketOf(
				session.submit({ frame: frame(index), now: start })
			);
			session.complete({ ticket, now: start + latency });
		}
		expect(session.report()).toMatchObject({
			latencyMs: { samples: 4, p50: 20, p95: 40, p99: 40 },
			throughputFps: 4000 / 340,
		});
	});
});

describe("export sessions deliver every frame once, in order", () => {
	it("requires the exact planned order and applies backpressure", () => {
		const session = exporter();
		expect(() => session.submit({ frame: frame(11), now: 0 })).toThrow(
			/in order/
		);
		const first = ticketOf(session.submit({ frame: frame(10), now: 0 }));
		ticketOf(session.submit({ frame: frame(11), now: 1 }));
		expect(session.submit({ frame: frame(12), now: 2 })).toEqual({
			kind: "backpressure",
		});
		expect(session.report().submitted).toBe(2);
		session.complete({ ticket: first, now: 3 });
		expect(
			ticketOf(session.submit({ frame: frame(12), now: 4 })).frameNumber
		).toBe(12);
		expect(() => session.submit({ frame: frame(12), now: 5 })).toThrow(
			/in order/
		);
	});
	it("reorders out-of-order completions and closes after the plan", () => {
		const session = exporter();
		const tickets = [
			ticketOf(session.submit({ frame: frame(10), now: 0 })),
			ticketOf(session.submit({ frame: frame(11), now: 0 })),
		];
		expect(delivered(session.complete({ ticket: tickets[1], now: 5 }))).toEqual(
			[]
		);
		expect(delivered(session.complete({ ticket: tickets[0], now: 6 }))).toEqual(
			[10, 11]
		);
		const third = ticketOf(session.submit({ frame: frame(12), now: 7 }));
		const fourth = ticketOf(session.submit({ frame: frame(13), now: 7 }));
		expect(() => session.submit({ frame: frame(14), now: 8 })).toThrow(/plan/);
		session.complete({ ticket: third, now: 9 });
		expect(delivered(session.complete({ ticket: fourth, now: 10 }))).toEqual([
			13,
		]);
		expect(session.report()).toMatchObject({
			state: "closed",
			delivered: 4,
			plannedFrames: 4,
			dropped: 0,
		});
	});
	it("fails the whole export on the first failure and never delivers after it", () => {
		const session = exporter();
		const first = ticketOf(session.submit({ frame: frame(10), now: 0 }));
		const second = ticketOf(session.submit({ frame: frame(11), now: 0 }));
		expect(
			session.reject({ ticket: first, reason: "inference", now: 1 })
		).toEqual({
			kind: "session-failed",
			reason: "frame 10: inference",
		});
		expect(session.complete({ ticket: second, now: 2 })).toEqual({
			kind: "stale",
		});
		expect(session.report()).toMatchObject({
			state: "failed",
			delivered: 0,
			failure: "frame 10: inference",
		});
	});
	it("fails the export when a frame times out", () => {
		const session = exporter({ frameTimeoutMs: 50 });
		ticketOf(session.submit({ frame: frame(10), now: 0 }));
		expect(session.tick({ now: 50 })).toEqual([
			{ kind: "session-failed", reason: "frame 10: frame timed out" },
		]);
	});
	it("never seeks, changes source or runs without a plan", () => {
		const session = exporter();
		expect(() => session.seek()).toThrow(/cannot seek/);
		expect(() => session.changeSource({ sourceKey: "media:clip-2" })).toThrow();
		expect(() => exporter({ plannedFrames: undefined })).toThrow(/planned/);
		expect(() => exporter({ plannedFrames: 0 })).toThrow(/planned/);
	});
});
