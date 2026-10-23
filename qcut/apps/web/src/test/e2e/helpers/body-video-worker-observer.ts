import { type ElectronApplication, expect } from "@playwright/test";
import type { Readable, Writable } from "node:stream";

import type {
	PendingBodyFrame,
	SequenceIpcRequest,
	CancelObservation,
	WorkerObservation,
	ObserverGlobal,
} from "./body-video-worker-types";

/** Observes the unchanged worker JSONL transport; no production render hooks. */
export async function installBodyWorkerObserver({
	app,
	output,
}: {
	app: ElectronApplication;
	output?: string;
}) {
	await app.evaluate(({ ipcMain }, output) => {
		const { ChildProcess } = process.getBuiltinModule("node:child_process");
		const fs = process.getBuiltinModule("node:fs");
		const path = process.getBuiltinModule("node:path");
		const { createHash } = process.getBuiltinModule("node:crypto");
		if (output) fs.mkdirSync(output, { recursive: true });
		const target = globalThis as unknown as ObserverGlobal;
		if (target.__bodyWorkerObservation)
			throw new Error("Body worker observer already installed");
		const observation: WorkerObservation = {
			pending: [],
			workerHistory: [],
			completed: 0,
			spawned: [],
			exited: [],
			sequenceRequests: [],
			sequenceHistory: [],
			cancellations: [],
			evidenceErrors: [],
			executions: [],
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
				sequence: {
					frame: number;
					clip: string;
					fps: number;
					replay: boolean;
					sourceTimestampSeconds?: number;
				};
				adjustments?: {
					bodyVideoProfile?: string;
					values?: Record<string, number>;
				};
			};
			const started = performance.now();
			const pending: SequenceIpcRequest = {
				requestId: input.requestId,
				frame: input.sequence.frame,
				clip: input.sequence.clip,
				fps: input.sequence.fps,
				sourceTimestampSeconds: input.sequence.sourceTimestampSeconds,
				replay: input.sequence.replay,
				profile: input.adjustments?.bodyVideoProfile,
				values: input.adjustments?.values
					? { ...input.adjustments.values }
					: undefined,
				enteredAt: Date.now(),
				status: "pending",
				sessions: [],
				workerRequestIds: [],
			};
			observation.sequenceRequests.push(pending);
			observation.sequenceHistory.push(pending);
			const remove = () => {
				pending.completedAt = Date.now();
				pending.elapsedMs = performance.now() - started;
				observation.sequenceRequests = observation.sequenceRequests.filter(
					(item) => item !== pending
				);
			};
			const rejected = (error: unknown) => {
				pending.status = "rejected";
				pending.error = error instanceof Error ? error.message : String(error);
				remove();
			};
			try {
				const result = sequenceHandler(event, request);
				void Promise.resolve(result).then((value: unknown) => {
					pending.status = "completed";
					const receipt = value as SequenceIpcRequest["result"];
					if (receipt && typeof receipt === "object")
						pending.result = {
							status: receipt.status,
							cached: receipt.cached,
							from: receipt.from,
						};
					remove();
				}, rejected);
				return result;
			} catch (error) {
				rejected(error);
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
			const started = new Map<string, number>();
			const write = this.stdin._write;
			this.stdin._write = function (chunk, encoding, callback) {
				const text = Buffer.isBuffer(chunk)
					? chunk.toString("utf8")
					: String(chunk);
				for (const line of text.split("\n").filter(Boolean)) {
					const request = JSON.parse(line) as {
						id: string;
						outerRequestId?: string;
						report?: string;
						sequence?: PendingBodyFrame["sequence"];
					};
					if (request.sequence) {
						const owners = observation.sequenceHistory.filter(
							(item) => item.requestId === request.outerRequestId
						);
						const owner = owners.length === 1 ? owners[0] : undefined;
						const validOwner =
							owner?.frame === request.sequence.frame &&
							(owner.sourceTimestampSeconds === undefined ||
								owner.sourceTimestampSeconds === request.sequence.timestamp);
						if (request.outerRequestId !== undefined && !validOwner)
							observation.evidenceErrors.push(
								`Worker outer request identity mismatch: ${request.id}`
							);
						if (validOwner && owner) {
							owner.workerRequestIds.push(request.id);
							if (!owner.sessions.includes(request.sequence.session))
								owner.sessions.push(request.sequence.session);
						}
						const pending: PendingBodyFrame = {
							pid,
							id: request.id,
							frame: request.sequence.frame,
							startedAt: Date.now(),
							outerRequestId: request.outerRequestId,
							association:
								request.outerRequestId === undefined
									? "unavailable"
									: validOwner
										? "transport-id"
										: "invalid-transport-id",
							sequence: { ...request.sequence },
							...(output ? { report: request.report } : {}),
						};
						started.set(request.id, performance.now());
						observation.pending.push(pending);
						observation.workerHistory.push(pending);
					}
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
						gap?: { restartFrom: number };
						error?: string;
					};
					const matching = observation.pending.find(
						(request) => request.pid === pid && request.id === reply.id
					);
					if (matching) {
						matching.completedAt = Date.now();
						matching.elapsedMs =
							performance.now() - (started.get(reply.id) ?? performance.now());
						matching.outcome = reply.ok ? "ok" : reply.gap ? "gap" : "error";
						matching.restartFrom = reply.gap?.restartFrom;
						matching.error = reply.error;
						started.delete(reply.id);
					}
					if (matching && reply.ok) {
						observation.completed += 1;
						if (output && matching.report) {
							try {
								// Copy before the provider removes its successful job directory.
								if (fs.statSync(matching.report).size > 16 * 1024 ** 2)
									throw new Error("Observed body report exceeds its budget");
								const bytes = fs.readFileSync(matching.report);
								const report = JSON.parse(bytes.toString("utf8")) as {
									stages?: Array<{
										script: string;
										receipt: {
											executionIdentity?: {
												profile?: string;
												generation?: string;
											};
											executionRoutes?: Array<{
												network: string;
												backend: string;
											}>;
										};
									}>;
								};
								const body = report.stages?.find(
									(stage) => stage.script === "body_smart_render.py"
								)?.receipt;
								if (!body)
									throw new Error(
										"Observed sequence report lacks the body stage"
									);
								if (!/^[a-zA-Z0-9-]+$/.test(matching.id))
									throw new Error("Invalid observed job id");
								const file = path.join(output, `${pid}-${matching.id}.json`);
								fs.writeFileSync(file, bytes, { flag: "wx" });
								observation.executions.push({
									pid,
									frame: matching.frame,
									outerRequestId: matching.outerRequestId,
									workerRequestId: matching.id,
									sequence: matching.sequence,
									receivedAt: Date.now(),
									file,
									sha256: createHash("sha256").update(bytes).digest("hex"),
									profile: body.executionIdentity?.profile,
									generation: body.executionIdentity?.generation,
									routes: body.executionRoutes ?? [],
								});
							} catch (error) {
								observation.evidenceErrors.push(String(error));
							}
						}
						if (reply.sequence && reply.sequence.resumed !== "continued")
							observation.resumptions.push({
								pid,
								frame: matching.frame,
								outerRequestId: matching.outerRequestId,
								workerRequestId: matching.id,
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
				for (const pending of observation.pending.filter(
					(item) => item.pid === pid
				)) {
					pending.completedAt = Date.now();
					pending.elapsedMs =
						performance.now() - (started.get(pending.id) ?? performance.now());
					pending.outcome = "exit";
				}
				observation.pending = observation.pending.filter(
					(request) => request.pid !== pid
				);
			});
			return result;
		};
	}, output);
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
	minimumPendingMs = 200,
}: {
	app: ElectronApplication;
	minimumFrame: number;
	kill?: boolean;
	minimumPendingMs?: number;
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
								Date.now() - request.startedAt >= options.minimumPendingMs
						);
						if (!pending) return;
						if (options.kill) process.kill(pending.pid, "SIGKILL");
						return pending;
					},
					{ minimumFrame, kill, minimumPendingMs }
				);
				return Boolean(selected);
			},
			{ timeout: 600_000, intervals: [50, 100] }
		)
		.toBe(true);
	if (!selected) throw new Error("No in-flight body request observed");
	return selected;
}
