import { randomUUID } from "node:crypto";

export function createPortraitRenderRequests() {
	const active = new Map<string, AbortController>();
	return {
		run: <Result>({
			requestId = randomUUID(),
			enqueue,
		}: {
			requestId?: string;
			enqueue: (signal: AbortSignal) => Promise<Result>;
		}): Promise<Result> => {
			if (active.has(requestId))
				return Promise.reject(
					new Error("Native portrait request is already pending")
				);
			const controller = new AbortController();
			active.set(requestId, controller);
			let rejectCancelled: (error: Error) => void = () => {};
			const cancelled = new Promise<never>((_resolve, reject) => {
				rejectCancelled = reject;
			});
			const onAbort = () =>
				rejectCancelled(
					new DOMException("Native portrait render cancelled", "AbortError")
				);
			controller.signal.addEventListener("abort", onAbort, { once: true });
			let operation: Promise<Result>;
			try {
				operation = enqueue(controller.signal);
			} catch (error) {
				operation = Promise.reject(error);
			}
			const settled = operation.finally(() => {
				active.delete(requestId);
				controller.signal.removeEventListener("abort", onAbort);
			});
			// Keep identity reserved until native work settles, even when the caller returns early.
			return Promise.race([settled, cancelled]);
		},
		cancel: ({ requestId }: { requestId: string }) => {
			const controller = active.get(requestId);
			if (!controller || controller.signal.aborted) return false;
			controller.abort();
			return true;
		},
		cancelAll: () => {
			for (const controller of active.values()) controller.abort();
		},
	};
}
