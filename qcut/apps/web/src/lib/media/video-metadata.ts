const DEFAULT_FPS = 30;

export interface VideoMetadata {
	width: number;
	height: number;
	frames?: number;
	duration?: number;
	fps?: number;
}

type SourceAssigner = (video: HTMLVideoElement) => void;

/**
 * Create an off-screen HTMLVideoElement, load its metadata, and extract video properties.
 *
 * If the DOM is unavailable (non-browser environment), resolves to `{ width: 0, height: 0 }`.
 *
 * @param assignSource - Callback that assigns a source (e.g., sets `video.src`) to the created video element before loading
 * @returns An object containing `width` and `height` in pixels; includes `duration` in seconds, an estimated `fps`, and `frames` when those values can be determined
 */
async function readMetadata(
	assignSource: SourceAssigner
): Promise<VideoMetadata> {
	if (typeof document === "undefined") {
		return { width: 0, height: 0 };
	}

	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		video.preload = "metadata";
		video.muted = true;
		video.playsInline = true;
		video.crossOrigin = "anonymous";

		let settled = false;
		const cleanup = () => {
			video.pause();
			video.removeAttribute("src");
			video.load();
		};

		const resolveWithMetadata = async () => {
			if (settled) return;
			settled = true;

			try {
				const duration = Number.isFinite(video.duration)
					? video.duration
					: undefined;
				const fps = await estimateFrameRate(video, duration);
				const frames = duration && fps ? Math.round(duration * fps) : undefined;

				resolve({
					width: video.videoWidth || 0,
					height: video.videoHeight || 0,
					duration,
					fps,
					frames,
				});
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			} finally {
				cleanup();
			}
		};

		video.onloadedmetadata = () => {
			resolveWithMetadata();
		};

		video.onerror = () => {
			if (!settled) {
				settled = true;
				cleanup();
				reject(new Error("Unable to load video metadata"));
			}
		};

		assignSource(video);
		video.load();
	});
}

/**
 * Determine the video's frame rate using multiple heuristics and a sensible fallback.
 *
 * @param video - The HTMLVideoElement to inspect for frame-rate information.
 * @param duration - Optional video duration in seconds; if provided and no measurement is available, a default FPS is used as a fallback.
 * @returns The estimated frames per second, or `undefined` if the frame rate cannot be determined.
 */
async function estimateFrameRate(
	video: HTMLVideoElement,
	duration?: number
): Promise<number | undefined> {
	const captureFrameRate = await getFrameRateFromCaptureStream(video);
	if (captureFrameRate) {
		return captureFrameRate;
	}

	const qualityFrameRate = getFrameRateFromPlaybackQuality(video, duration);
	if (qualityFrameRate) {
		return qualityFrameRate;
	}

	return duration ? DEFAULT_FPS : undefined;
}

/**
 * Attempt to obtain the video's frame rate from its media capture stream.
 *
 * @param video - The HTMLVideoElement to inspect; the function may start playback, stop any created capture track, pause the element, and reset its currentTime to 0.
 * @returns The frame rate in frames per second if found, `undefined` otherwise.
 */
async function getFrameRateFromCaptureStream(
	video: HTMLVideoElement
): Promise<number | undefined> {
	const captureStream =
		(
			video as HTMLVideoElement & {
				captureStream?: () => MediaStream;
				mozCaptureStream?: () => MediaStream;
			}
		).captureStream ||
		(video as HTMLVideoElement & { mozCaptureStream?: () => MediaStream })
			.mozCaptureStream;

	if (typeof captureStream !== "function") {
		return;
	}

	try {
		await video.play().catch(() => {});
		const stream = captureStream.call(video);
		const track = stream?.getVideoTracks?.()[0];
		const settings = track?.getSettings?.();
		const frameRate = settings?.frameRate;

		track?.stop?.();
		video.pause();
		video.currentTime = 0;

		if (frameRate && Number.isFinite(frameRate) && frameRate > 0) {
			return frameRate;
		}
	} catch {
		// Ignore capture failures and fall back to other heuristics.
	}

	return;
}

/**
 * Estimate the video's frame rate using playback-quality metrics when duration is available.
 *
 * Attempts to compute frames per second from `getVideoPlaybackQuality().totalVideoFrames`
 * or vendor-specific decoded frame counters; returns `undefined` if duration is missing
 * or no usable frame count can be obtained.
 *
 * @param video - The HTMLVideoElement to inspect for playback quality metrics
 * @param duration - The video's duration in seconds used to convert total decoded frames into FPS
 * @returns The estimated frames per second, or `undefined` if it cannot be determined
 */
function getFrameRateFromPlaybackQuality(
	video: HTMLVideoElement,
	duration?: number
): number | undefined {
	if (!duration || duration <= 0) {
		return;
	}

	const sanitize = (value?: number) =>
		value && Number.isFinite(value) && value > 0 ? value : undefined;

	try {
		const quality = (
			video as HTMLVideoElement & {
				getVideoPlaybackQuality?: () => VideoPlaybackQuality;
			}
		).getVideoPlaybackQuality?.();

		const totalFrames =
			quality?.totalVideoFrames ??
			(video as HTMLVideoElement & { webkitDecodedFrameCount?: number })
				.webkitDecodedFrameCount ??
			(video as HTMLVideoElement & { mozDecodedFrames?: number })
				.mozDecodedFrames;

		const fps = totalFrames ? totalFrames / duration : undefined;
		return sanitize(fps);
	} catch {
		return;
	}
}

/**
 * Extracts video metadata from a File by loading it into a temporary in-memory video element.
 *
 * @param file - The video File to analyze (e.g., from an <input type="file">).
 * @returns Video metadata including `width` and `height`; includes `duration`, `fps`, and `frames` when they can be determined.
 */
export async function extractVideoMetadataFromFile(
	file: File
): Promise<VideoMetadata> {
	if (typeof window === "undefined") {
		return { width: 0, height: 0 };
	}

	const objectUrl = URL.createObjectURL(file);
	try {
		return await readMetadata((video) => {
			video.src = objectUrl;
		});
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

/**
 * Retrieve metadata (dimensions, duration, frame rate, and frame count) for a video at the given URL.
 *
 * @param url - The URL of the video resource to inspect
 * @returns The video's metadata: `width` and `height`, and when available `duration`, `fps`, and `frames`. If executed outside a browser environment, returns `width: 0` and `height: 0`.
 */
export async function extractVideoMetadataFromUrl(
	url: string
): Promise<VideoMetadata> {
	if (typeof window === "undefined") {
		return { width: 0, height: 0 };
	}

	return readMetadata((video) => {
		video.src = url;
	});
}
