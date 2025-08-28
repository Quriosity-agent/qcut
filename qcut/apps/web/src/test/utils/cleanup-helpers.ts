import { vi } from "vitest";

/**
 * Track all created blob URLs for cleanup
 */
const createdBlobUrls = new Set<string>();

/**
 * Mock URL.createObjectURL to track blob URLs
 */
export function setupBlobUrlTracking() {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:http://localhost:3000/${Math.random().toString(36).substring(2)}`;
    createdBlobUrls.add(url);
    return url;
  });

  URL.revokeObjectURL = vi.fn((url: string) => {
    createdBlobUrls.delete(url);
  });

  return () => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  };
}

/**
 * Clean up all blob URLs created during tests
 */
export function cleanupBlobUrls(urls?: string[]) {
  const urlsToClean = urls || Array.from(createdBlobUrls);

  urlsToClean.forEach((url) => {
    if (url?.startsWith("blob:")) {
      URL.revokeObjectURL(url);
      createdBlobUrls.delete(url);
    }
  });

  // Also clean up any blob URLs in the DOM
  const elements = document.querySelectorAll('[src^="blob:"], [href^="blob:"]');
  elements.forEach((element) => {
    const url = element.getAttribute("src") || element.getAttribute("href");
    if (url?.startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  });
}

/**
 * Get count of active blob URLs (for memory leak detection)
 */
export function getActiveBlobUrlCount(): number {
  return createdBlobUrls.size;
}
