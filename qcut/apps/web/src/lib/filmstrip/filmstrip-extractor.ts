/**
 * Filmstrip frame extraction service.
 * Extracts multiple frames from a video file at specified timestamps
 * using HTML5 <video> + <canvas> for performance.
 *
 * Features:
 * - Concurrency-limited queue (max 2 jobs)
 * - AbortController support for cancellation
 * - Blob URL output at thumbnail resolution
 * - Integrates with FilmstripCache for deduplication
 */

import { filmstripCache } from "./filmstrip-cache";

const THUMBNAIL_WIDTH = 160;
const THUMBNAIL_HEIGHT = 90;
const MAX_CONCURRENT_JOBS = 2;
const SEEK_TIMEOUT_MS = 5_000;

let activeJobs = 0;
const pendingQueue: Array<() => void> = [];

function enqueue(): Promise<void> {
	if (activeJobs < MAX_CONCURRENT_JOBS) {
		activeJobs++;
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => {
		pendingQueue.push(() => {
			activeJobs++;
			resolve();
		});
	});
}

function dequeue(): void {
	activeJobs--;
	const next = pendingQueue.shift();
	if (next) next();
}

/** Seek a video element and wait for the "seeked" event */
function seekTo(
	video: HTMLVideoElement,
	time: number,
	signal?: AbortSignal,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}

		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`Seek to ${time}s timed out`));
		}, SEEK_TIMEOUT_MS);

		const onSeeked = () => {
			cleanup();
			resolve();
		};

		const onAbort = () => {
			cleanup();
			reject(new DOMException("Aborted", "AbortError"));
		};

		function cleanup() {
			clearTimeout(timeout);
			video.removeEventListener("seeked", onSeeked);
			signal?.removeEventListener("abort", onAbort);
		}

		video.addEventListener("seeked", onSeeked, { once: true });
		signal?.addEventListener("abort", onAbort, { once: true });
		video.currentTime = time;
	});
}

/** Capture current video frame to a Blob URL at thumbnail resolution */
function captureFrame(
	video: HTMLVideoElement,
	canvas: HTMLCanvasElement,
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		try {
			canvas.width = width;
			canvas.height = height;
			ctx.drawImage(video, 0, 0, width, height);
			canvas.toBlob(
				(blob) => {
					if (!blob) {
						reject(new Error("Canvas toBlob returned null"));
						return;
					}
					resolve(URL.createObjectURL(blob));
				},
				"image/jpeg",
				0.7,
			);
		} catch (err) {
			reject(err);
		}
	});
}

/** Load a video element from a File and wait for metadata */
function loadVideo(
	file: File,
	signal?: AbortSignal,
): Promise<{ video: HTMLVideoElement; blobUrl: string }> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}

		const video = document.createElement("video");
		video.preload = "auto";
		video.muted = true;
		// crossOrigin not needed for blob URLs
		const blobUrl = URL.createObjectURL(file);

		const timeout = setTimeout(() => {
			cleanup();
			URL.revokeObjectURL(blobUrl);
			reject(new Error("Video load timed out"));
		}, 10_000);

		const onLoaded = () => {
			cleanup();
			resolve({ video, blobUrl });
		};

		const onError = () => {
			cleanup();
			URL.revokeObjectURL(blobUrl);
			reject(new Error(`Video load failed: ${video.error?.message}`));
		};

		const onAbort = () => {
			cleanup();
			URL.revokeObjectURL(blobUrl);
			reject(new DOMException("Aborted", "AbortError"));
		};

		function cleanup() {
			clearTimeout(timeout);
			video.removeEventListener("loadeddata", onLoaded);
			video.removeEventListener("error", onError);
			signal?.removeEventListener("abort", onAbort);
		}

		video.addEventListener("loadeddata", onLoaded, { once: true });
		video.addEventListener("error", onError, { once: true });
		signal?.addEventListener("abort", onAbort, { once: true });
		video.src = blobUrl;
		video.load();
	});
}

export interface ExtractFramesOptions {
	file: File;
	mediaId: string;
	timestamps: number[];
	width?: number;
	height?: number;
	signal?: AbortSignal;
}

/**
 * Extract frames at specified timestamps from a video file.
 * Returns a Map of timestamp -> Blob URL.
 * Results are also stored in the shared filmstripCache.
 *
 * Timestamps that are already cached are skipped.
 */
export async function extractFrames({
	file,
	mediaId,
	timestamps,
	width = THUMBNAIL_WIDTH,
	height = THUMBNAIL_HEIGHT,
	signal,
}: ExtractFramesOptions): Promise<Map<number, string>> {
	const result = new Map<number, string>();

	// Filter out already-cached timestamps
	const needed: number[] = [];
	for (const t of timestamps) {
		const cached = filmstripCache.get(mediaId, t);
		if (cached) {
			result.set(t, cached);
		} else {
			needed.push(t);
		}
	}

	if (needed.length === 0) return result;

	// Wait for a queue slot
	await enqueue();

	let video: HTMLVideoElement | null = null;
	let blobUrl: string | null = null;

	try {
		if (signal?.aborted) {
			throw new DOMException("Aborted", "AbortError");
		}

		const loaded = await loadVideo(file, signal);
		video = loaded.video;
		blobUrl = loaded.blobUrl;

		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Could not get canvas 2d context");

		// Sort timestamps for sequential seeking (faster than random access)
		const sorted = [...needed].sort((a, b) => a - b);

		for (const time of sorted) {
			if (signal?.aborted) {
				throw new DOMException("Aborted", "AbortError");
			}

			// Clamp time to valid range
			const clampedTime = Math.max(
				0,
				Math.min(time, video.duration - 0.01),
			);

			await seekTo(video, clampedTime, signal);
			const frameUrl = await captureFrame(video, canvas, ctx, width, height);

			filmstripCache.set(mediaId, time, frameUrl);
			result.set(time, frameUrl);
		}

		canvas.remove();
	} catch (err) {
		// Re-throw abort errors, swallow others (partial results are fine)
		if (err instanceof DOMException && err.name === "AbortError") {
			throw err;
		}
		// Return whatever we have so far
	} finally {
		// Cleanup video element
		if (video) {
			video.src = "";
			video.load();
			video.remove();
		}
		if (blobUrl) {
			// Delay revocation to let browser release references
			setTimeout(() => URL.revokeObjectURL(blobUrl!), 50);
		}
		dequeue();
	}

	return result;
}
