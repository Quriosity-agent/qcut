const DEFAULT_FPS = 30;

export interface VideoMetadata {
  width: number;
  height: number;
  frames?: number;
  duration?: number;
  fps?: number;
}

type SourceAssigner = (video: HTMLVideoElement) => void;

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
        const frames =
          duration && fps ? Math.round(duration * fps) : undefined;

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
      void resolveWithMetadata();
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

async function getFrameRateFromCaptureStream(
  video: HTMLVideoElement
): Promise<number | undefined> {
  const captureStream =
    (video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    }).captureStream ||
    (video as HTMLVideoElement & { mozCaptureStream?: () => MediaStream })
      .mozCaptureStream;

  if (typeof captureStream !== "function") {
    return undefined;
  }

  try {
    await video.play().catch(() => undefined);
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

  return undefined;
}

function getFrameRateFromPlaybackQuality(
  video: HTMLVideoElement,
  duration?: number
): number | undefined {
  if (!duration || duration <= 0) {
    return undefined;
  }

  const sanitize = (value?: number) =>
    value && Number.isFinite(value) && value > 0 ? value : undefined;

  try {
    const quality = (video as HTMLVideoElement & {
      getVideoPlaybackQuality?: () => VideoPlaybackQuality;
    }).getVideoPlaybackQuality?.();

    const totalFrames =
      quality?.totalVideoFrames ??
      (video as HTMLVideoElement & { webkitDecodedFrameCount?: number })
        .webkitDecodedFrameCount ??
      (video as HTMLVideoElement & { mozDecodedFrames?: number })
        .mozDecodedFrames;

    const fps = totalFrames ? totalFrames / duration : undefined;
    return sanitize(fps);
  } catch {
    return undefined;
  }
}

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
