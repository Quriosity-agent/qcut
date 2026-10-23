import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
	INDEPENDENT_BEAUTY_MAX_PIXELS,
	type BeautyLabIndependentResult,
	type BeautyLabIndependentSequenceFrameResult,
} from "./beauty-lab-independent-contract.js";
import {
	type createIndependentFrameCache,
	independentFrameCacheKey,
} from "./beauty-lab-independent-frame-cache.js";
import {
	independentFrameRequestShape,
	INDEPENDENT_TIMELINE_SOURCE_KEY,
	waitForFrameOperation,
} from "./beauty-lab-independent-frames.js";
import { canonicalIndependentManualBody } from "./beauty-lab-independent-manual-body.js";
import { createCoreMLHistoryGuard } from "./beauty-lab-independent-coreml-history.js";
import { INDEPENDENT_COREML_PROFILE } from "./beauty-lab-independent-coreml.js";
import { createIndependentKeyedQueue } from "./beauty-lab-independent-keyed-queue.js";
import { IndependentWorkerExitedError } from "./beauty-lab-independent-worker.js";

/**
 * The engine's video face profile loads this runtime asset and pins its hash
 * (research/body_face_policy.py). Without it a clip's body edits render frame
 * by frame as photos; with it they follow the clip's history.
 */
export const INDEPENDENT_BODY_VIDEO_POLICY = {
	file: "research/body-face-video-policy-v1.json",
	sha256: "b5b9905399fac944db0ac036260fe6916b84a314f6eb69eec5555c2358b0a91b",
};
export const INDEPENDENT_SESSIONS_MAX_BYTES = 2 * 1024 ** 3;
const PRUNE_INTERVAL_MS = 60_000;

/**
 * Drops the least recently used session folders until the checkpoint store
 * fits `maxBytes`, keeping `active`. CoreML route journals are replay state,
 * not disposable cache: only their snapshots can be evicted. Retained journals
 * may exceed the cache budget; replay must never invent a second route history.
 */
export async function pruneIndependentSessions({
	directory,
	maxBytes,
	active,
}: {
	directory: string;
	maxBytes: number;
	active?: string;
}) {
	const names = await readdir(directory).catch(() => [] as string[]);
	const folders = await Promise.all(
		names
			.filter((name) => /^[a-f0-9]{64}$/.test(name))
			.map(async (name) => {
				const folder = path.join(directory, name);
				const files = await readdir(folder).catch(() => [] as string[]);
				const metadata = await Promise.all(
					files.map((file) => stat(path.join(folder, file)).catch(() => null))
				);
				const bytes = metadata.reduce(
					(sum, file) => sum + (file?.isFile() ? file.size : 0),
					0
				);
				const usedAt = metadata.reduce(
					(latest, file) => Math.max(latest, file?.isFile() ? file.mtimeMs : 0),
					0
				);
				return { name, folder, bytes, usedAt };
			})
	);
	let total = folders.reduce((sum, folder) => sum + folder.bytes, 0);
	const removed: string[] = [];
	await folders
		.sort((left, right) => left.usedAt - right.usedAt)
		.reduce<Promise<void>>(async (previous, folder) => {
			await previous;
			if (total <= maxBytes || folder.name === active) return;
			const journal = path.join(folder.folder, "execution-routes-v1.json");
			if (
				await stat(journal).then(
					() => true,
					() => false
				)
			) {
				const snapshots = (await readdir(folder.folder)).filter((file) =>
					/^\d{10}\.snapshot$/.test(file)
				);
				const reclaimed = await Promise.all(
					snapshots.map(async (file) => {
						const target = path.join(folder.folder, file);
						const metadata = await stat(target).catch(() => null);
						if (!metadata?.isFile()) return 0;
						await rm(target, { force: true });
						return metadata.size;
					})
				);
				total -= reclaimed.reduce((bytes, size) => bytes + size, 0);
				return;
			}
			await rm(folder.folder, { recursive: true, force: true });
			total -= folder.bytes;
			removed.push(folder.name);
		}, Promise.resolve());
	if (total > maxBytes)
		console.warn(
			"[independent-beauty] Session checkpoint budget remains exceeded; active checkpoints and completed CoreML route journals are retained for deterministic replay",
			{ total, maxBytes }
		);
	return { total, removed };
}

