import {
	PORTRAIT_SOURCE_PRE_ROLL_LIMITS,
	type JianyingPortraitSourcePreRoll,
} from "../../../../../electron/jianying-portrait-adjustment-contract";

export type PortraitSourcePreRollReader = ({
	width,
	height,
	timestampSeconds,
	sourceKey,
	signal,
}: {
	width: number;
	height: number;
	timestampSeconds: number;
	sourceKey: string;
	signal?: AbortSignal;
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
	return async ({ width, height, timestampSeconds, sourceKey, signal }) => {
		signal?.throwIfAborted();
		const maximumFrames = Math.min(
			PORTRAIT_SOURCE_PRE_ROLL_LIMITS.frames,
			Math.floor(PORTRAIT_SOURCE_PRE_ROLL_LIMITS.bytes / (width * height * 4))
		);
		if (maximumFrames < 1 || timestampSeconds <= 0) return;
		const { ALL_FORMATS, BlobSource, CanvasSink, Input, UrlSource } =
			await import("mediabunny");
		signal?.throwIfAborted();
		const input = new Input({
			formats: ALL_FORMATS,
			source:
				typeof source === "string"
					? new UrlSource(source, { getRetryDelay: () => null })
					: new BlobSource(source),
		});
		let disposed = false;
		let timedOut = false;
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			input.dispose();
		};
		const timeout = setTimeout(() => {
			timedOut = true;
			dispose();
		}, 10_000);
		signal?.addEventListener("abort", dispose, { once: true });
		try {
			const track = await input.getPrimaryVideoTrack();
			if (!track || !(await track.canDecode())) return;
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
				signal?.throwIfAborted();
				if (timedOut)
					throw new Error("Portrait source pre-roll decode timed out");
				if (++decoded > 256)
					throw new Error("Portrait source pre-roll decode limit exceeded");
				// currentTime can lie inside the target frame; never replay that frame as history.
				if (
					frame.timestamp < start ||
					frame.timestamp >= timestampSeconds ||
					!Number.isFinite(frame.duration) ||
					frame.duration <= 0 ||
					frame.timestamp + frame.duration > timestampSeconds + 1e-6
				)
					continue;
				const context = frame.canvas.getContext("2d", {
					willReadFrequently: true,
				});
				if (!context || !("getImageData" in context)) {
					throw new Error("Unable to read portrait source pre-roll pixels");
				}
				const rgba = context.getImageData(0, 0, width, height).data;
				frames.push({
					timestampSeconds: frame.timestamp,
					rgba: new Uint8Array(rgba),
				});
				if (frames.length > maximumFrames) frames.shift();
			}
			signal?.throwIfAborted();
			if (timedOut)
				throw new Error("Portrait source pre-roll decode timed out");
			return frames.length ? { sourceKey, frames } : undefined;
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", dispose);
			dispose();
		}
	};
}
