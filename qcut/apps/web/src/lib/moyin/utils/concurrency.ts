/**
 * Staggered concurrent task executor
 * Ported from moyin-creator
 *
 * Behavior:
 * - Each new task waits at least staggerMs after the previous task started
 * - At most maxConcurrent tasks run simultaneously
 * - When active tasks reach the limit, waits for a task to complete
 *
 * Example: maxConcurrent=3, staggerMs=5000, each task takes 20s:
 *   t=0s:  start task 1
 *   t=5s:  start task 2
 *   t=10s: start task 3 (at concurrency limit)
 *   t=15s: task 4's stagger expires, but concurrency full, queued
 *   t=20s: task 1 completes -> task 4 starts immediately
 */
export async function runStaggered<T>(
	tasks: (() => Promise<T>)[],
	maxConcurrent: number,
	staggerMs: number = 5000
): Promise<PromiseSettledResult<T>[]> {
	if (tasks.length === 0) return [];

	const results: PromiseSettledResult<T>[] = new Array(tasks.length);

	// Semaphore for max concurrency
	let activeCount = 0;
	const waiters: (() => void)[] = [];

	const acquire = async (): Promise<void> => {
		if (activeCount < maxConcurrent) {
			activeCount++;
			return;
		}
		await new Promise<void>((resolve) => waiters.push(resolve));
	};

	const release = (): void => {
		activeCount--;
		if (waiters.length > 0) {
			activeCount++;
			const next = waiters.shift()!;
			next();
		}
	};

	const taskPromises = tasks.map(async (task, idx) => {
		// Stagger: task N starts at least N * staggerMs after task 0
		if (idx > 0) {
			await new Promise<void>((r) => setTimeout(r, idx * staggerMs));
		}

		await acquire();

		try {
			const value = await task();
			results[idx] = { status: "fulfilled", value };
		} catch (reason) {
			results[idx] = { status: "rejected", reason };
		} finally {
			release();
		}
	});

	await Promise.all(taskPromises);
	return results;
}
