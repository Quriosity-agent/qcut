import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { inspectIndependentCoreML } from "./beauty-lab-independent-coreml.js";
import { waitForFrameOperation } from "./beauty-lab-independent-frames.js";
import { createIndependentBeautyWorker } from "./beauty-lab-independent-worker.js";

/** Reuses the interpreter; every request still validates the current resource bytes. */
export function createIndependentCoreMLInspector({
	python,
	engineRoot,
	runtimeRoot,
	createWorker = createIndependentBeautyWorker,
}: {
	python: string;
	engineRoot: string;
	runtimeRoot: string;
	createWorker?: typeof createIndependentBeautyWorker;
}) {
	const worker = createWorker({
		python,
		engineRoot,
		runtimeRoot,
		script: "body_coreml_capability_worker.py",
	});
	let tail = Promise.resolve();
	let disposed = false;

	async function inspect({
		sourceIdentity,
		signal = new AbortController().signal,
		...options
	}: Pick<
		Parameters<typeof inspectIndependentCoreML>[0],
		"environment" | "platform" | "signal"
	> & {
		sourceIdentity: string;
	}) {
		if (disposed) throw new Error("CoreML capability inspector disposed");
		return inspectIndependentCoreML({
			...options,
			python,
			engineRoot,
			runtimeRoot,
			signal,
			runJob: async ({ args, environment, timeoutMs }) => {
				let started = false;
				const operation = tail.then(async () => {
					signal.throwIfAborted();
					if (disposed) throw new Error("CoreML capability inspector disposed");
					const executable = await realpath(python);
					const executableSha256 = createHash("sha256")
						.update(await readFile(executable))
						.digest("hex");
					signal.throwIfAborted();
					const report = args[args.indexOf("--output") + 1];
					if (!args.includes("--output") || !report)
						throw new Error("CoreML capability output path required");
					started = true;
					await worker.run({
						request: { report },
						sourceIdentity: JSON.stringify([
							sourceIdentity,
							executable,
							executableSha256,
						]),
						environment,
						signal,
						timeoutMs,
					});
				});
				tail = operation.then(
					() => {},
					() => {}
				);
				try {
					await waitForFrameOperation({ signal, operation: () => operation });
				} finally {
					// A running child must close before its private report directory goes away.
					if (started) await operation.catch(() => {});
				}
			},
		});
	}

	async function dispose() {
		disposed = true;
		await worker.dispose();
		await tail;
	}

	return { inspect, dispose };
}
