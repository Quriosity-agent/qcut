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
} from "@/lib/media/blob-manager";
import type { MediaItem, MediaType } from "./media-store-types";

const THUMBNAIL_GENERATION_TIMEOUT_MS = 15_000;
const SEEK_TIMEOUT_MS = 2_500;
const THUMBNAIL_JPEG_QUALITY = 0.82;
const FRAME_BRIGHTNESS_THRESHOLD = 14;
const FRAME_NON_BLACK_THRESHOLD = 0.08;
const THUMBNAIL_TIME_CANDIDATE_RATIOS = [0.2, 0.35, 0.5, 0.7, 0.85] as const;
const THUMBNAIL_TIME_ABSOLUTE_FALLBACKS = [1, 2, 0] as const;

interface FrameQuality {
	averageBrightness: number;
	nonBlackRatio: number;
	score: number;
}

const isFinitePositiveNumber = (value: number): boolean =>
	Number.isFinite(value) && value > 0;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

const isUsableFrame = (quality: FrameQuality): boolean =>
	quality.averageBrightness >= FRAME_BRIGHTNESS_THRESHOLD &&
	quality.nonBlackRatio >= FRAME_NON_BLACK_THRESHOLD;

const buildThumbnailCandidateTimes = (duration: number): number[] => {
	if (!isFinitePositiveNumber(duration)) {
		return [0];
	}

	const safeUpperBound = Math.max(duration - 0.05, 0);
	const candidateTimes = [
		...THUMBNAIL_TIME_CANDIDATE_RATIOS.map((ratio) => duration * ratio),
		...THUMBNAIL_TIME_ABSOLUTE_FALLBACKS,
	].map((time) => clamp(time, 0, safeUpperBound));

	const deduplicated: number[] = [];
	for (const candidate of candidateTimes) {
		const alreadyAdded = deduplicated.some(
			(existing) => Math.abs(existing - candidate) < 0.05
		);
		if (!alreadyAdded) {
			deduplicated.push(candidate);
		}
	}

	return deduplicated.length > 0 ? deduplicated : [0];
};

const seekVideoToTime = async ({
	video,
	targetTime,
}: {
	video: HTMLVideoElement;
	targetTime: number;
}): Promise<void> => {
	const safeTarget = Math.max(0, targetTime);
	if (Math.abs(video.currentTime - safeTarget) < 0.001) {
		return;
	}

	await new Promise<void>((resolve, reject) => {
		let timeoutId: number | null = null;

		const cleanup = () => {
			video.removeEventListener("seeked", onSeeked);
			video.removeEventListener("error", onError);
			if (timeoutId !== null) {
				window.clearTimeout(timeoutId);
				timeoutId = null;
			}
		};

		const onSeeked = () => {
			cleanup();
			resolve();
		};

		const onError = () => {
			cleanup();
			reject(new Error("Failed while seeking video frame"));
		};

		timeoutId = window.setTimeout(() => {
			cleanup();
			reject(new Error("Video seek timed out"));
		}, SEEK_TIMEOUT_MS);

		video.addEventListener("seeked", onSeeked);
		video.addEventListener("error", onError);
		video.currentTime = safeTarget;
	});
};

