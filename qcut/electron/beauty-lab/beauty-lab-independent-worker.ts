import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";

const gapSchema = z
	.object({ restartFrom: z.number().int().nonnegative() })
	.strict();
const replySchema = z.discriminatedUnion("ok", [
	z
		.object({
			id: z.string(),
			ok: z.literal(true),
			sequence: z
				.object({
					nextFrame: z.number().int().nonnegative(),
					resumed: z.string(),
				})
				.strict()
				.optional(),
		})
		.strict(),
	z
		.object({
			id: z.string(),
			ok: z.literal(false),
			error: z.string(),
			// A body-video frame whose history the worker lacks; the worker stays usable.
			gap: gapSchema.optional(),
		})
		.strict(),
]);
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_DIAGNOSTIC_BYTES = 256 * 1024;

interface WorkerRequest {
	image: string;
	request: string;
	output: string;
	report: string;
	source_evidence?: string;
	sequence?: {
		session: string;
		frame: number;
		timestamp: number;
		checkpoints: string;
	};
}

/**
 * The resident worker died under a request — killed from outside, out of
 * memory, a crash — rather than being stopped on purpose. A body-video
 * session can recover from this: the next request starts a fresh worker,
 * which lacks the session's history and answers with the frame to replay.
 */
export class IndependentWorkerExitedError extends Error {
	readonly exitCode: number | null;
	readonly signal: string | null;
	constructor({
		code,
		signal,
		diagnostic = "",
	}: {
		code: number | null;
		signal: string | null;
		diagnostic?: string;
	}) {
		const cause = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
		super(
			`Independent worker exited (${cause})${diagnostic ? `: ${diagnostic}` : ""}`
		);
		this.name = "IndependentWorkerExitedError";
		this.exitCode = code;
		this.signal = signal;
	}
}

/** A rendered job, or the frame a body-video session must replay from. */
export interface WorkerOutcome {
	gap?: { restartFrom: number };
}

interface RunningRequest {
	id: string;
	resolve: (outcome: WorkerOutcome) => void;
	reject: (error: Error) => void;
	cleanup: () => void;
}

interface WorkerState {
	child: ChildProcessWithoutNullStreams;
	identity: string;
	closed: Promise<void>;
	pending?: RunningRequest;
	failure?: Error;
	idle?: ReturnType<typeof setTimeout>;
}

