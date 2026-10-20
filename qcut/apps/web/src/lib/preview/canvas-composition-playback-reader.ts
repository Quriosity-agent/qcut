import type { CanvasPlaybackCache } from "./canvas-composition-playback-cache";

export const PLAYBACK_BITMAP_MAX_BYTES = 64 * 1024 * 1024;
export const PLAYBACK_BITMAP_MAX_FRAMES = 6;
export const PLAYBACK_BITMAP_DECODE_CONCURRENCY = 2;

export function createCanvasPlaybackReader({
	cache,
	width,
	height,
	frames,
	decode = (blob: Blob) => createImageBitmap(blob),
	maxBytes = PLAYBACK_BITMAP_MAX_BYTES,
	maxFrames = PLAYBACK_BITMAP_MAX_FRAMES,
}: {
	cache: Pick<CanvasPlaybackCache, "read">;
	width: number;
	height: number;
	frames: number;
	decode?: (blob: Blob) => Promise<ImageBitmap>;
	maxBytes?: number;
	maxFrames?: number;
}) {
	if (
		![width, height, frames, maxFrames].every(
			(value) => Number.isInteger(value) && value > 0
		) ||
		!Number.isFinite(maxBytes) ||
		maxBytes <= 0
	)
		throw new Error("Invalid playback cache dimensions or capacity");
	const frameBytes = width * height * 4;
	const capacity = Math.min(maxFrames, Math.floor(maxBytes / frameBytes));
	if (!Number.isInteger(frames) || frames < 1 || capacity < 1)
		throw new Error("预览画面超过解码缓存容量");
	const bitmaps = new Map<number, ImageBitmap>();
	const listeners = new Set<() => void>();
	const controller = new AbortController();
	let target = 0;
	const pending = new Map<number, AbortController>();
	let pumping = false;
	let error: Error | undefined;
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const wanted = ({ frame }: { frame: number }) =>
		frame >= target && frame < Math.min(frames, target + capacity);
	const evict = () => {
		for (const [frame, bitmap] of bitmaps) {
			if (wanted({ frame })) continue;
			bitmap.close();
			bitmaps.delete(frame);
		}
	};
	const clearBitmaps = () => {
		for (const bitmap of bitmaps.values()) bitmap.close();
		bitmaps.clear();
	};
	const load = async ({
		frame,
		requestController,
	}: {
		frame: number;
		requestController: AbortController;
	}) => {
		const signal = AbortSignal.any([
			controller.signal,
			requestController.signal,
		]);
		const release = () => {
			if (pending.get(frame) === requestController) pending.delete(frame);
		};
		try {
			const blob = await cache.read({ frame, signal });
			if (signal.aborted || !wanted({ frame })) return;
			const bitmap = await decode(blob);
			if (signal.aborted || !wanted({ frame })) {
				bitmap.close();
				return;
			}
			if (bitmap.width !== width || bitmap.height !== height) {
				bitmap.close();
				throw new Error("预览缓存画面尺寸不匹配");
			}
			release();
			bitmaps.set(frame, bitmap);
			notify();
		} catch (cause) {
			if (!signal.aborted && wanted({ frame })) {
				error = cause instanceof Error ? cause : new Error(String(cause));
				controller.abort();
				clearBitmaps();
				notify();
			}
		} finally {
			release();
			pump();
		}
	};
	function pump() {
		if (pumping || error || controller.signal.aborted) return;
		pumping = true;
		try {
			evict();
			while (
				!error &&
				!controller.signal.aborted &&
				pending.size < PLAYBACK_BITMAP_DECODE_CONCURRENCY &&
				bitmaps.size + pending.size < capacity
			) {
				let next: number | undefined;
				for (
					let frame = target;
					frame < Math.min(frames, target + capacity);
					frame++
				) {
					if (!bitmaps.has(frame) && !pending.has(frame)) {
						next = frame;
						break;
					}
				}
				if (next === undefined) break;
				// A seek cannot reclaim a slot until its old decode has actually settled.
				const requestController = new AbortController();
				pending.set(next, requestController);
				void load({ frame: next, requestController });
			}
		} finally {
			pumping = false;
		}
	}

	return {
		setTarget({ frame }: { frame: number }) {
			if (controller.signal.aborted) return;
			if (!Number.isInteger(frame) || frame < 0)
				throw new Error("Invalid playback frame");
			target = Math.max(0, Math.min(frames - 1, frame));
			for (const [pendingFrame, requestController] of pending) {
				if (!wanted({ frame: pendingFrame })) requestController.abort();
			}
			evict();
			pump();
		},
		get({ frame }: { frame: number }) {
			return bitmaps.get(frame);
		},
		subscribe({ onChange }: { onChange: () => void }) {
			listeners.add(onChange);
			return () => listeners.delete(onChange);
		},
		get error() {
			return error;
		},
		get stats() {
			const reservedFrames = bitmaps.size + pending.size;
			return {
				frames: reservedFrames,
				inFlightFrames: pending.size,
				bytes: reservedFrames * frameBytes,
				maxFrames: capacity,
				maxBytes,
			};
		},
		dispose() {
			controller.abort();
			clearBitmaps();
			listeners.clear();
		},
	};
}
