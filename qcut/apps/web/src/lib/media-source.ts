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
    return { src: URL.createObjectURL(mediaItem.file), type: "blob" };
  }

  if (mediaItem.url) {
    try {
      if (CSP_ALLOWED.has(new URL(mediaItem.url).hostname)) {
        return { src: mediaItem.url, type: "remote" };
      }
    } catch {
      // ignore malformed URL
    }
  }

  return null;
}
