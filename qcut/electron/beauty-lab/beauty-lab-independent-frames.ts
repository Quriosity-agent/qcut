import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import runtimeProfile from "../beauty-lab-runtime-payload.json";
import {
	INDEPENDENT_BEAUTY_MAX_EDGE,
	INDEPENDENT_BEAUTY_MAX_PIXELS,
} from "./beauty-lab-independent-contract.js";
import type {
	BeautyLabIndependentFrameResult,
	BeautyLabIndependentResult,
} from "./beauty-lab-independent-contract.js";
import {
	type createIndependentFrameCache,
	independentFrameCacheKey,
} from "./beauty-lab-independent-frame-cache.js";
import {
	independentSourceEvidenceSchema,
	independentSourceEvidenceIdentity,
} from "./beauty-lab-independent-source-evidence.js";
import {
	canonicalIndependentManualBody,
	independentManualBodySchema,
} from "./beauty-lab-independent-manual-body.js";

/** Timeline frames carry no photo identity; the cache keys them by content. */
export const INDEPENDENT_TIMELINE_SOURCE_KEY = "timeline-frame";

const frameRequestSchema = z
	.object({
		requestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
		width: z.number().int().min(1).max(INDEPENDENT_BEAUTY_MAX_EDGE),
		height: z.number().int().min(1).max(INDEPENDENT_BEAUTY_MAX_EDGE),
		rgba: z.instanceof(Uint8Array),
		sourceEvidence: independentSourceEvidenceSchema.optional(),
		adjustments: z
			.object({
				enabled: z.literal(true),
				values: z.record(z.string(), z.number().finite()),
				makeup: z
					.record(
						z.string(),
						z
							.object({ cardId: z.string(), intensity: z.number().finite() })
							.strict()
					)
					.optional(),
				manualBody: independentManualBodySchema.optional(),
			})
			.strict(),
	})
	.strict()
	.refine(
		({ width, height }) => width * height <= INDEPENDENT_BEAUTY_MAX_PIXELS,
		"Independent frame exceeds the pixel budget"
	);

/**
 * Engine build identity for the frame cache: the pinned source manifest and
 * the runtime payload profile bound to it. A new engine build never reads
 * frames processed by an older one.
 */
export async function independentEngineSha256({
	engineRoot,
	profile = runtimeProfile,
}: {
	engineRoot: string;
	profile?: unknown;
}) {
	const manifest = await readFile(
		path.join(engineRoot, "source-manifest.json")
	);
	return createHash("sha256")
		.update(createHash("sha256").update(manifest).digest("hex"))
		.update("\0")
		.update(JSON.stringify(profile))
		.digest("hex");
}

async function waitForFrameOperation<T>({
	signal,
	operation,
}: {
	signal: AbortSignal;
	operation: () => Promise<T>;
}) {
	signal.throwIfAborted();
	let cancel = () => {};
	const cancelled = new Promise<never>((_resolve, reject) => {
		cancel = () => reject(signal.reason);
		signal.addEventListener("abort", cancel, { once: true });
	});
	try {
		return await Promise.race([
			Promise.resolve().then(() => {
				signal.throwIfAborted();
				return operation();
			}),
			cancelled,
		]);
	} finally {
		signal.removeEventListener("abort", cancel);
	}
}

/**
 * Processes one timeline frame with the independent engine, reading the disk
 * cache first and storing every new output for the next preview or export.
 */
export function createIndependentFrameRenderer({
	provider,
	cache,
	engineSha256,
}: {
	provider: {
		render: (input: {
			request: unknown;
		}) => Promise<BeautyLabIndependentResult>;
	};
	cache: Pick<ReturnType<typeof createIndependentFrameCache>, "read" | "write">;
	engineSha256: () => Promise<string>;
}) {
	const pending = new Map<string, AbortController>();
	let disposed = false;
	async function render({
		request,
	}: {
		request: unknown;
	}): Promise<BeautyLabIndependentFrameResult> {
		if (disposed) throw new Error("Independent frame renderer disposed");
		const parsed = frameRequestSchema.parse(request);
		if (
			parsed.rgba.buffer instanceof SharedArrayBuffer ||
			parsed.rgba.length !== parsed.width * parsed.height * 4
		)
			throw new Error("Invalid independent frame RGBA");
		const evidenceIdentity = independentSourceEvidenceIdentity(parsed);
		const sourceEvidence = parsed.sourceEvidence;
		// Cloning a typed-array view also clones its entire backing buffer.
		const input = {
			...parsed,
			rgba: new Uint8Array(parsed.rgba),
			adjustments: structuredClone(parsed.adjustments),
			sourceEvidence:
				sourceEvidence?.status === "available"
					? {
							...sourceEvidence,
							frames: sourceEvidence.frames.map(
								({ timestampSeconds, rgba }) => ({
									timestampSeconds,
									rgba: new Uint8Array(rgba),
								})
							),
						}
					: sourceEvidence,
		};
		const { requestId, width, height } = input;
		if (pending.has(requestId))
			throw new Error("Duplicate independent frame request id");
		const controller = new AbortController();
		pending.set(requestId, controller);
		const { signal } = controller;
		try {
			const key = independentFrameCacheKey({
				engineSha256: await waitForFrameOperation({
					signal,
					operation: engineSha256,
				}),
				width,
				height,
				values: input.adjustments.values,
				makeup: input.adjustments.makeup ?? {},
				manualBody: canonicalIndependentManualBody({
					manualBody: input.adjustments.manualBody,
				}),
				rgba: input.rgba,
				sourceEvidenceSha256: evidenceIdentity?.manifestSha256,
			});
			const cached = await waitForFrameOperation({
				signal,
				operation: () => cache.read({ key, width, height }),
			});
			signal.throwIfAborted();
			if (cached)
				return { requestId, width, height, rgba: cached, cached: true };
			const result = await waitForFrameOperation({
				signal,
				operation: () =>
					provider.render({
						request: { ...input, sourceKey: INDEPENDENT_TIMELINE_SOURCE_KEY },
					}),
			});
			signal.throwIfAborted();
			if (
				result.requestId !== requestId ||
				result.width !== width ||
				result.height !== height ||
				result.rgba.length !== input.rgba.length
			)
				throw new Error("Independent frame result identity mismatch");
			try {
				await waitForFrameOperation({
					signal,
					operation: () =>
						cache.write({
							key,
							width,
							height,
							png: result.png,
							rgba: result.rgba,
						}),
				});
			} catch (error) {
				signal.throwIfAborted();
				// The frame itself succeeded; only the next export loses the reuse.
				console.warn("[independent-beauty] Frame cache write failed:", error);
			}
			signal.throwIfAborted();
			return { requestId, width, height, rgba: result.rgba, cached: false };
		} finally {
			if (pending.get(requestId) === controller) pending.delete(requestId);
		}
	}
	function cancel({ request }: { request: { requestId: string } }) {
		const parsed = z
			.object({ requestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/) })
			.strict()
			.parse(request);
		const controller = pending.get(parsed.requestId);
		if (!controller) return { cancelled: false };
		controller.abort(new Error("Independent beauty cancelled"));
		return { cancelled: true };
	}
	function dispose() {
		disposed = true;
		for (const controller of pending.values())
			controller.abort(new Error("Independent frame renderer disposed"));
	}
	return { render, cancel, dispose };
}
