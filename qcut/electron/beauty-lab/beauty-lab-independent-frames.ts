import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import runtimeProfile from "../beauty-lab-runtime-payload.json";
import type {
	BeautyLabIndependentFrameResult,
	BeautyLabIndependentResult,
} from "./beauty-lab-independent-contract.js";
import {
	type createIndependentFrameCache,
	independentFrameCacheKey,
} from "./beauty-lab-independent-frame-cache.js";

/** Timeline frames carry no photo identity; the cache keys them by content. */
export const INDEPENDENT_TIMELINE_SOURCE_KEY = "timeline-frame";

const frameRequestSchema = z
	.object({
		requestId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
		width: z.number().int().min(1).max(1280),
		height: z.number().int().min(1).max(1280),
		rgba: z.instanceof(Uint8Array),
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
			})
			.strict(),
	})
	.strict();

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
	async function render({
		request,
	}: {
		request: unknown;
	}): Promise<BeautyLabIndependentFrameResult> {
		const input = frameRequestSchema.parse(request);
		if (input.rgba.length !== input.width * input.height * 4)
			throw new Error("Invalid independent frame RGBA");
		const { requestId, width, height } = input;
		const key = independentFrameCacheKey({
			engineSha256: await engineSha256(),
			width,
			height,
			values: input.adjustments.values,
			makeup: input.adjustments.makeup ?? {},
			rgba: input.rgba,
		});
		const cached = await cache.read({ key, width, height });
		if (cached) return { requestId, width, height, rgba: cached, cached: true };
		const result = await provider.render({
			request: { ...input, sourceKey: INDEPENDENT_TIMELINE_SOURCE_KEY },
		});
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
		return { requestId, width, height, rgba: result.rgba, cached: false };
	}
	return { render };
}
