import { type ElectronApplication, expect } from "@playwright/test";
import type { Readable, Writable } from "node:stream";

interface PendingBodyFrame {
	pid: number;
	id: string;
	frame: number;
	startedAt: number;
}

interface SequenceIpcRequest {
	requestId: string;
	frame: number;
	enteredAt: number;
}

interface CancelObservation {
	requestId: string;
	enteredAt: number;
	sequenceRequest?: SequenceIpcRequest;
	activeSequenceRequests: SequenceIpcRequest[];
	pending: PendingBodyFrame[];
	cancelled?: boolean;
}

interface WorkerObservation {
	pending: PendingBodyFrame[];
	completed: number;
	spawned: number[];
	exited: number[];
	sequenceRequests: SequenceIpcRequest[];
	cancellations: CancelObservation[];
	resumptions: Array<{
		pid: number;
		frame: number;
		resumed: string;
		receivedAt: number;
	}>;
}

interface ObserverGlobal {
	__bodyWorkerObservation?: WorkerObservation;
}

/** Observes the unchanged worker JSONL transport; no production render hooks. */
export async function installBodyWorkerObserver({
	app,
}: {
	app: ElectronApplication;
}) {
	await app.evaluate(({ ipcMain }) => {
		const { ChildProcess } = process.getBuiltinModule("node:child_process");
		const target = globalThis as unknown as ObserverGlobal;
		if (target.__bodyWorkerObservation)
			throw new Error("Body worker observer already installed");
		const observation: WorkerObservation = {
			pending: [],
			completed: 0,
			spawned: [],
			exited: [],
			sequenceRequests: [],
			cancellations: [],
			resumptions: [],
		};
		target.__bodyWorkerObservation = observation;
		// Electron exposes no getter for invoke handlers; fail if its test transport changes.
		type InvokeHandler = (event: unknown, request: unknown) => unknown;
		const handlers = (
			ipcMain as unknown as { _invokeHandlers: Map<string, InvokeHandler> }
		)._invokeHandlers;
		const sequenceChannel = "beauty-lab:render-independent-sequence-frame";
		const cancelChannel = "beauty-lab:cancel-independent";
		const sequenceHandler = handlers?.get(sequenceChannel);
		const cancelHandler = handlers?.get(cancelChannel);
		if (!sequenceHandler || !cancelHandler)
			throw new Error("Body IPC handlers unavailable to observer");
		handlers.set(sequenceChannel, (event, request) => {
			const input = request as {
				requestId: string;
				sequence: { frame: number };
			};
			const pending: SequenceIpcRequest = {
				requestId: input.requestId,
				frame: input.sequence.frame,
				enteredAt: Date.now(),
			};
			observation.sequenceRequests.push(pending);
			const remove = () => {
				observation.sequenceRequests = observation.sequenceRequests.filter(
					(item) => item !== pending
				);
			};
			try {
				const result = sequenceHandler(event, request);
				void Promise.resolve(result).then(remove, remove);
				return result;
			} catch (error) {
				remove();
				throw error;
			}
		});
		handlers.set(cancelChannel, (event, request) => {
			const { requestId } = request as { requestId: string };
			const entry: CancelObservation = {
				requestId,
				enteredAt: Date.now(),
				sequenceRequest: observation.sequenceRequests.find(
					(item) => item.requestId === requestId
				),
				activeSequenceRequests: observation.sequenceRequests.map((item) => ({
					...item,
				})),
				pending: observation.pending.map((item) => ({ ...item })),
			};
			observation.cancellations.push(entry);
			const result = cancelHandler(event, request);
			if (result && typeof result === "object" && "cancelled" in result)
				entry.cancelled = result.cancelled === true;
			return result;
		});
		interface ObservedChild {
			pid?: number;
			stdin: Writable;
			stdout: Readable;
			once: (event: string, callback: () => void) => void;
			spawn: (options: { args?: string[] }) => unknown;
		}
		const prototype = ChildProcess.prototype as unknown as ObservedChild;
		const spawn = prototype.spawn;
		prototype.spawn = function (options) {
			const result = spawn.call(this, options);
			if (
				!options.args?.some((argument) =>
					argument.endsWith("/independent_worker.py")
				)
			)
				return result;
			const pid = this.pid;
			if (!pid) throw new Error("Observed body worker has no PID");
			observation.spawned.push(pid);
			const write = this.stdin._write;
			this.stdin._write = function (chunk, encoding, callback) {
				const text = Buffer.isBuffer(chunk)
					? chunk.toString("utf8")
					: String(chunk);
				for (const line of text.split("\n").filter(Boolean)) {
					const request = JSON.parse(line) as {
						id: string;
						sequence?: { frame: number };
					};
					if (request.sequence)
						observation.pending.push({
							pid,
							id: request.id,
							frame: request.sequence.frame,
							startedAt: Date.now(),
						});
				}
				write.call(this, chunk, encoding, callback);
			};
			let stdout = "";
			this.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString("utf8");
				let newline = stdout.indexOf("\n");
				while (newline >= 0) {
					const line = stdout.slice(0, newline);
					stdout = stdout.slice(newline + 1);
					const reply = JSON.parse(line) as {
						id: string;
						ok: boolean;
						sequence?: { resumed: string };
					};
					const matching = observation.pending.find(
						(request) => request.pid === pid && request.id === reply.id
					);
					if (matching && reply.ok) {
						observation.completed += 1;
						if (reply.sequence && reply.sequence.resumed !== "continued")
							observation.resumptions.push({
								pid,
								frame: matching.frame,
								resumed: reply.sequence.resumed,
								receivedAt: Date.now(),
							});
					}
					observation.pending = observation.pending.filter(
						(request) => request.pid !== pid || request.id !== reply.id
					);
					newline = stdout.indexOf("\n");
				}
			});
			this.once("exit", () => {
				observation.exited.push(pid);
				observation.pending = observation.pending.filter(
					(request) => request.pid !== pid
				);
			});
			return result;
		};
	});
}

export async function readBodyWorkerObservation({
	app,
}: {
	app: ElectronApplication;
}) {
	return app.evaluate(() => {
		const observation = (globalThis as unknown as ObserverGlobal)
			.__bodyWorkerObservation;
		if (!observation) throw new Error("Missing body worker observer");
		return observation;
	});
}

/** Kill and snapshot happen in one main-process turn, while this request is pending. */
export async function waitForInFlightBodyFrame({
	app,
	minimumFrame,
	kill = false,
}: {
	app: ElectronApplication;
	minimumFrame: number;
	kill?: boolean;
}): Promise<PendingBodyFrame> {
	let selected: PendingBodyFrame | undefined;
	await expect
		.poll(
			async () => {
				selected = await app.evaluate(
					(_electron, options) => {
						const observation = (globalThis as unknown as ObserverGlobal)
							.__bodyWorkerObservation;
						const pending = observation?.pending.find(
							(request) =>
								request.frame >= options.minimumFrame &&
								Date.now() - request.startedAt >= 200
						);
						if (!pending) return;
						if (options.kill) process.kill(pending.pid, "SIGKILL");
						return pending;
					},
					{ minimumFrame, kill }
				);
				return Boolean(selected);
			},
			{ timeout: 600_000, intervals: [50, 100] }
		)
		.toBe(true);
	if (!selected) throw new Error("No in-flight body request observed");
	return selected;
}
