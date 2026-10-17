/**
 * Sequential video frame source for exports.
 *
 * The legacy export path seeks an HTMLVideoElement for every frame. A seek is
 * random access: Chromium re-decodes from the previous keyframe, so long-GOP
 * sources cost O(GOP) decodes per exported frame. Exports walk source time
 * monotonically, so decoding sequentially with mediabunny's CanvasSink turns
 * that into O(1) decodes per frame.
 *
 * Callers ask for the frame covering a source timestamp. Backwards jumps and
 * large forward gaps restart the decode iterator (a keyframe-accurate seek);
 * anything unsupported reports `null` so the caller can fall back to the
 * seek-based path. Failure is never silent feature loss — the same pixels
 * come from the same file either way.
 */

import { debugWarn } from "@/lib/debug/debug-config";
import { resolveAlphaPlaybackProxyUrl } from "@/lib/media/alpha-playback-proxy";
import type { MediaItem } from "@/stores/media/media-store-types";
import { exportProfiler } from "./export-profiler";

interface WrappedCanvasFrame {
	canvas: HTMLCanvasElement | OffscreenCanvas;
	timestamp: number;
	duration: number;
}

interface CanvasFrameIterator {
	next(): Promise<IteratorResult<WrappedCanvasFrame>>;
	return?(value?: unknown): Promise<IteratorResult<WrappedCanvasFrame>>;
}

interface MediabunnyInputHandle {
	dispose?: () => void | Promise<void>;
}

/** Forward gap beyond which restarting (keyframe seek) beats decoding through. */
const RESTART_GAP_SECONDS = 1;
/** Float noise only: millisecond tolerances select future frames across cadences. */
const TIME_EPSILON_SECONDS = 0.000_000_1;
/** Pooled canvases: current + lookahead + one margin. */
const CANVAS_POOL_SIZE = 3;

export class SequentialVideoFrameSource {
	private iterator: CanvasFrameIterator | null = null;
	private current: WrappedCanvasFrame | null = null;
	private lookahead: WrappedCanvasFrame | null | undefined;

	private constructor(
		private readonly input: MediabunnyInputHandle,
		private readonly makeIterator: (
			startTimestamp: number
		) => CanvasFrameIterator
	) {}

	/** Opens a source for one media file; null when the file can't decode. */
	static async open({
		blob,
	}: {
		blob: Blob;
	}): Promise<SequentialVideoFrameSource | null> {
		try {
			const { ALL_FORMATS, BlobSource, CanvasSink, Input } = await import(
				"mediabunny"
			);
			const input = new Input({
				source: new BlobSource(blob),
				formats: ALL_FORMATS,
			});
			const track = await input.getPrimaryVideoTrack();
			if (!track) return null;
			if ((await track.canDecode()) !== true) return null;
			// A transparent video goes to the seek path: the video element
			// decodes its alpha itself, while mediabunny merges alpha in web
			// workers, and blob workers never start in the editor, so the first
			// frame never came (without alpha, clear pixels decoded black).
			if (await track.canBeTransparent()) return null;
			const sink = new CanvasSink(track, { poolSize: CANVAS_POOL_SIZE });
			return new SequentialVideoFrameSource(
				input as MediabunnyInputHandle,
				(startTimestamp) =>
					sink.canvases(startTimestamp) as unknown as CanvasFrameIterator
			);
		} catch (error) {
			debugWarn(
				"[SequentialVideoFrameSource] open failed; using seek fallback",
				error
			);
			return null;
		}
	}

	private async restart(timeSeconds: number): Promise<void> {
		await this.iterator?.return?.();
		this.iterator = this.makeIterator(Math.max(0, timeSeconds));
		this.lookahead = undefined;
		const first = await this.iterator.next();
		this.current = first.done ? null : first.value;
		exportProfiler.count("sequential-video-restart");
	}

	/**
	 * Coverage is half-open with the epsilon on the *newer* side:
	 * [start - ε, start + duration - ε). A request landing exactly on a frame
	 * boundary (a 2x clip with a frame-aligned trim hits one every frame)
	 * resolves to the frame that starts there — the frame an HTMLVideoElement
	 * seek displays — instead of holding the previous frame one frame stale.
	 */
	private frameCovers(frame: WrappedCanvasFrame, timeSeconds: number): boolean {
		return (
			timeSeconds >= frame.timestamp - TIME_EPSILON_SECONDS &&
			timeSeconds < frame.timestamp + frame.duration - TIME_EPSILON_SECONDS
		);
	}

	/**
	 * Returns the decoded frame covering `timeSeconds`, advancing the decoder
	 * sequentially. Null when the source has no frame there.
	 */
	async frameAt(timeSeconds: number): Promise<WrappedCanvasFrame | null> {
		if (!Number.isFinite(timeSeconds) || timeSeconds < 0) return null;
		const needsRestart =
			!this.iterator ||
			!this.current ||
			timeSeconds < this.current.timestamp - TIME_EPSILON_SECONDS ||
			timeSeconds >
				this.current.timestamp + this.current.duration + RESTART_GAP_SECONDS;
		if (needsRestart) {
			await this.restart(timeSeconds);
		} else {
			exportProfiler.count("sequential-video-advance");
		}
		if (!this.iterator || !this.current) return null;

		while (!this.frameCovers(this.current, timeSeconds)) {
			if (this.lookahead === undefined) {
				const next = await this.iterator.next();
				this.lookahead = next.done ? null : next.value;
			}
			if (this.lookahead === null) {
				// Past the last sample: the final frame stays valid (videos often
				// end a hair before the element's trimmed duration).
				return this.current;
			}
			if (this.lookahead.timestamp > timeSeconds + TIME_EPSILON_SECONDS) {
				// The requested time falls inside a gap before the next sample;
				// hold the current frame, exactly like a paused video element.
				return this.current;
			}
			this.current = this.lookahead;
			this.lookahead = undefined;
		}
		return this.current;
	}

