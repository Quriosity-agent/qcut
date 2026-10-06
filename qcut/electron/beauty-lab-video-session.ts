/**
 * Bounded continuous-session protocol for Beauty Lab video candidates.
 *
 * Pure state machine: no timers, workers or pixels. Callers pass `now` and keep
 * payloads keyed by ticket sequence. It is not registered as a product backend.
 *
 * - Every seek, source change or cancellation starts a new generation; results
 *   from an older generation are stale and can never replace a newer picture.
 * - Preview keeps the newest waiting frame only (older waiting frames are
 *   dropped before inference, so temporal state never advances on them).
 * - Export accepts each frame exactly once in order, never drops, applies
 *   backpressure, delivers in order through a reorder buffer, and fails the
 *   whole session on the first frame failure or timeout.
 * - Stale tickets keep their worker slot until they settle, so a seek cannot
 *   over-commit the worker.
 */

export type BeautyLabVideoMode = "preview" | "export";
export type BeautyLabVideoState = "running" | "cancelled" | "failed" | "closed";

export interface BeautyLabVideoFrame {
	frameNumber: number;
	timestampSeconds: number;
}

export interface BeautyLabVideoTicket extends BeautyLabVideoFrame {
	sessionId: string;
	sourceKey: string;
	generation: number;
	sequence: number;
	// First frame of a generation, or a gap wider than maxGapSeconds.
	resetTemporalState: boolean;
}

export interface BeautyLabVideoSessionOptions {
	sessionId: string;
	sourceKey: string;
	mode: BeautyLabVideoMode;
	maxInFlight: number;
	frameTimeoutMs: number;
	maxGapSeconds: number;
	// Preview only; export always fails on the first failure.
	maxConsecutiveFailures?: number;
	// Export only: the exact frame range that must be delivered.
	firstFrame?: number;
	plannedFrames?: number;
}

export type BeautyLabVideoSubmitResult =
	| { kind: "dispatch"; ticket: BeautyLabVideoTicket }
	| { kind: "queued"; dropped?: BeautyLabVideoFrame }
	| { kind: "backpressure" };

export type BeautyLabVideoSettleResult =
	| {
			kind: "settled";
			deliver: BeautyLabVideoTicket[];
			dispatch?: BeautyLabVideoTicket;
	  }
	| { kind: "stale"; dispatch?: BeautyLabVideoTicket }
	| { kind: "session-failed"; reason: string };

interface Flight {
	ticket: BeautyLabVideoTicket;
	dispatchedAt: number;
	stale: boolean;
}

const LATENCY_SAMPLES = 4096;

function invariant({
	condition,
	message,
}: {
	condition: boolean;
	message: string;
}): void {
	if (!condition) throw new Error(message);
}

function percentile({ sorted, rank }: { sorted: number[]; rank: number }) {
	if (!sorted.length) return null;
	return sorted[
		Math.min(sorted.length - 1, Math.ceil(rank * sorted.length) - 1)
	];
}

function validFrame({ frame }: { frame: BeautyLabVideoFrame }) {
	invariant({
		condition:
			Number.isSafeInteger(frame.frameNumber) &&
			frame.frameNumber >= 0 &&
			Number.isFinite(frame.timestampSeconds) &&
			frame.timestampSeconds >= 0,
		message: "Invalid video frame identity",
	});
}

