import {
	PORTRAIT_SOURCE_PRE_ROLL_LIMITS,
	type JianyingPortraitSourcePreRoll,
} from "../../../../../electron/jianying-portrait-adjustment-runtime/jianying-portrait-adjustment-contract";

export type PortraitSourcePreRollReader = ({
	width,
	height,
	timestampSeconds,
	sourceKey,
	signal,
	strict,
}: {
	width: number;
	height: number;
	timestampSeconds: number;
	sourceKey: string;
	signal?: AbortSignal;
	strict?: boolean;
}) => Promise<JianyingPortraitSourcePreRoll | undefined>;

function isLocalVideoUrl({ url }: { url: string }) {
	return url.startsWith("blob:") || url.startsWith("app://local-media/");
}

export function createPortraitSourcePreRollReader({
	source,
	fit = "fill",
}: {
	source: Blob | string;
	fit?: "fill" | "cover" | "contain";
}): PortraitSourcePreRollReader | undefined {
	if (typeof source === "string" && !isLocalVideoUrl({ url: source })) return;
	return async ({
		width,
		height,
		timestampSeconds,
		sourceKey,
		signal,
		strict,
	}) => {
		signal?.throwIfAborted();
		const validDimensions = [width, height].every(
			(value) => Number.isSafeInteger(value) && value > 0
		);
		const maximumFrames = Math.min(
			PORTRAIT_SOURCE_PRE_ROLL_LIMITS.frames,
			Math.floor(PORTRAIT_SOURCE_PRE_ROLL_LIMITS.bytes / (width * height * 4))
		);
		if (
			!validDimensions ||
			maximumFrames < 1 ||
			!Number.isFinite(timestampSeconds) ||
			timestampSeconds < 0
		) {
			if (strict)
				throw new Error(
					"Invalid portrait source-window dimensions, timestamp or memory budget"
				);
			return;
		}
		if (timestampSeconds === 0)
			return strict ? { sourceKey, frames: [] } : undefined;
		let disposed = false;
		let disposeInput: (() => void) | undefined;
		let stopped: unknown;
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			disposeInput?.();
		};
		const assertActive = () => {
			signal?.throwIfAborted();
			if (stopped) throw stopped;
		};
		let rejectInterrupted: (reason: unknown) => void = () => {};
		const interrupted = new Promise<never>((_resolve, reject) => {
			rejectInterrupted = reject;
		});
		const stop = ({ reason }: { reason: unknown }) => {
			stopped = reason;
			rejectInterrupted(reason);
			dispose();
		};
		const abort = () =>
			stop({
				reason:
					signal?.reason ??
					new DOMException("Portrait source decode aborted", "AbortError"),
			});
		const timeout = setTimeout(
			() =>
				stop({
					reason: new Error("Portrait source pre-roll decode timed out"),
				}),
			10_000
		);
		signal?.addEventListener("abort", abort, { once: true });
		const decode = async () => {
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
			if (!track || !(await track.canDecode())) {
				if (strict)
					throw new Error(
						"Portrait source-window video track cannot be decoded"
					);
				return;
			}
			assertActive();
			const sink = new CanvasSink(track, {
				width,
				height,
				fit,
				alpha: true,
				poolSize: 1,
			});
			const frames: JianyingPortraitSourcePreRoll["frames"] = [];
			const start = Math.max(
				0,
				timestampSeconds - PORTRAIT_SOURCE_PRE_ROLL_LIMITS.seconds
			);
			let decoded = 0;
			for await (const frame of sink.canvases(start, timestampSeconds)) {
				assertActive();
				if (++decoded > 256)
					throw new Error("Portrait source pre-roll decode limit exceeded");
				if (
					!Number.isFinite(frame.timestamp) ||
					!Number.isFinite(frame.duration) ||
					frame.duration <= 0
				) {
					if (strict)
						throw new Error("Portrait source-window frame has invalid timing");
					continue;
				}
				// A seek inside the target frame must not replay that frame as history.
				if (
					frame.timestamp < start ||
					frame.timestamp >= timestampSeconds ||
					frame.timestamp + frame.duration > timestampSeconds + 1e-6
				)
					continue;
				const context = frame.canvas.getContext("2d", {
					willReadFrequently: true,
				});
				if (!context || !("getImageData" in context))
					throw new Error("Unable to read portrait source pre-roll pixels");
				const rgba = context.getImageData(0, 0, width, height).data;
				frames.push({
					timestampSeconds: frame.timestamp,
					rgba: new Uint8Array(rgba),
				});
				if (frames.length > maximumFrames) frames.shift();
			}
			assertActive();
			return frames.length || strict ? { sourceKey, frames } : undefined;
		};
		try {
			return await Promise.race([decode(), interrupted]);
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			dispose();
		}
	};
}
