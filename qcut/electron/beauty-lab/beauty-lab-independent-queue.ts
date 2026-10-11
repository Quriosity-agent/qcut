import type { BeautyLabIndependentResult } from "./beauty-lab-independent-contract.js";
import type { createBeautyLabIndependentProvider } from "./beauty-lab-independent.js";

type IndependentProvider = Pick<
	ReturnType<typeof createBeautyLabIndependentProvider>,
	"inspect" | "render" | "cancel" | "dispose"
>;

interface QueuedRender {
	requestId: string;
	request: unknown;
	resolve: (result: BeautyLabIndependentResult) => void;
	reject: (error: unknown) => void;
}

function queuedRequestId({ request }: { request: unknown }) {
	const requestId =
		request && typeof request === "object"
			? (request as { requestId?: unknown }).requestId
			: undefined;
	if (typeof requestId !== "string" || !requestId)
		throw new Error("Invalid independent request id");
	return requestId;
}

/**
 * The independent engine runs one job at a time and rejects a second caller as
 * busy. Beauty Lab, the paused preview and export all share it, so renders run
 * here in arrival order, and each caller can cancel its own request whether it
 * is still waiting or already running.
 */
export function createIndependentRenderQueue({
	provider,
}: {
	provider: IndependentProvider;
}) {
	const waiting: QueuedRender[] = [];
	let running: QueuedRender | undefined;
	let disposed = false;

	async function runNext() {
		if (running || disposed) return;
		const next = waiting.shift();
		if (!next) return;
		running = next;
		try {
			next.resolve(await provider.render({ request: next.request }));
		} catch (error) {
			next.reject(error);
		} finally {
			running = undefined;
			void runNext();
		}
	}

	function render({
		request,
	}: {
		request: unknown;
	}): Promise<BeautyLabIndependentResult> {
		if (disposed)
			return Promise.reject(new Error("Independent engine busy or disposed"));
		let requestId: string;
		try {
			requestId = queuedRequestId({ request });
		} catch (error) {
			return Promise.reject(error);
		}
		// Cancellation is addressed by request id, so ids must stay unique.
		if (
			running?.requestId === requestId ||
			waiting.some((job) => job.requestId === requestId)
		)
			return Promise.reject(new Error("Duplicate independent request id"));
		return new Promise((resolve, reject) => {
			waiting.push({ requestId, request, resolve, reject });
			void runNext();
		});
	}

	function cancel({ request }: { request: { requestId: string } }) {
		const index = waiting.findIndex(
			(job) => job.requestId === request?.requestId
		);
		if (index < 0) return provider.cancel({ request });
		const [job] = waiting.splice(index, 1);
		job.reject(new Error("Independent beauty cancelled"));
		return { cancelled: true };
	}

	async function dispose() {
		disposed = true;
		for (const job of waiting.splice(0))
			job.reject(new Error("Independent engine busy or disposed"));
		await provider.dispose();
	}

	return { inspect: provider.inspect, render, cancel, dispose };
}