export function createBeautyLabVideoSession(
	options: BeautyLabVideoSessionOptions
) {
	const {
		sessionId,
		mode,
		maxInFlight,
		frameTimeoutMs,
		maxGapSeconds,
		maxConsecutiveFailures = 3,
		firstFrame = 0,
		plannedFrames,
	} = options;
	invariant({
		condition:
			/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId) &&
			/^[A-Za-z0-9._:-]{1,256}$/.test(options.sourceKey) &&
			Number.isSafeInteger(maxInFlight) &&
			maxInFlight >= 1 &&
			maxInFlight <= 8 &&
			Number.isFinite(frameTimeoutMs) &&
			frameTimeoutMs > 0 &&
			Number.isFinite(maxGapSeconds) &&
			maxGapSeconds > 0 &&
			Number.isSafeInteger(maxConsecutiveFailures) &&
			maxConsecutiveFailures >= 1,
		message: "Invalid video session options",
	});
	invariant({
		condition:
			mode === "preview" ||
			(Number.isSafeInteger(firstFrame) &&
				firstFrame >= 0 &&
				plannedFrames !== undefined &&
				Number.isSafeInteger(plannedFrames) &&
				plannedFrames >= 1 &&
				// The last required frame number must stay a safe integer.
				plannedFrames - 1 <= Number.MAX_SAFE_INTEGER - firstFrame),
		message: "Export sessions require an exact planned frame range",
	});
	let sourceKey = options.sourceKey;
	let state: BeautyLabVideoState = "running";
	let failure: string | undefined;
	let generation = 0;
	let sequence = 0;
	let lastTimestamp: number | undefined;
	let pending: BeautyLabVideoFrame | undefined;
	let nextExportFrame = firstFrame;
	let lastExportTimestamp = -1;
	let nextDelivery = 1;
	let lastPreviewDelivery = 0;
	let consecutiveFailures = 0;
	const flights = new Map<number, Flight>();
	const ready = new Map<number, BeautyLabVideoTicket>();
	const latencies: number[] = [];
	const counts = {
		submitted: 0,
		dispatched: 0,
		delivered: 0,
		dropped: 0,
		stale: 0,
		failed: 0,
		timeouts: 0,
		generations: 0,
		maxInFlightObserved: 0,
	};
	let firstDispatchAt: number | undefined;
	let lastDeliveryAt: number | undefined;

	function requireRunning() {
		invariant({
			condition: state === "running",
			message: `Video session is ${state}`,
		});
	}

	function dispatch({
		frame,
		now,
	}: {
		frame: BeautyLabVideoFrame;
		now: number;
	}): BeautyLabVideoTicket {
		sequence += 1;
		const reset =
			lastTimestamp === undefined ||
			frame.timestampSeconds < lastTimestamp ||
			frame.timestampSeconds - lastTimestamp > maxGapSeconds;
		lastTimestamp = frame.timestampSeconds;
		const ticket: BeautyLabVideoTicket = {
			...frame,
			sessionId,
			sourceKey,
			generation,
			sequence,
			resetTemporalState: reset,
		};
		flights.set(sequence, { ticket, dispatchedAt: now, stale: false });
		counts.dispatched += 1;
		counts.maxInFlightObserved = Math.max(
			counts.maxInFlightObserved,
			flights.size
		);
		firstDispatchAt ??= now;
		return ticket;
	}

	function nextGeneration({ resetPending }: { resetPending: boolean }) {
		generation += 1;
		counts.generations += 1;
		lastTimestamp = undefined;
		if (resetPending && pending) {
			pending = undefined;
			counts.dropped += 1;
		}
		for (const flight of flights.values()) flight.stale = true;
		ready.clear();
	}

	function fail({ reason }: { reason: string }): BeautyLabVideoSettleResult {
		state = "failed";
		failure = reason;
		pending = undefined;
		for (const flight of flights.values()) flight.stale = true;
		ready.clear();
		return { kind: "session-failed", reason };
	}

	function releaseSlot({
		now,
	}: {
		now: number;
	}): BeautyLabVideoTicket | undefined {
		if (state !== "running" || !pending || flights.size >= maxInFlight) return;
		const frame = pending;
		pending = undefined;
		return dispatch({ frame, now });
	}

	function take({ ticket }: { ticket: BeautyLabVideoTicket }): Flight {
		const flight = flights.get(ticket.sequence);
		if (
			!flight ||
			flight.ticket.sessionId !== ticket.sessionId ||
			flight.ticket.generation !== ticket.generation
		)
			throw new Error("Unknown or forged video ticket");
		flights.delete(ticket.sequence);
		return flight;
	}

	function submit({
		frame,
		now,
	}: {
		frame: BeautyLabVideoFrame;
		now: number;
	}): BeautyLabVideoSubmitResult {
		requireRunning();
		validFrame({ frame });
		if (mode === "export") {
			invariant({
				condition:
					frame.frameNumber === nextExportFrame &&
					frame.timestampSeconds > lastExportTimestamp &&
					plannedFrames !== undefined &&
					frame.frameNumber < firstFrame + plannedFrames,
				message: "Export frames must arrive once, in order, within the plan",
			});
			// Completed frames waiting in `ready` still hold caller payloads.
			if (flights.size + ready.size >= maxInFlight)
				return { kind: "backpressure" };
			counts.submitted += 1;
			nextExportFrame += 1;
			lastExportTimestamp = frame.timestampSeconds;
			return { kind: "dispatch", ticket: dispatch({ frame, now }) };
		}
		counts.submitted += 1;
		// Any waiting frame is older than this one, so the newest frame wins.
		const dropped = pending;
		pending = undefined;
		if (dropped) counts.dropped += 1;
		if (flights.size < maxInFlight)
			return { kind: "dispatch", ticket: dispatch({ frame, now }) };
		pending = { ...frame };
		return dropped ? { kind: "queued", dropped } : { kind: "queued" };
	}

	function complete({
		ticket,
		now,
	}: {
		ticket: BeautyLabVideoTicket;
		now: number;
	}): BeautyLabVideoSettleResult {
		const flight = take({ ticket });
		if (flight.stale || state !== "running") {
			counts.stale += 1;
			const next = releaseSlot({ now });
			return next ? { kind: "stale", dispatch: next } : { kind: "stale" };
		}
		consecutiveFailures = 0;
		latencies.push(now - flight.dispatchedAt);
		if (latencies.length > LATENCY_SAMPLES) latencies.shift();
		let deliver: BeautyLabVideoTicket[] = [];
		if (mode === "export") {
			ready.set(ticket.sequence, flight.ticket);
			while (ready.has(nextDelivery)) {
				deliver.push(ready.get(nextDelivery)!);
				ready.delete(nextDelivery);
				nextDelivery += 1;
			}
		} else if (ticket.sequence > lastPreviewDelivery) {
			lastPreviewDelivery = ticket.sequence;
			deliver = [flight.ticket];
		} else {
			counts.stale += 1;
		}
		counts.delivered += deliver.length;
		if (deliver.length) lastDeliveryAt = now;
		if (
			mode === "export" &&
			plannedFrames !== undefined &&
			counts.delivered === plannedFrames
		)
			state = "closed";
		const next = releaseSlot({ now });
		return next
			? { kind: "settled", deliver, dispatch: next }
			: { kind: "settled", deliver };
	}

	function reject({
		ticket,
		reason,
		now,
	}: {
		ticket: BeautyLabVideoTicket;
		reason: string;
		now: number;
	}): BeautyLabVideoSettleResult {
		const flight = take({ ticket });
		if (flight.stale || state !== "running") {
			counts.stale += 1;
			const next = releaseSlot({ now });
			return next ? { kind: "stale", dispatch: next } : { kind: "stale" };
		}
		counts.failed += 1;
		consecutiveFailures += 1;
		if (mode === "export")
			return fail({ reason: `frame ${ticket.frameNumber}: ${reason}` });
		if (consecutiveFailures >= maxConsecutiveFailures)
			return fail({ reason: `${consecutiveFailures} consecutive failures` });
		// The skipped frame's temporal state is unknown; restart it on the next frame.
		lastTimestamp = undefined;
		const next = releaseSlot({ now });
		return next
			? { kind: "settled", deliver: [], dispatch: next }
			: { kind: "settled", deliver: [] };
	}

	function tick({ now }: { now: number }): BeautyLabVideoSettleResult[] {
		const outcomes: BeautyLabVideoSettleResult[] = [];
		for (const flight of [...flights.values()]) {
			if (now - flight.dispatchedAt < frameTimeoutMs) continue;
			counts.timeouts += 1;
			outcomes.push(
				reject({ ticket: flight.ticket, reason: "frame timed out", now })
			);
		}
		return outcomes;
	}

	return {
		submit,
		complete,
		reject,
		tick,
		seek: () => {
			requireRunning();
			invariant({
				condition: mode === "preview",
				message: "Export sessions cannot seek",
			});
			nextGeneration({ resetPending: true });
			return generation;
		},
		changeSource: ({ sourceKey: next }: { sourceKey: string }) => {
			requireRunning();
			invariant({
				condition: mode === "preview" && /^[A-Za-z0-9._:-]{1,256}$/.test(next),
				message: "Only preview sessions may change to a valid source",
			});
			sourceKey = next;
			nextGeneration({ resetPending: true });
			return generation;
		},
		cancel: () => {
			if (state !== "running") return;
			state = "cancelled";
			nextGeneration({ resetPending: true });
		},
		// Worker slots stay reserved until every ticket, stale or not, has settled.
		drained: () => flights.size === 0,
		close: () => {
			invariant({
				condition: flights.size === 0,
				message: "Close requires every dispatched frame to settle",
			});
			if (state === "running") state = "closed";
		},
		report: () => {
			const sorted = [...latencies].sort((left, right) => left - right);
			const elapsed =
				firstDispatchAt !== undefined && lastDeliveryAt !== undefined
					? lastDeliveryAt - firstDispatchAt
					: 0;
			return {
				schema: "qcut-beauty-video-session-v1" as const,
				sessionId,
				sourceKey,
				mode,
				state,
				failure,
				generation,
				plannedFrames: mode === "export" ? plannedFrames : undefined,
				...counts,
				inFlight: flights.size,
				latencyMs: {
					samples: sorted.length,
					p50: percentile({ sorted, rank: 0.5 }),
					p95: percentile({ sorted, rank: 0.95 }),
					p99: percentile({ sorted, rank: 0.99 }),
				},
				throughputFps: elapsed > 0 ? (counts.delivered * 1000) / elapsed : null,
			};
		},
	};
}

export type BeautyLabVideoSession = ReturnType<
	typeof createBeautyLabVideoSession
>;
