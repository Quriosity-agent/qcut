import { waitForFrameOperation } from "./beauty-lab-independent-frames.js";

/** Serializes cache lookup through publication without sharing caller results. */
export function createIndependentKeyedQueue() {
	const tails = new Map<string, Promise<void>>();
	async function run<T>({
		key,
		signal,
		operation,
	}: {
		key: string;
		signal: AbortSignal;
		operation: () => Promise<T>;
	}) {
		signal.throwIfAborted();
		const previous = tails.get(key);
		let release!: () => void;
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous ? previous.then(() => released) : released;
		tails.set(key, tail);
		void tail.then(() => {
			if (tails.get(key) === tail) tails.delete(key);
		});
		try {
			if (previous)
				await waitForFrameOperation({ signal, operation: () => previous });
			signal.throwIfAborted();
			// Started operations own cancellation and must drain before the next caller.
			return await operation();
		} finally {
			// A cancelled waiter still leaves its predecessor ahead of later callers.
			release();
		}
	}
	return { run };
}
