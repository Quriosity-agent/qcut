import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

/**
 * The engine's video face profile loads this runtime asset and pins its hash
 * (research/body_face_policy.py). Without it a clip's body edits render frame
 * by frame as photos; with it they follow the clip's history.
 */
export const INDEPENDENT_BODY_VIDEO_POLICY = {
	file: "research/body-face-video-policy-v1.json",
	sha256: "b5b9905399fac944db0ac036260fe6916b84a314f6eb69eec5555c2358b0a91b",
};

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
}) {
	if (!path.isAbsolute(sessionsDirectory))
		throw new Error("Independent session checkpoints need an absolute folder");
	let disposed = false;
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
		let result: BeautyLabIndependentResult;
		try {
			result = await provider.render({
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
