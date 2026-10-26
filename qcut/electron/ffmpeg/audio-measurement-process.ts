import { spawn } from "node:child_process";

const MAX_OUTPUT_BYTES = 128 * 1024;

export function runAudioMeasurementProcess({
	command,
	args,
	signal,
	timeout,
}: {
	command: string;
	args: string[];
	timeout: number;
	signal?: AbortSignal;
}): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const child = spawn(command, args, {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let outputBytes = 0;
		let stopped = false;
		let failure: unknown;

		const stop = ({ error }: { error: unknown }) => {
			if (stopped) return;
			stopped = true;
			failure = error;
			child.kill("SIGKILL");
		};
		const collect = ({
			chunks,
			chunk,
		}: {
			chunks: Buffer[];
			chunk: Buffer;
		}) => {
			if (stopped) return;
			outputBytes += chunk.length;
			if (outputBytes > MAX_OUTPUT_BYTES) {
				stop({ error: new Error("Audio measurement output exceeded 128 KiB") });
				return;
			}
			chunks.push(chunk);
		};
		const onStdout = (chunk: Buffer) => collect({ chunks: stdout, chunk });
		const onStderr = (chunk: Buffer) => collect({ chunks: stderr, chunk });
		const onAbort = () => stop({ error: signal?.reason });
		const onError = (error: Error) => stop({ error });
		const timer = setTimeout(
			() => stop({ error: new Error("Audio measurement timed out") }),
			timeout
		);

		child.stdout.on("data", onStdout);
		child.stderr.on("data", onStderr);
		child.once("error", onError);
		child.once("close", (code, terminationSignal) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			child.stdout.removeListener("data", onStdout);
			child.stderr.removeListener("data", onStderr);
			child.removeListener("error", onError);
			// Abort/error can precede close; the exporter must retain its file until exit.
			if (stopped) {
				reject(failure);
				return;
			}
			const output = {
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			};
			if (code !== 0) {
				reject(
					new Error(
						`Audio measurement exited with ${terminationSignal ?? `code ${code}`}: ${output.stderr.slice(-2000)}`
					)
				);
				return;
			}
			resolve(output);
		});
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
	});
}
