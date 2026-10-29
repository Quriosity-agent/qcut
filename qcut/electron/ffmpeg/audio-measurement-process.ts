import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const MAX_OUTPUT_BYTES = 128 * 1024;
const STREAMED_TAIL_CHARS = 2000;

/**
 * With `onStderrLine`, stderr goes to it line by line and is not kept, so a
 * meter may log every block of a long file; the result's `stderr` is then
 * only its last 2000 characters.
 */
export function runAudioMeasurementProcess({
	command,
	args,
	signal,
	timeout,
	onStderrLine,
}: {
	command: string;
	args: string[];
	timeout: number;
	signal?: AbortSignal;
	onStderrLine?: (line: string) => void;
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
		const decoder = new StringDecoder("utf8");
		let partialLine = "";
		let streamedTail = "";
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
		const stream = ({ text }: { text: string }) => {
			if (stopped || !onStderrLine) return;
			streamedTail = (streamedTail + text).slice(-STREAMED_TAIL_CHARS);
			const lines = (partialLine + text).split(/\r?\n/);
			partialLine = lines.pop() ?? "";
			try {
				for (const line of lines) onStderrLine(line);
			} catch (error) {
				stop({ error });
			}
		};
		const onStdout = (chunk: Buffer) => collect({ chunks: stdout, chunk });
		const onStderr = (chunk: Buffer) =>
			onStderrLine
				? stream({ text: decoder.write(chunk) })
				: collect({ chunks: stderr, chunk });
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
			if (onStderrLine) stream({ text: `${decoder.end()}\n` });
			// Abort/error can precede close; the exporter must retain its file until exit.
			if (stopped) {
				reject(failure);
				return;
			}
			const output = {
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: onStderrLine
					? streamedTail
					: Buffer.concat(stderr).toString("utf8"),
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
