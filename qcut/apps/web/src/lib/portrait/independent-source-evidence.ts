import {
	INDEPENDENT_SOURCE_EVIDENCE_MAX_BYTES,
	INDEPENDENT_SOURCE_EVIDENCE_MAX_SECONDS,
	INDEPENDENT_SOURCE_EVIDENCE_POLICY,
	type BeautyLabIndependentSourceEvidence,
} from "../../../../../electron/beauty-lab/beauty-lab-independent-contract";
import { independentPortraitDimensionsValid } from "./portrait-processing-size";

interface SourceEvidenceOptions {
	width: number;
	height: number;
	timestampSeconds: number;
	signal?: AbortSignal;
}

export type IndependentPortraitSourceEvidenceReader = (
	options: SourceEvidenceOptions
) => Promise<BeautyLabIndependentSourceEvidence>;

const MAX_DECODED_FRAMES = 256;
const DECODE_TIMEOUT_MS = 10_000;

function unavailable({
	reason,
}: {
	reason: string;
}): BeautyLabIndependentSourceEvidence {
	return {
		policy: INDEPENDENT_SOURCE_EVIDENCE_POLICY,
		status: "unavailable",
		reason: reason.slice(0, 256),
	};
}

export function createIndependentSourceEvidenceReader({
	source,
}: {
	source: Blob | string;
}): IndependentPortraitSourceEvidenceReader | undefined {
	if (
		typeof source === "string" &&
		!source.startsWith("blob:") &&
		!source.startsWith("app://local-media/")
	)
		return;
	return async ({ width, height, timestampSeconds, signal }) => {
		signal?.throwIfAborted();
		if (
			!independentPortraitDimensionsValid({ width, height }) ||
			!Number.isFinite(timestampSeconds) ||
			timestampSeconds < 0
		)
			return unavailable({
				reason: "Invalid source evidence dimensions or timestamp",
			});
		if (width * height * 4 * 4 > INDEPENDENT_SOURCE_EVIDENCE_MAX_BYTES)
			return unavailable({
				reason: "Four source frames exceed the evidence byte budget",
			});

		let disposeInput: (() => void) | undefined;
		let disposed = false;
		let stopped: Error | undefined;
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			disposeInput?.();
		};
		const assertActive = () => {
			signal?.throwIfAborted();
			if (stopped) throw stopped;
		};
		let interrupt: (reason: unknown) => void = () => {};
		const interrupted = new Promise<never>((_resolve, reject) => {
			interrupt = reject;
		});
		const abort = () => {
			interrupt(
				signal?.reason ??
					new DOMException("Source evidence cancelled", "AbortError")
			);
			dispose();
		};
		const timeout = setTimeout(() => {
			stopped = new Error("Source evidence decode timed out");
			interrupt(stopped);
			dispose();
		}, DECODE_TIMEOUT_MS);
		signal?.addEventListener("abort", abort, { once: true });

		const decode = async (): Promise<BeautyLabIndependentSourceEvidence> => {
			const { ALL_FORMATS, BlobSource, CanvasSink, Input, UrlSource } =
				await import("mediabunny");
			assertActive();
			const input = new Input({
				formats: ALL_FORMATS,
				source:
					typeof source === "string"
						? new UrlSource(source, { getRetryDelay: () => null })
						: new BlobSource(source),
			});
			disposeInput = () => input.dispose();
			const track = await input.getPrimaryVideoTrack();
			assertActive();
			if (!track || !(await track.canDecode()))
				throw new Error("Source evidence video track cannot be decoded");
			assertActive();
			// Match target processing: decoded display canvas, then one readback-canvas resize.
			const sink = new CanvasSink(track, { poolSize: 1 });
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context) throw new Error("Unable to read source evidence pixels");
			const before: Array<{ timestampSeconds: number; rgba: Uint8Array }> = [];
			const after: typeof before = [];
			const start = Math.max(
				0,
				timestampSeconds - INDEPENDENT_SOURCE_EVIDENCE_MAX_SECONDS
			);
			const end = timestampSeconds + INDEPENDENT_SOURCE_EVIDENCE_MAX_SECONDS;
			let targetSeen = false;
			let previousTimestamp = Number.NEGATIVE_INFINITY;
			let decoded = 0;
			try {
				for await (const frame of sink.canvases(start, end + 1e-6)) {
					assertActive();
					if (++decoded > MAX_DECODED_FRAMES)
						throw new Error("Source evidence decode limit exceeded");
					if (
						!Number.isFinite(frame.timestamp) ||
						!Number.isFinite(frame.duration) ||
						frame.duration <= 0 ||
						frame.timestamp < previousTimestamp
					)
						throw new Error("Source evidence frame timing is invalid");
					if (frame.timestamp === previousTimestamp) continue;
					previousTimestamp = frame.timestamp;
					if (frame.timestamp < start || frame.timestamp > end) continue;
					if (frame.timestamp === timestampSeconds) {
						targetSeen = true;
						continue;
					}
					context.clearRect(0, 0, width, height);
					context.drawImage(frame.canvas, 0, 0, width, height);
					const rgba = new Uint8Array(
						context.getImageData(0, 0, width, height).data
					);
					if (rgba.length !== width * height * 4)
						throw new Error("Source evidence pixel dimensions changed");
					for (let index = 3; index < rgba.length; index += 4)
						rgba[index] = 255;
					const evidenceFrame = { timestampSeconds: frame.timestamp, rgba };
					if (frame.timestamp < timestampSeconds) {
						before.push(evidenceFrame);
						if (before.length > 2) before.shift();
					} else {
						after.push(evidenceFrame);
						if (after.length === 2) break;
					}
				}
				assertActive();
				if (!targetSeen || before.length !== 2 || after.length !== 2)
					return unavailable({
						reason:
							"Two distinct source frames on each side of the decoded target are required",
					});
				return {
					policy: INDEPENDENT_SOURCE_EVIDENCE_POLICY,
					status: "available",
					targetTimestampSeconds: timestampSeconds,
					frames: [...before, ...after],
				};
			} finally {
				canvas.width = 0;
				canvas.height = 0;
			}
		};
		try {
			return await Promise.race([decode(), interrupted]);
		} catch (error) {
			signal?.throwIfAborted();
			const reason = error instanceof Error ? error.message : String(error);
			return unavailable({
				reason: reason || "Source evidence decode failed",
			});
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			dispose();
		}
	};
}
