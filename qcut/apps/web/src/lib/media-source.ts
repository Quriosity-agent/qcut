import { createObjectURL } from "@/lib/blob-manager";

const CSP_ALLOWED = new Set(["fal.media", "v3.fal.media", "v3b.fal.media"]);
const fileBlobCache = new WeakMap<File, string>();

export type VideoSource =
  | { src: string; type: "blob" }
  | { src: string; type: "remote" }
  | null;

/**
 * Picks a safe video source, preferring a local File -> blob URL, with remote
 * fallback gated by a simple CSP whitelist.
 *
 * IMPORTANT: This function creates a NEW blob URL on each call when a file is
 * provided. Callers MUST memoize the result and revoke blob URLs when they are
 * no longer needed to avoid memory leaks.
 *
 * @example
 * // Correct: memoized and revoked on cleanup
 * const source = useMemo(() => getVideoSource(mediaItem), [mediaItem]);
 * useEffect(() => () => {
 *   if (source?.type === "blob") URL.revokeObjectURL(source.src);
 * }, [source]);
 *
 * // Wrong: new blob URL every render, no cleanup
 * const source = getVideoSource(mediaItem);
 */
export function getVideoSource(mediaItem: { file?: File; url?: string }): VideoSource {
  if (mediaItem.file) {
    const cached = fileBlobCache.get(mediaItem.file);
    if (cached) {
      return { src: cached, type: "blob" };
    }
    const url = createObjectURL(mediaItem.file, "media-source:getVideoSource");
    fileBlobCache.set(mediaItem.file, url);
    return { src: url, type: "blob" };
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