export async function independentBodyVideoAvailable({
	runtimeRoot,
}: {
	runtimeRoot: string;
}) {
	try {
		const bytes = await readFile(
			path.join(runtimeRoot, INDEPENDENT_BODY_VIDEO_POLICY.file)
		);
		return (
			createHash("sha256").update(bytes).digest("hex") ===
			INDEPENDENT_BODY_VIDEO_POLICY.sha256
		);
	} catch {
		return false;
	}
}

/** The worker's history of the session stops before the requested frame. */
export class IndependentSequenceGapError extends Error {
	readonly restartFrom: number;
	constructor({ restartFrom }: { restartFrom: number }) {
		super(`Independent body video history resumes at frame ${restartFrom}`);
		this.name = "IndependentSequenceGapError";
		this.restartFrom = restartFrom;
	}
}

export const independentSequenceSchema = z
	.object({
		clip: z.string().regex(/^[a-f0-9]{64}$/),
		frame: z
			.number()
			.int()
			.min(0)
			.max(2 ** 31 - 1),
		// The legacy warm profile derives its clock from FPS; CoreML uses source PTS.
		fps: z.number().finite().min(10).max(240),
		sourceTimestampSeconds: z.number().finite().nonnegative().optional(),
		replay: z.boolean(),
	})
	.strict();

const sequenceFrameRequestSchema = independentFrameRequestShape
	.extend({
		// Body history is the clip's own; neighbour evidence for face selection is not used.
		sourceEvidence: z.undefined(),
		sequence: independentSequenceSchema,
	})
	.strict()
	.refine(
		({ width, height }) => width * height <= INDEPENDENT_BEAUTY_MAX_PIXELS,
		"Independent frame exceeds the pixel budget"
	);

/**
 * Names one clip's body-video session: the engine build, the clip (its
 * source, timing and the edit as the clip defines it, keyframes included) and
 * the frame size. Frame k of a session has one history wherever the clip sits
 * on the timeline, so the same cache entries and checkpoints serve a moved
 * clip; the values a frame renders with stay in the frame's cache key.
 */
export function independentBodyVideoSession({
	engineSha256,
	clip,
	width,
	height,
	execution,
}: {
	engineSha256: string;
	clip: string;
	width: number;
	height: number;
	execution?: { profile: "swing-coreml-v1"; fps: number };
}) {
	return createHash("sha256")
		.update(
			JSON.stringify({
				schemaVersion: 1,
				engineSha256,
				clip,
				width,
				height,
				...(execution
					? { execution: { ...execution, clock: "decoded-source-pts-v1" } }
					: {}),
			})
		)
		.digest("hex");
}

/**
 * Renders one frame of a clip's body-video session. A frame whose history the
 * worker does not hold comes back as "replay" naming the frame to resume
 * from; the caller then submits those frames with `replay` set, which skips
 * the cache so the worker advances, and asks for the frame again. Rendered
 * frames land in the frame cache under the session and frame index, so a
 * paused preview and an export of the same clip read the same pixels.
 */
