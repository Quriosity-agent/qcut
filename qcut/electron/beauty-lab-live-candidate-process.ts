import { spawn } from "node:child_process";

const OUTPUT_LIMIT = 1024 * 1024;
const JOB_TIMEOUT_MS = 300_000;
const CLEANUP_GRACE_MS = 30_000;

export async function runBeautyLabLiveCandidateJob({
	python,
	args,
	cwd,
	signal,
}: {
	python: string;
	args: string[];
	cwd: string;
	signal?: AbortSignal;
}): Promise<void> {
	if (signal?.aborted) throw new Error("Live candidate job cancelled");
	const env: NodeJS.ProcessEnv = { PYTHONDONTWRITEBYTECODE: "1" };
	for (const key of [
		"HOME",
		"PATH",
		"TMPDIR",
		"USER",
		"LOGNAME",
		"LANG",
		"LC_ALL",
		"LC_CTYPE",
	]) {
		if (process.env[key] !== undefined) env[key] = process.env[key];
	}
	await new Promise<void>((resolve, reject) => {
		const child = spawn(python, args, {
			cwd,
			env,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let failure: Error | undefined;
		let received = 0;
		let grace: ReturnType<typeof setTimeout> | undefined;
		const stop = ({ error }: { error: Error }) => {
			if (failure) return;
			failure = error;
			// Python's SIGTERM handler runs its identity-bound native ProcessScope cleanup.
			child.kill("SIGTERM");
			grace = setTimeout(() => {
				failure = new Error(
					`${error.message}; Python cleanup deadline exceeded`
				);
				child.kill("SIGKILL");
			}, CLEANUP_GRACE_MS);
		};
		const timer = setTimeout(
			() => stop({ error: new Error("Live candidate job timed out") }),
			JOB_TIMEOUT_MS
		);
		const cancel = () =>
			stop({ error: new Error("Live candidate job cancelled") });
		const consume = (data: Buffer) => {
			received += data.byteLength;
			if (received > OUTPUT_LIMIT)
				stop({
					error: new Error("Live candidate process output exceeded budget"),
				});
		};
		child.stdout.on("data", consume);
		child.stderr.on("data", consume);
		child.once("error", (error) => {
			failure = error;
		});
		child.once("close", (code, exitSignal) => {
			clearTimeout(timer);
			if (grace) clearTimeout(grace);
			signal?.removeEventListener("abort", cancel);
			if (failure) {
				reject(failure);
				return;
			}
			if (code !== 0 || exitSignal) {
				reject(new Error(`Live candidate job failed (${code ?? exitSignal})`));
				return;
			}
			resolve();
		});
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) cancel();
	});
}