const analyzeFrameQuality = ({
	video,
	analysisCanvas,
	analysisCtx,
}: {
	video: HTMLVideoElement;
	analysisCanvas: HTMLCanvasElement;
	analysisCtx: CanvasRenderingContext2D;
}): FrameQuality => {
	try {
		const sampleWidth = 32;
		const sampleHeight = 18;
		analysisCanvas.width = sampleWidth;
		analysisCanvas.height = sampleHeight;
		analysisCtx.drawImage(video, 0, 0, sampleWidth, sampleHeight);

		const imageData = analysisCtx.getImageData(0, 0, sampleWidth, sampleHeight);
		const pixelData = imageData.data;

		if (pixelData.length === 0) {
			return {
				averageBrightness: 255,
				nonBlackRatio: 1,
				score: 255,
			};
		}

		let totalBrightness = 0;
		let nonBlackPixels = 0;
		const totalPixels = pixelData.length / 4;

		for (let index = 0; index < pixelData.length; index += 4) {
			const red = pixelData[index];
			const green = pixelData[index + 1];
			const blue = pixelData[index + 2];
			const brightness = (red + green + blue) / 3;
			totalBrightness += brightness;
			if (brightness > 16) {
				nonBlackPixels += 1;
			}
		}

		const averageBrightness = totalBrightness / totalPixels;
		const nonBlackRatio = nonBlackPixels / totalPixels;

		return {
			averageBrightness,
			nonBlackRatio,
			score: averageBrightness * 0.7 + nonBlackRatio * 255 * 0.3,
		};
	} catch {
		return {
			averageBrightness: 255,
			nonBlackRatio: 1,
			score: 255,
		};
	}
};

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
		const analysisCanvas = document.createElement("canvas") as HTMLCanvasElement;
		const ctx = canvas.getContext("2d");
		const analysisCtx = analysisCanvas.getContext("2d");

		if (!ctx || !analysisCtx) {
			reject(new Error("Could not get canvas context"));
			return;
		}

		let blobUrl = "";
		let cleanupScheduled = false;
		let finished = false;
		let timeoutId: number | null = null;

		const cleanup = () => {
			if (cleanupScheduled) return; // Prevent double cleanup
			cleanupScheduled = true;

			if (timeoutId !== null) {
				window.clearTimeout(timeoutId);
				timeoutId = null;
			}

			// Explicitly release the video source to prevent race conditions
			// This tells the browser to release its reference to the blob URL
			video.src = "";
			video.load();

			// Remove elements immediately
			video.remove();
			canvas.remove();
			analysisCanvas.remove();

			// Delay blob URL revocation to allow browser to process the release
			if (blobUrl) {
				setTimeout(() => {
					revokeMediaBlob(blobUrl, "generateVideoThumbnailBrowser");
				}, 50); // Shorter delay sufficient after explicit source release
			}
		};

		const resolveOnce = (value: {
			thumbnailUrl: string;
			width: number;
			height: number;
		}) => {
			if (finished) return;
			finished = true;
			resolve(value);
			cleanup();
		};

		const rejectOnce = (error: Error) => {
			if (finished) return;
			finished = true;
			reject(error);
			cleanup();
		};

		// Set timeout to prevent hanging
		timeoutId = window.setTimeout(() => {
			rejectOnce(new Error("Video thumbnail generation timed out"));
		}, THUMBNAIL_GENERATION_TIMEOUT_MS);

		video.addEventListener("loadedmetadata", async () => {
			try {
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;

				const candidateTimes = buildThumbnailCandidateTimes(video.duration);
				let bestFrame:
					| {
							thumbnailUrl: string;
							width: number;
							height: number;
							score: number;
					  }
					| undefined;

				const processCandidateAtIndex = async (
					index: number
				): Promise<void> => {
					if (finished) {
						return;
					}
					if (index >= candidateTimes.length) {
						if (bestFrame) {
							resolveOnce({
								thumbnailUrl: bestFrame.thumbnailUrl,
								width: bestFrame.width,
								height: bestFrame.height,
							});
							return;
						}
						rejectOnce(new Error("Could not capture a usable video frame"));
						return;
					}

					try {
						await seekVideoToTime({
							video,
							targetTime: candidateTimes[index],
						});
						ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

						const frameQuality = analyzeFrameQuality({
							video,
							analysisCanvas,
							analysisCtx,
						});
						const frameDataUrl = canvas.toDataURL(
							"image/jpeg",
							THUMBNAIL_JPEG_QUALITY
						);
						const candidateFrame = {
							thumbnailUrl: frameDataUrl,
							width: video.videoWidth,
							height: video.videoHeight,
							score: frameQuality.score,
						};

						if (!bestFrame || candidateFrame.score > bestFrame.score) {
							bestFrame = candidateFrame;
						}

						if (isUsableFrame(frameQuality)) {
							resolveOnce({
								thumbnailUrl: candidateFrame.thumbnailUrl,
								width: candidateFrame.width,
								height: candidateFrame.height,
							});
							return;
						}
					} catch {
						// Try next candidate frame on per-frame errors.
					}

					await processCandidateAtIndex(index + 1);
				};

				await processCandidateAtIndex(0);
			} catch (error) {
				rejectOnce(
					new Error(
						`Video metadata handling failed: ${error instanceof Error ? error.message : String(error)}`
					)
				);
			}
		});

		video.addEventListener("error", () => {
			rejectOnce(
				new Error(
					`Video loading failed: ${video.error?.message || "Unknown error"}`
				)
			);
		});

		try {
			blobUrl = createObjectURL(file, "processVideoFile");
			video.preload = "metadata";
			video.muted = true;
			video.playsInline = true;
			video.src = blobUrl;
			video.load();
		} catch (urlError) {
			rejectOnce(
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
				const urlToRevoke = blobUrl;
				setTimeout(() => {
					revokeMediaBlob(urlToRevoke, "getMediaDuration");
				}, 100);
			}
		};

		// Set a reasonable timeout for media loading
		const timeoutId = setTimeout(() => {
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

		element.addEventListener("error", () => {
			clearTimeout(timeoutId);
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
