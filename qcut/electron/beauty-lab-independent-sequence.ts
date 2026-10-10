import { z } from "zod";
import type { MediaPortraitAdjustments } from "./jianying-portrait-adjustment-contract";
import type { BeautyLabIndependentResult } from "./beauty-lab/beauty-lab-independent-contract";
import type { createBeautyLabIndependentProvider } from "./beauty-lab-independent";

export interface IndependentBeautySequenceFrame {
	width: number;
	height: number;
	rgba: Uint8Array;
	timestampSeconds: number;
}
export async function processIndependentBeautySequence({
	provider,
	frames,
	adjustments,
	sourceKey,
	sequenceId,
	onFrame,
	signal,
	maxFrames = 300,
}: {
	provider: Pick<
		ReturnType<typeof createBeautyLabIndependentProvider>,
		"render" | "cancel"
	>;
	frames: AsyncIterable<IndependentBeautySequenceFrame>;
	adjustments: MediaPortraitAdjustments;
	sourceKey: string;
	sequenceId: string;
	onFrame: (frame: {
		input: IndependentBeautySequenceFrame;
		result: BeautyLabIndependentResult;
		frameNumber: number;
	}) => Promise<void>;
	signal?: AbortSignal;
	maxFrames?: number;
}) {
	z.string()
		.regex(/^[a-zA-Z0-9._:-]{1,110}$/)
		.parse(sequenceId);
	z.string().min(1).max(256).parse(sourceKey);
	z.number().int().min(1).max(300).parse(maxFrames);
	const parameters = structuredClone(adjustments);
	const iterator = frames[Symbol.asyncIterator]();
	let completed = 0,
		previousTimestamp = -1;
	let dimensions: { width: number; height: number } | undefined;
	let activeId: string | undefined;
	const abort = () => {
		if (activeId) provider.cancel({ request: { requestId: activeId } });
	};
	signal?.addEventListener("abort", abort);
	async function consumeNext(): Promise<void> {
		signal?.throwIfAborted();
		const next = await iterator.next();
		signal?.throwIfAborted();
		if (next.done) return;
		if (completed >= maxFrames)
			throw new Error("Independent sequence frame budget exceeded");
		const frame = next.value;
		if (
			!Number.isFinite(frame.timestampSeconds) ||
			frame.timestampSeconds < 0 ||
			frame.timestampSeconds <= previousTimestamp
		)
			throw new Error("Independent sequence timestamps must increase");
		if (
			dimensions &&
			(frame.width !== dimensions.width || frame.height !== dimensions.height)
		)
			throw new Error("Independent sequence dimensions changed");
		dimensions = { width: frame.width, height: frame.height };
		activeId = `${sequenceId}-${completed}`;
		const input = { ...frame, rgba: frame.rgba.slice() };
		try {
			const result = await provider.render({
				request: {
					...dimensions,
					rgba: input.rgba,
					sourceKey,
					requestId: activeId,
					adjustments: structuredClone(parameters),
				},
			});
			signal?.throwIfAborted();
			if (
				result.requestId !== activeId ||
				result.sourceKey !== sourceKey ||
				result.width !== frame.width ||
				result.height !== frame.height
			)
				throw new Error("Independent sequence result identity mismatch");
			await onFrame({ input, result, frameNumber: completed });
			signal?.throwIfAborted();
			completed++;
			previousTimestamp = frame.timestampSeconds;
		} finally {
			activeId = undefined;
		}
		// Acknowledge each output before reading another frame; retain no frame queue.
		return consumeNext();
	}
	try {
		await consumeNext();
		if (!completed) throw new Error("Independent sequence has no frames");
		return {
			completed,
			sourceKey,
			width: dimensions?.width,
			height: dimensions?.height,
			lastTimestampSeconds: previousTimestamp,
			independentTrackingVerified: false,
			nativeProductParityVerified: false,
		};
	} finally {
		signal?.removeEventListener("abort", abort);
		await iterator.return?.();
	}
}
