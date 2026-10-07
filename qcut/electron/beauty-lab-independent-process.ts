import { spawn } from "node:child_process";

export function runIndependentBeautyJob({
	python,
	args,
	cwd,
	environment,
	signal,
	timeoutMs,
}: {
	python: string;
	args: string[];
	cwd: string;
	environment: NodeJS.ProcessEnv;
	signal: AbortSignal;
	timeoutMs: number;
}): Promise<void> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(python, args, {
			cwd,
			env: environment,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let diagnostic = "";
		let failure: Error | undefined;
		function stop({ error }: { error: Error }) {
			failure ??= error;
			if (child.pid) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {
					child.kill("SIGKILL");
				}
			}
		}
		const abort = () =>
			stop({ error: new Error("Independent beauty cancelled") });
		const timer = setTimeout(
			() => stop({ error: new Error("Independent beauty timed out") }),
			timeoutMs
		);
		signal.addEventListener("abort", abort, { once: true });
		child.stderr.on("data", (data: Buffer) => {
			if (Buffer.byteLength(diagnostic) + data.byteLength > 256 * 1024) {
				stop({
					error: new Error("Independent worker diagnostic budget exceeded"),
				});
				return;
			}
			diagnostic += data.toString();
		});
		child.stdout.resume();
		child.on("error", (error) => {
			failure ??= error;
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			if (failure || code !== 0) {
				reject(
					failure ??
						new Error(
							`Independent worker failed (${code}): ${diagnostic.slice(-2048)}`
						)
				);
				return;
			}
			resolve();
		});
		if (signal.aborted) abort();
	});
}
