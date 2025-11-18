const CSP_ALLOWED = new Set(["fal.media", "v3.fal.media", "v3b.fal.media"]);

export type VideoSource =
  | { src: string; type: "blob" }
  | { src: string; type: "remote" }
  | null;

/**
 * Picks a safe video source, preferring a local File -> blob URL, with remote
 * fallback gated by a simple CSP whitelist.
 */
export function getVideoSource(mediaItem: { file?: File; url?: string }): VideoSource {
  if (mediaItem.file) {
    console.log("[media-source] Using blob source from file", {
      name: mediaItem.file.name,
      size: mediaItem.file.size,
      type: mediaItem.file.type,
    });
    return { src: URL.createObjectURL(mediaItem.file), type: "blob" };
  }

  if (mediaItem.url) {
    try {
      const hostname = new URL(mediaItem.url).hostname;
      if (CSP_ALLOWED.has(hostname)) {
        console.log("[media-source] Using remote source", { hostname, url: mediaItem.url });
        return { src: mediaItem.url, type: "remote" };
      }
      console.warn("[media-source] Remote URL blocked by CSP whitelist", {
        hostname,
        url: mediaItem.url,
      });
    } catch {
      console.warn("[media-source] Invalid mediaItem.url, cannot parse hostname", {
        url: mediaItem.url,
      });
    }
  }

  console.warn("[media-source] No playable source available (no file, URL blocked or missing)");
  return null;
}
