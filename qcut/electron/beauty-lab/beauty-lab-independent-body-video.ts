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
/** Checkpoints are ~50 KB per twelve frames; this holds days of edited footage. */
export const INDEPENDENT_SESSIONS_MAX_BYTES = 2 * 1024 ** 3;
const PRUNE_INTERVAL_MS = 60_000;

/**
 * Drops the least recently used session folders until the checkpoint store
 * fits `maxBytes`, keeping `active`. The worker recreates a folder it still
 * writes to; a pruned session merely replays from its clip's first frame.
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
				let bytes = 0;
				let usedAt = 0;
				for (const file of await readdir(folder).catch(() => [] as string[])) {
					const metadata = await stat(path.join(folder, file)).catch(
						() => null
					);
					if (!metadata?.isFile()) continue;
					bytes += metadata.size;
					usedAt = Math.max(usedAt, metadata.mtimeMs);
				}
				return { name, folder, bytes, usedAt };
			})
	);
	let total = folders.reduce((sum, folder) => sum + folder.bytes, 0);
	const removed: string[] = [];
	for (const folder of folders.sort(
		(left, right) => left.usedAt - right.usedAt
	)) {
		if (total <= maxBytes) break;
		if (folder.name === active) continue;
		await rm(folder.folder, { recursive: true, force: true });
		total -= folder.bytes;
		removed.push(folder.name);
	}
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
		// The engine takes steps of at most 0.1 s between frames.
		fps: z.number().finite().min(10).max(240),
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
}: {
	engineSha256: string;
	clip: string;
	width: number;
	height: number;
}) {
	return createHash("sha256")
		.update(
			JSON.stringify({ schemaVersion: 1, engineSha256, clip, width, height })
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
	sessionsDirectory,
	maxSessionBytes = INDEPENDENT_SESSIONS_MAX_BYTES,
	now = Date.now,
}: {
	provider: {
		render: (input: {
			request: unknown;
		}) => Promise<BeautyLabIndependentResult>;
	};
	cache: Pick<ReturnType<typeof createIndependentFrameCache>, "read" | "write">;
	engineSha256: () => Promise<string>;
	/** Each session keeps its on-disk checkpoints in `<sessionsDirectory>/<session>`. */
	sessionsDirectory: string;
	maxSessionBytes?: number;
	now?: () => number;
}) {
	if (!path.isAbsolute(sessionsDirectory))
		throw new Error("Independent session checkpoints need an absolute folder");
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
		const signal = new AbortController().signal;
		const engine = await waitForFrameOperation({
			signal,
			operation: engineSha256,
		});
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
			width,
			height,
		});
		const key = independentFrameCacheKey({
			engineSha256: engine,
			...edit,
			rgba: input.rgba,
			sequence: { session, frame: sequence.frame },
		});
		if (!sequence.replay) {
			const cached = await cache.read({ key, width, height });
			if (cached)
				return {
					status: "rendered",
					requestId,
					width,
					height,
					rgba: cached,
					cached: true,
				};
		}
		const submit = () =>
			provider.render({
				request: {
					...input,
					sourceKey: INDEPENDENT_TIMELINE_SOURCE_KEY,
					sequence: {
						session,
						frame: sequence.frame,
						timestamp: sequence.frame / sequence.fps,
						checkpoints: path.join(sessionsDirectory, session),
					},
				},
			});
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
				console.warn(
					`[independent-beauty] Worker died under frame ${sequence.frame}; resubmitting once:`,
					error.message
				);
				result = await submit();
			}
		} catch (error) {
			if (error instanceof IndependentSequenceGapError)
				return { status: "replay", requestId, from: error.restartFrom };
			throw error;
		}
		if (
			result.requestId !== requestId ||
			result.width !== width ||
			result.height !== height ||
			result.rgba.length !== input.rgba.length
		)
			throw new Error("Independent frame result identity mismatch");
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
	function dispose() {
		disposed = true;
	}
	return { render, dispose };
}
