/**
 * Media Store Helpers
 *
 * Pure helper functions for media processing: file type detection,
 * image dimensions, video thumbnails, duration extraction, and
 * aspect ratio calculation.
 *
 * @module stores/media/media-store-helpers
 */

import {
	createObjectURL,
	revokeObjectURL,
	getOrCreateObjectURL,
} from "@/lib/media/blob-manager";
import type { MediaItem, MediaType } from "./media-store-types";

/** Revoke a media blob URL with a scoped context label. */
export const revokeMediaBlob = (url: string, context: string): boolean => {
	if (!url) return false;
	return revokeObjectURL(url, `media-store:${context}`);
};

/** Determine the MediaType from a File's MIME type. Returns null for unsupported types. */
export const getFileType = (file: File): MediaType | null => {
	const { type } = file;

	if (type.startsWith("image/")) {
		return "image";
	}
	if (type.startsWith("video/")) {
		return "video";
	}
	if (type.startsWith("audio/")) {
		return "audio";
	}

	return null;
};

/** Get image dimensions by loading a File into an HTMLImageElement. */
export const getImageDimensions = (
	file: File
): Promise<{ width: number; height: number }> => {
	return new Promise((resolve, reject) => {
		const img = new window.Image();
		const blobUrl = createObjectURL(file, "getImageDimensions");

		const cleanup = () => {
			img.remove();
			if (blobUrl) {
				revokeMediaBlob(blobUrl, "getImageDimensions");
			}
		};

		img.addEventListener("load", () => {
			const width = img.naturalWidth;
			const height = img.naturalHeight;
			cleanup();
			resolve({ width, height });
		});

		img.addEventListener("error", () => {
			cleanup();
			reject(new Error("Could not load image"));
		});

		img.src = blobUrl;
	});
};

/**
 * Clone a File to create an isolated instance for temporary operations.
 * This prevents ERR_UPLOAD_FILE_CHANGED when blob URLs are revoked.
 *
 * When multiple blob URLs are created from the same File instance and some
 * are revoked, Chromium may invalidate the File's snapshot, causing other
 * blob URLs from the same File to fail with ERR_UPLOAD_FILE_CHANGED.
 *
 * By cloning the File, temporary operations (thumbnail/duration extraction)
 * use a separate File instance, isolating the display URL from side effects.
 */
export const cloneFileForTemporaryUse = (file: File): File => {
	return new File([file], file.name, {
		type: file.type,
		lastModified: file.lastModified,
	});
};

/** Generate a video thumbnail using browser APIs (primary method). */
export const generateVideoThumbnailBrowser = (
	file: File
): Promise<{ thumbnailUrl: string; width: number; height: number }> => {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video") as HTMLVideoElement;
		const canvas = document.createElement("canvas") as HTMLCanvasElement;
		const ctx = canvas.getContext("2d");

		if (!ctx) {
			reject(new Error("Could not get canvas context"));
			return;
		}

		let blobUrl: string;
		let cleanupScheduled = false;

		const cleanup = () => {
			if (cleanupScheduled) return; // Prevent double cleanup
			cleanupScheduled = true;

			// Explicitly release the video source to prevent race conditions
			// This tells the browser to release its reference to the blob URL
			video.src = "";
			video.load();

			// Remove elements immediately
			video.remove();
			canvas.remove();

			// Delay blob URL revocation to allow browser to process the release
			if (blobUrl) {
				setTimeout(() => {
					revokeMediaBlob(blobUrl, "generateVideoThumbnailBrowser");
				}, 50); // Shorter delay sufficient after explicit source release
			}
		};

		// Set timeout to prevent hanging
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("Video thumbnail generation timed out"));
		}, 10_000);

		video.addEventListener("loadedmetadata", () => {
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;

			// Seek to 1 second or 10% of duration, whichever is smaller
			video.currentTime = Math.min(1, video.duration * 0.1);
		});

		video.addEventListener("seeked", () => {
			try {
				clearTimeout(timeout);
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
				const thumbnailUrl = canvas.toDataURL("image/jpeg", 0.8);
				const width = video.videoWidth;
				const height = video.videoHeight;

				resolve({ thumbnailUrl, width, height });
				cleanup();
			} catch (drawError) {
				cleanup();
				reject(
					new Error(
						`Canvas drawing failed: ${drawError instanceof Error ? drawError.message : String(drawError)}`
					)
				);
			}
		});

		video.addEventListener("error", (event) => {
			clearTimeout(timeout);
			cleanup();
			reject(
				new Error(
					`Video loading failed: ${video.error?.message || "Unknown error"}`
				)
			);
		});

		try {
			blobUrl = createObjectURL(file, "processVideoFile");
			video.src = blobUrl;
			video.load();
		} catch (urlError) {
			clearTimeout(timeout);
			cleanup();
			reject(
				new Error(
					`Failed to create object URL: ${urlError instanceof Error ? urlError.message : String(urlError)}`
				)
			);
		}
	});
};

/** Get the duration of a media file using browser APIs. */
export const getMediaDuration = (file: File): Promise<number> => {
	return new Promise((resolve, reject) => {
		const element = document.createElement(
			file.type.startsWith("video/") ? "video" : "audio"
		) as HTMLMediaElement;
		let blobUrl: string | null = null;
		let cleanupTimeout: number | null = null;

		const cleanup = () => {
			if (cleanupTimeout) {
				clearTimeout(cleanupTimeout);
				cleanupTimeout = null;
			}
			element.remove();
			if (blobUrl) {
				// Delay cleanup to prevent timing conflicts
				setTimeout(() => {
					revokeMediaBlob(blobUrl!, "getMediaDuration");
				}, 100);
			}
		};

		// Set a reasonable timeout for media loading
		const timeoutId = setTimeout(() => {
			console.warn("[getMediaDuration] Timeout loading media:", file.name);
			cleanup();
			reject(new Error("Media loading timeout"));
		}, 10_000);

		element.addEventListener("loadedmetadata", () => {
			clearTimeout(timeoutId);
			const duration = element.duration;
			if (isNaN(duration) || duration <= 0) {
				cleanup();
				reject(new Error("Invalid media duration"));
				return;
			}

			// Delay cleanup to allow other processes to finish using the blob URL
			cleanupTimeout = window.setTimeout(() => {
				cleanup();
				resolve(duration);
			}, 50);
		});

		element.addEventListener("error", (e) => {
			clearTimeout(timeoutId);
			console.warn("[getMediaDuration] Media loading failed:", e);
			cleanup();
			reject(new Error("Could not load media"));
		});

		blobUrl = createObjectURL(file, "getMediaDuration");
		element.src = blobUrl;
		element.load();
	});
};

/** Get the aspect ratio of a media item, defaulting to 16:9. */
export const getMediaAspectRatio = (item: MediaItem): number => {
	if (item.width && item.height) {
		return item.width / item.height;
	}
	return 16 / 9; // Default aspect ratio
};
