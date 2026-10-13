export interface ExportFrameEvidence {
	canvas: HTMLCanvasElement;
	frameIndex: number;
	timeSeconds: number;
	fps: number;
	signal: AbortSignal;
}

export interface ExportFrameEvidenceSink {
	frameIndices: readonly number[];
	capture: (frame: ExportFrameEvidence) => void | Promise<void>;
}

const CAPTURE_TIMEOUT_MS = 30_000;

export async function captureExportFrameEvidence({
	canvas,
	frameIndex,
	timeSeconds,
	fps,
	signal,
}: ExportFrameEvidence) {
	if (typeof window === "undefined") return;
	const sink = (
		window as Window & {
			__qcutExportFrameEvidence?: ExportFrameEvidenceSink;
		}
	).__qcutExportFrameEvidence;
	if (!sink) return;
	if (
		sink.frameIndices.length > 32 ||
		sink.frameIndices.some((index) => !Number.isInteger(index) || index < 0)
	) {
		throw new Error(
			"Export evidence requires at most 32 nonnegative frame indices"
		);
	}
	if (!sink.frameIndices.includes(frameIndex)) return;
	signal.throwIfAborted();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const interrupted = new Promise<never>((_resolve, reject) => {
		onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		timeout = setTimeout(
			() => reject(new Error("Export evidence capture timed out")),
			CAPTURE_TIMEOUT_MS
		);
	});
	try {
		// The compositor must wait for a copy, but a broken sink cannot trap cancel.
		await Promise.race([
			Promise.resolve().then(() => {
				signal.throwIfAborted();
				return sink.capture({ canvas, frameIndex, timeSeconds, fps, signal });
			}),
			interrupted,
		]);
	} finally {
		clearTimeout(timeout);
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
	signal.throwIfAborted();
}
