/**
 * Runs export steps that do not wait for one another several at a time.
 *
 * A range export encodes every clip outside the range as black frames with
 * its sound, one FFmpeg run each: on a film of two hundred clips that was two
 * hundred runs in a row for a two-second range, most of the time the export
 * took. They write separate files and read nothing of each other's.
 *
 * @module electron/claude/handlers/claude-export-handler/task-pool
 */

import os from "node:os";

/** How many FFmpeg runs of this kind go at once on this machine. */
export function independentStepLimit(): number {
	const cores =
		typeof os.availableParallelism === "function"
			? os.availableParallelism()
			: os.cpus().length;
	return Math.max(1, Math.min(8, cores));
}

/**
 * Runs `tasks`, at most `limit` at a time. After a failure no further task
 * is started; those already running are waited for, so nothing is still
 * writing when the caller cleans up, and the first failure is thrown.
 */
export async function runIndependently({
	tasks,
	limit = independentStepLimit(),
}: {
	tasks: Array<() => Promise<void>>;
	limit?: number;
}): Promise<void> {
	let next = 0;
	let failed = false;
	let failure: unknown;
	const worker = async (): Promise<void> => {
		while (!failed && next < tasks.length) {
			const task = tasks[next];
			next += 1;
			try {
				await task();
			} catch (error) {
				if (!failed) {
					failed = true;
					failure = error;
				}
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker)
	);
	if (failed) throw failure;
}
