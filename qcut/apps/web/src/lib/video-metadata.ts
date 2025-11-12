const DEFAULT_FPS = 30;

export interface VideoMetadata {
  width: number;
  height: number;
  frames?: number;
  duration?: number;
  fps?: number;
}

type SourceAssigner = (video: HTMLVideoElement) => void;

async function readMetadata(assignSource: SourceAssigner): Promise<VideoMetadata> {
  if (typeof document === "undefined") {
    return { width: 0, height: 0 };
  }

  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    const cleanup = () => {
      video.src = "";
      video.removeAttribute("src");
      video.load();
    };

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration)
        ? video.duration
        : undefined;
      const fps = duration ? DEFAULT_FPS : undefined;
      const frames =
        duration && fps ? Math.round(duration * fps) : undefined;

      cleanup();
      resolve({
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        duration,
        fps,
        frames,
      });
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("Unable to load video metadata"));
    };

    assignSource(video);
    video.load();
  });
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