/** Serial JSONL transport; failed or cancelled jobs discard the whole process tree. */
export function createIndependentBeautyWorker({
	python,
	engineRoot,
	runtimeRoot,
	idleMs = 60_000,
}: {
	python: string;
	engineRoot: string;
	runtimeRoot: string;
	idleMs?: number;
}) {
	let current: WorkerState | undefined;
	let disposed = false;
	let busy = false;

	function stop({ state, error }: { state: WorkerState; error: Error }) {
		state.failure ??= error;
		clearTimeout(state.idle);
		if (!state.child.pid) return;
		try {
			process.kill(-state.child.pid, "SIGKILL");
		} catch {
			state.child.kill("SIGKILL");
		}
	}

	function start({
		identity,
		environment,
	}: {
		identity: string;
		environment: NodeJS.ProcessEnv;
	}) {
		const child = spawn(
			python,
			[
				"-B",
				path.join(engineRoot, "research/independent_worker.py"),
				"--runtime",
				runtimeRoot,
			],
			{ cwd: engineRoot, env: environment, detached: true, stdio: "pipe" }
		);
		let close = () => {};
		const state: WorkerState = {
			child,
			identity,
			closed: new Promise<void>((resolve) => {
				close = resolve;
			}),
		};
		current = state;
		let stdout = "";
		let diagnostic = "";
		let diagnosticBytes = 0;
		const decoder = new StringDecoder("utf8");
		child.stdout.on("data", (data: Buffer) => {
			if (state.failure) return;
			stdout += decoder.write(data);
			if (Buffer.byteLength(stdout) > MAX_MESSAGE_BYTES) {
				stop({
					state,
					error: new Error("Independent worker response budget exceeded"),
				});
				return;
			}
			let newline = stdout.indexOf("\n");
			while (newline >= 0) {
				const line = stdout.slice(0, newline);
				stdout = stdout.slice(newline + 1);
				try {
					const reply = replySchema.parse(JSON.parse(line));
					const pending = state.pending;
					if (!pending || reply.id !== pending.id)
						throw new Error("Independent worker response identity mismatch");
					let outcome: WorkerOutcome;
					if (reply.ok) outcome = {};
					else if (reply.gap) outcome = { gap: reply.gap };
					else throw new Error(reply.error);
					state.pending = undefined;
					pending.cleanup();
					pending.resolve(outcome);
					diagnostic = "";
					diagnosticBytes = 0;
					state.idle = setTimeout(() => {
						stop({ state, error: new Error("Independent worker idle") });
					}, idleMs);
					state.idle.unref();
				} catch (error) {
					stop({
						state,
						error: error instanceof Error ? error : new Error(String(error)),
					});
					return;
				}
				newline = stdout.indexOf("\n");
			}
		});
		child.stderr.on("data", (data: Buffer) => {
			diagnosticBytes += data.byteLength;
			diagnostic = (diagnostic + data.toString("utf8")).slice(-2048);
			if (diagnosticBytes > MAX_DIAGNOSTIC_BYTES)
				stop({
					state,
					error: new Error("Independent worker diagnostic budget exceeded"),
				});
		});
		child.stdin.on("error", (error) => stop({ state, error }));
		child.on("error", (error) => stop({ state, error }));
		child.on("exit", (code, signal) => {
			// The parent can exit while a renderer still holds the group's pipes.
			// A stop() already names its reason; anything else died on its own.
			stop({
				state,
				error:
					state.failure ??
					new IndependentWorkerExitedError({
						code,
						signal,
						diagnostic: diagnostic.slice(-2048),
					}),
			});
		});
		child.on("close", (code, signal) => {
			clearTimeout(state.idle);
			if (current === state) current = undefined;
			const pending = state.pending;
			state.pending = undefined;
			pending?.cleanup();
			pending?.reject(
				state.failure ??
					new IndependentWorkerExitedError({
						code,
						signal,
						diagnostic: diagnostic.slice(-2048),
					})
			);
			close();
		});
		return state;
	}

	async function run({
		request,
		sourceIdentity,
		environment,
		signal,
		timeoutMs,
	}: {
		request: WorkerRequest;
		sourceIdentity: string;
		environment: NodeJS.ProcessEnv;
		signal: AbortSignal;
		timeoutMs: number;
	}): Promise<WorkerOutcome> {
		if (disposed || busy)
			throw new Error("Independent worker busy or disposed");
		signal.throwIfAborted();
		const id = randomUUID();
		const message = `${JSON.stringify({ id, ...request })}\n`;
		if (Buffer.byteLength(message) > MAX_MESSAGE_BYTES)
			throw new Error("Independent worker request budget exceeded");
		busy = true;
		try {
			const identity = JSON.stringify([sourceIdentity, environment]);
			if (current && (current.failure || current.identity !== identity)) {
				stop({
					state: current,
					error: new Error("Independent worker environment changed"),
				});
				await current.closed;
			}
			signal.throwIfAborted();
			if (disposed) throw new Error("Independent worker disposed");
			const state = current ?? start({ identity, environment });
			clearTimeout(state.idle);
			return await new Promise<WorkerOutcome>((resolve, reject) => {
				const abort = () =>
					stop({ state, error: new Error("Independent beauty cancelled") });
				const timer = setTimeout(() => {
					stop({ state, error: new Error("Independent beauty timed out") });
				}, timeoutMs);
				state.pending = {
					id,
					resolve,
					reject,
					cleanup: () => {
						clearTimeout(timer);
						signal.removeEventListener("abort", abort);
					},
				};
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
				else state.child.stdin.write(message);
			});
		} finally {
			busy = false;
		}
	}

	async function dispose() {
		disposed = true;
		if (!current) return;
		const state = current;
		stop({ state, error: new Error("Independent worker disposed") });
		await state.closed;
	}

	return { run, dispose };
}