export function createIndependentSequenceFrameRenderer({
	provider,
	cache,
	engineSha256,
	resolveCoreML,
	sessionsDirectory,
	maxSessionBytes = INDEPENDENT_SESSIONS_MAX_BYTES,
	now = Date.now,
}: {
	provider: {
		render: (input: {
			request: unknown;
		}) => Promise<BeautyLabIndependentResult>;
		cancel?: (input: { request: { requestId: string } }) => unknown;
	};
	cache: Pick<ReturnType<typeof createIndependentFrameCache>, "read" | "write">;
	engineSha256: () => Promise<string>;
	resolveCoreML?: (input: { signal: AbortSignal }) => Promise<{
		engineSha256: string;
		identitySha256: string;
		execution: Record<string, unknown>;
	}>;
	/** Each session keeps its on-disk checkpoints in `<sessionsDirectory>/<session>`. */
	sessionsDirectory: string;
	maxSessionBytes?: number;
	now?: () => number;
}) {
	if (!path.isAbsolute(sessionsDirectory))
		throw new Error("Independent session checkpoints need an absolute folder");
	const pending = new Map<string, AbortController>();
	const frameQueue = createIndependentKeyedQueue();
	const coremlRequests = new Set<string>();
	let disposed = false;
	let prunedAt = Number.NEGATIVE_INFINITY;
	let pruning: Promise<unknown> = Promise.resolve();
	function prune({ active }: { active: string }) {
		if (now() - prunedAt < PRUNE_INTERVAL_MS) return pruning;
		prunedAt = now();
		pruning = pruneIndependentSessions({
			directory: sessionsDirectory,
			maxBytes: maxSessionBytes,
			active,
		}).catch((error: unknown) => {
			console.warn("[independent-beauty] Session prune failed:", error);
		});
		return pruning;
	}
	async function render({
		request,
	}: {
		request: unknown;
	}): Promise<BeautyLabIndependentSequenceFrameResult> {
		if (disposed) throw new Error("Independent sequence renderer disposed");
		const parsed = sequenceFrameRequestSchema.parse(request);
		if (
			parsed.rgba.buffer instanceof SharedArrayBuffer ||
			parsed.rgba.length !== parsed.width * parsed.height * 4
		)
			throw new Error("Invalid independent frame RGBA");
		const { sequence, sourceEvidence: _evidence, ...frame } = parsed;
		const input = {
			...frame,
			rgba: new Uint8Array(parsed.rgba),
			adjustments: structuredClone(parsed.adjustments),
		};
		const { requestId, width, height } = input;
		if (pending.has(requestId))
			throw new Error("Duplicate independent sequence request id");
		const controller = new AbortController();
		pending.set(requestId, controller);
		const { signal } = controller;
		const profiled =
			input.adjustments.bodyVideoProfile === INDEPENDENT_COREML_PROFILE;
		if (profiled) coremlRequests.add(requestId);
		async function renderFrame(): Promise<BeautyLabIndependentSequenceFrameResult> {
			const profile =
				profiled && resolveCoreML
					? await waitForFrameOperation({
							signal,
							operation: () => resolveCoreML({ signal }),
						})
					: undefined;
			const engine =
				profile?.engineSha256 ??
				(await waitForFrameOperation({
					signal,
					operation: engineSha256,
				}));
			const manualBody = canonicalIndependentManualBody({
				manualBody: input.adjustments.manualBody,
			});
			const edit = {
				width,
				height,
				values: input.adjustments.values,
				makeup: input.adjustments.makeup ?? {},
				manualBody,
			};
			const session = independentBodyVideoSession({
				engineSha256: engine,
				clip: sequence.clip,
				...(profile
					? {
							execution: {
								profile: INDEPENDENT_COREML_PROFILE,
								fps: sequence.fps,
							},
						}
					: {}),
				width,
				height,
			});
			const history = profile
				? createCoreMLHistoryGuard({
						sessionsDirectory,
						session,
						resourceIdentitySha256: profile.identitySha256,
						execution: profile.execution,
					})
				: undefined;
			if (history)
				await waitForFrameOperation({
					signal,
					operation: () => history.synchronize(),
				});
			const key = independentFrameCacheKey({
				engineSha256: engine,
				...edit,
				rgba: input.rgba,
				sequence: {
					session,
					frame: sequence.frame,
					...(profiled
						? { sourceTimestampSeconds: sequence.sourceTimestampSeconds }
						: {}),
				},
			});
			if (!sequence.replay) {
				const cached = await waitForFrameOperation({
					signal,
					operation: () => cache.read({ key, width, height }),
				});
				signal.throwIfAborted();
				if (cached) {
					if (history)
						await waitForFrameOperation({
							signal,
							operation: () =>
								history.synchronize({ requiredFrame: sequence.frame }),
						});
					return {
						status: "rendered",
						requestId,
						width,
						height,
						rgba: cached,
						cached: true,
					};
				}
			}
			const submit = () => {
				signal.throwIfAborted();
				return provider.render({
					request: {
						...input,
						sourceKey: INDEPENDENT_TIMELINE_SOURCE_KEY,
						sequence: {
							session,
							...(profile
								? {
										executionProfile: INDEPENDENT_COREML_PROFILE,
										executionGeneration: session,
										executionIdentitySha256: profile.identitySha256,
									}
								: {}),
							frame: sequence.frame,
							timestamp:
								sequence.sourceTimestampSeconds ??
								sequence.frame / sequence.fps,
							checkpoints: path.join(sessionsDirectory, session),
						},
					},
				});
			};
			let result: BeautyLabIndependentResult;
			try {
				try {
					result = await submit();
				} catch (error) {
					// A worker that dies under a frame takes the session's in-memory
					// history with it, but not the on-disk checkpoints. One resubmission
					// starts a fresh worker; lacking the history it answers with the
					// frame to replay from, which the caller already knows how to do.
					// Anything else (a deliberate stop, a bad request) is passed on.
					if (!(error instanceof IndependentWorkerExitedError)) throw error;
					signal.throwIfAborted();
					console.warn(
						`[independent-beauty] Worker died under frame ${sequence.frame}; resubmitting once:`,
						error.message
					);
					result = await submit();
				}
			} catch (error) {
				if (error instanceof IndependentSequenceGapError) {
					signal.throwIfAborted();
					return { status: "replay", requestId, from: error.restartFrom };
				}
				throw error;
			}
			if (profile) signal.throwIfAborted();
			if (
				result.requestId !== requestId ||
				result.width !== width ||
				result.height !== height ||
				result.rgba.length !== input.rgba.length
			)
				throw new Error("Independent frame result identity mismatch");
			if (history) {
				await history.synchronize({ requiredFrame: sequence.frame });
				signal.throwIfAborted();
			}
			// Once submitted, a successful warm frame must be cached even if its caller
			// cancelled: the worker may already have advanced the session history.
			try {
				await cache.write({
					key,
					width,
					height,
					png: result.png,
					rgba: result.rgba,
				});
			} catch (error) {
				// The frame itself succeeded; only the next export loses the reuse.
				console.warn("[independent-beauty] Frame cache write failed:", error);
			}
			await prune({ active: session });
			return {
				status: "rendered",
				requestId,
				width,
				height,
				rgba: result.rgba,
				cached: false,
			};
		}
		try {
			if (profiled && sequence.sourceTimestampSeconds === undefined)
				throw new Error(
					"CoreML body video requires a decoded source timestamp"
				);
			if (!profiled && sequence.sourceTimestampSeconds !== undefined)
				throw new Error(
					"Decoded source timestamps require the CoreML body profile"
				);
			if (profiled && !resolveCoreML)
				throw new Error("CoreML body video is unavailable in this host");
			// Resolve resources after waiting; the full cache key still binds each request's pixels and edit.
			const slot = JSON.stringify([
				sequence.clip,
				sequence.frame,
				width,
				height,
			]);
			return await frameQueue.run({
				key: slot,
				signal,
				operation: renderFrame,
			});
		} finally {
			pending.delete(requestId);
			coremlRequests.delete(requestId);
		}
	}
	function cancel({ request }: { request: { requestId: string } }) {
		const controller = pending.get(request?.requestId);
		if (!controller) return { cancelled: false };
		controller.abort(new Error("Independent beauty cancelled"));
		if (coremlRequests.has(request.requestId)) provider.cancel?.({ request });
		return { cancelled: true };
	}
	function dispose() {
		disposed = true;
		for (const [requestId, controller] of pending) {
			controller.abort(new Error("Independent sequence renderer disposed"));
			if (coremlRequests.has(requestId))
				provider.cancel?.({ request: { requestId } });
		}
	}
	return { render, cancel, dispose };
}