	async dispose(): Promise<void> {
		try {
			await this.iterator?.return?.();
		} catch {
			// Iterator teardown is best-effort.
		}
		this.iterator = null;
		this.current = null;
		this.lookahead = undefined;
		try {
			await this.input.dispose?.();
		} catch {
			// Input teardown is best-effort.
		}
	}
}

let sequentialDecodeDisabled = false;

/** Debug switch: force the seek fallback (used for baseline profiling). */
export function setSequentialDecodeDisabled(disabled: boolean): void {
	sequentialDecodeDisabled = disabled;
}

/**
 * Concurrently open decoders are capped; opening beyond the cap disposes the
 * least recently used lane. Exports touch every active element's lane every
 * frame, so eviction naturally retires elements whose window has passed and
 * bounds decoder + canvas-pool memory on long many-clip timelines.
 */
const MAX_OPEN_SOURCES = 8;

/** Per-export registry: one sequential source per decoder lane, or null. */
export class SequentialVideoRegistry {
	private readonly sources = new Map<
		string,
		Promise<SequentialVideoFrameSource | null>
	>();
	private readonly lastUse = new Map<string, number>();
	private useTick = 0;

	/**
	 * Opens (once) the sequential source for a media item's decoder lane.
	 * Callers pass the timeline element id as the lane: each element walks
	 * its own source time monotonically, so a per-element decoder advances
	 * O(1) per frame, while two elements sharing one decoder (overlapping
	 * clips cut from the same file) would restart it — a keyframe-accurate
	 * seek — on every alternating read.
	 */
	getOrOpen(
		mediaItem: MediaItem,
		lane?: string,
		{ signal }: { signal?: AbortSignal } = {}
	): Promise<SequentialVideoFrameSource | null> {
		if (signal?.aborted) return Promise.reject(signal.reason);
		if (sequentialDecodeDisabled) return Promise.resolve(null);
		const key = lane ? `${mediaItem.id}#${lane}` : mediaItem.id;
		this.useTick += 1;
		this.lastUse.set(key, this.useTick);
		const existing = this.sources.get(key);
		if (existing) return existing;
		this.evictBeyondCapacity();
		const opened = (async () => {
			const blob = await resolveMediaBlob({ mediaItem, signal });
			signal?.throwIfAborted();
			if (!blob) return null;
			const source = await SequentialVideoFrameSource.open({ blob });
			if (signal?.aborted) {
				await source?.dispose();
				signal.throwIfAborted();
			}
			exportProfiler.count(
				source ? "sequential-video-open" : "sequential-video-fallback"
			);
			return source;
		})();
		this.sources.set(key, opened);
		void opened.catch(() => {
			if (this.sources.get(key) !== opened) return;
			this.sources.delete(key);
			this.lastUse.delete(key);
		});
		return opened;
	}

	/** Disposes least-recently-used lanes until a new one fits the cap. */
	private evictBeyondCapacity(): void {
		while (this.sources.size >= MAX_OPEN_SOURCES) {
			let oldestKey: string | null = null;
			let oldestTick = Number.POSITIVE_INFINITY;
			for (const key of this.sources.keys()) {
				const tick = this.lastUse.get(key) ?? 0;
				if (tick < oldestTick) {
					oldestTick = tick;
					oldestKey = key;
				}
			}
			if (oldestKey === null) return;
			const evicted = this.sources.get(oldestKey);
			this.sources.delete(oldestKey);
			this.lastUse.delete(oldestKey);
			exportProfiler.count("sequential-video-evict");
			void (async () => {
				try {
					await (await evicted)?.dispose();
				} catch {
					// Disposal is best-effort.
				}
			})();
		}
	}

	async disposeAll(): Promise<void> {
		const pending = [...this.sources.values()];
		this.sources.clear();
		this.lastUse.clear();
		await Promise.all(
			pending.map(async (promise) => {
				try {
					await (await promise)?.dispose();
				} catch {
					// Disposal is best-effort.
				}
			})
		);
	}
}

async function resolveMediaBlob({
	mediaItem,
	signal,
}: {
	mediaItem: MediaItem;
	signal?: AbortSignal;
}): Promise<Blob | null> {
	signal?.throwIfAborted();
	// A transparent video the browser cannot decode reads its VP9 alpha proxy.
	const proxyUrl = await resolveAlphaPlaybackProxyUrl(mediaItem);
	signal?.throwIfAborted();
	if (!proxyUrl && mediaItem.file instanceof Blob && mediaItem.file.size > 0)
		return mediaItem.file;
	const url = proxyUrl ?? mediaItem.url;
	if (!url) return null;
	try {
		const response = await fetch(url, { signal });
		signal?.throwIfAborted();
		if (!response.ok) return null;
		const blob = await response.blob();
		signal?.throwIfAborted();
		return blob;
	} catch {
		signal?.throwIfAborted();
		return null;
	}
}
