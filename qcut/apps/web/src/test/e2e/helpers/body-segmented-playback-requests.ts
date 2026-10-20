import type { ElectronApplication } from "@playwright/test";

export interface SegmentedRenderRequest {
	channel: string;
	requestId?: string;
	sourceKey?: string;
	frameNumber?: number;
	timestampSeconds?: number;
	freshTracking?: boolean;
	preRollFrames: number;
	sequence?: { clip: string; frame: number; fps: number; replay: boolean };
	values?: Record<string, number>;
	enteredAt: number;
	completedAt?: number;
	status: "pending" | "completed" | "rejected";
	result?: {
		cached?: boolean;
		status?: string;
		from?: number;
		sourceWindowCacheHit?: boolean;
		nativeRenderCount?: number;
		needsSourcePreRoll?: boolean;
		cancelled?: boolean;
	};
	error?: string;
}

interface RequestObserverGlobal {
	__segmentedBodyRequests?: SegmentedRenderRequest[];
}

/** Observe original IPC promises; never retain RGBA inputs or substitute results. */
export async function installSegmentedRequestObserver({
	app,
}: {
	app: ElectronApplication;
}) {
	await app.evaluate(({ ipcMain }) => {
		const target = globalThis as unknown as RequestObserverGlobal;
		if (target.__segmentedBodyRequests)
			throw new Error("Segmented request observer already installed");
		const entries: SegmentedRenderRequest[] = [];
		target.__segmentedBodyRequests = entries;
		type Handler = (event: unknown, request: unknown) => unknown;
		const handlers = (
			ipcMain as unknown as { _invokeHandlers: Map<string, Handler> }
		)._invokeHandlers;
		for (const channel of [
			"jianying-portrait-adjustment:render",
			"jianying-portrait-adjustment:cancel",
			"beauty-lab:render-independent-sequence-frame",
			"beauty-lab:cancel-independent",
		]) {
			const original = handlers.get(channel);
			if (!original) throw new Error(`Missing IPC handler ${channel}`);
			handlers.set(channel, (event, request) => {
				const input = request as {
					requestId?: string;
					sourceKey?: string;
					frameNumber?: number;
					timestampSeconds?: number;
					freshTracking?: boolean;
					sourcePreRoll?: { frames?: unknown[] };
					sequence?: SegmentedRenderRequest["sequence"];
					adjustments?: { values?: Record<string, number> };
				};
				const entry: SegmentedRenderRequest = {
					channel,
					requestId: input.requestId,
					sourceKey: input.sourceKey,
					frameNumber: input.frameNumber,
					timestampSeconds: input.timestampSeconds,
					freshTracking: input.freshTracking,
					preRollFrames: input.sourcePreRoll?.frames?.length ?? 0,
					sequence: input.sequence ? { ...input.sequence } : undefined,
					values: input.adjustments?.values
						? { ...input.adjustments.values }
						: undefined,
					enteredAt: Date.now(),
					status: "pending",
				};
				entries.push(entry);
				const rejected = (error: unknown) => {
					entry.status = "rejected";
					entry.completedAt = Date.now();
					entry.error = error instanceof Error ? error.message : String(error);
				};
				try {
					const result = original(event, request);
					void Promise.resolve(result).then((value: unknown) => {
						entry.status = "completed";
						entry.completedAt = Date.now();
						if (
							channel === "jianying-portrait-adjustment:cancel" &&
							typeof value === "boolean"
						) {
							entry.result = { cancelled: value };
							return;
						}
						const receipt = value as SegmentedRenderRequest["result"];
						if (receipt && typeof receipt === "object")
							entry.result = {
								cached: receipt.cached,
								status: receipt.status,
								from: receipt.from,
								sourceWindowCacheHit: receipt.sourceWindowCacheHit,
								nativeRenderCount: receipt.nativeRenderCount,
								needsSourcePreRoll: receipt.needsSourcePreRoll,
								cancelled: receipt.cancelled,
							};
					}, rejected);
					return result;
				} catch (error) {
					rejected(error);
					throw error;
				}
			});
		}
	});
}

export async function readSegmentedRequests({
	app,
	after = 0,
}: {
	app: ElectronApplication;
	after?: number;
}) {
	return app.evaluate((_, after) => {
		const entries = (globalThis as unknown as RequestObserverGlobal)
			.__segmentedBodyRequests;
		if (!entries) throw new Error("Missing segmented request observer");
		return entries.slice(after);
	}, after);
}

/** Only the unchanged clip's target segment proves reuse; prefetch is separate. */
export function verifySegmentCacheReuse({
	requests,
	engine,
	startFrame,
	endFrame,
	clipStartFrame,
	values,
}: {
	requests: SegmentedRenderRequest[];
	engine: "native" | "independent";
	startFrame: number;
	endFrame: number;
	clipStartFrame: number;
	values: Record<string, number>;
}) {
	if (
		!Number.isInteger(startFrame) ||
		!Number.isInteger(endFrame) ||
		startFrame < 0 ||
		endFrame <= startFrame
	)
		throw new Error("Cache reuse requires a nonempty integer frame range");
	const selected: Array<{ frame: number; request: SegmentedRenderRequest }> =
		[];
	for (const request of requests) {
		if (
			request.status !== "completed" ||
			!Object.entries(values).every(
				([name, value]) => request.values?.[name] === value
			)
		)
			continue;
		let frame: number | undefined;
		if (
			engine === "native" &&
			request.channel === "jianying-portrait-adjustment:render" &&
			request.freshTracking === true &&
			request.sourceKey
		)
			frame = request.frameNumber;
		if (
			engine === "independent" &&
			request.channel === "beauty-lab:render-independent-sequence-frame" &&
			request.sequence?.replay === false
		)
			frame = clipStartFrame + request.sequence.frame;
		if (frame !== undefined && frame >= startFrame && frame < endFrame)
			selected.push({ frame, request });
	}
	const frames = [...new Set(selected.map((entry) => entry.frame))].sort(
		(left, right) => left - right
	);
	const missing = Array.from(
		{ length: endFrame - startFrame },
		(_, index) => startFrame + index
	).filter((frame) => !frames.includes(frame));
	if (missing.length)
		throw new Error(`Unchanged segment has missing cache receipts: ${missing}`);
	for (const { frame, request } of selected) {
		const hit =
			engine === "native"
				? request.result?.sourceWindowCacheHit === true &&
					request.result?.nativeRenderCount === 0
				: request.result?.cached === true;
		if (!hit)
			throw new Error(`Unchanged ${engine} frame ${frame} was rendered again`);
	}
	return { startFrame, endFrame, frames, requests: selected };
}
