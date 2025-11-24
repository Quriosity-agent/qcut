/**
 * Centralized BlobURL manager to prevent memory leaks
 * Automatically tracks and cleans up blob URLs
 */

interface BlobEntry {
  url: string;
  file: File | Blob;
  createdAt: number;
  source?: string;
}

const nativeRevokeObjectURL = URL.revokeObjectURL;

class BlobManager {
  private blobs = new Map<string, BlobEntry>();
  private cleanupInterval: number | null = null;
  // Track blob URLs that are actively in use (e.g., currently playing video) to avoid revoking them mid-use.
  private inUseUrls = new Set<string>();

  constructor() {
    // Auto-cleanup orphaned blobs every 5 minutes
    // Only set up cleanup if we have a window environment
    if (typeof window !== "undefined" && window.setInterval) {
      this.cleanupInterval = window.setInterval(
        () => {
          this.cleanupOldBlobs();
        },
        5 * 60 * 1000
      );
    }
  }

  /**
   * Create a tracked blob URL that will be automatically cleaned up
   */
  createObjectURL(file: File | Blob, source?: string): string {
    const url = URL.createObjectURL(file);
    const callerStack =
      source ||
      new Error("Stack trace for blob URL creation").stack
        ?.split("\n")[2]
        ?.trim();

    this.blobs.set(url, {
      url,
      file,
      createdAt: Date.now(),
      source: callerStack,
    });

    if (import.meta.env.DEV) {
      console.log(`[BlobManager] 🟢 Created: ${url}`);
      console.log(`  📍 Source: ${callerStack}`);
      console.log(
        `  📦 Type: ${file.constructor.name}, Size: ${file.size} bytes`
      );
    }

    return url;
  }

  /**
   * Manually revoke a blob URL
   */
  revokeObjectURL(url: string): void {
    if (this.inUseUrls.has(url)) {
      if (import.meta.env.DEV) {
        console.log(`[BlobManager] ⏸ Skip revoke (in use): ${url}`);
      }
      return;
    }

    if (this.blobs.has(url)) {
      const entry = this.blobs.get(url);

      if (import.meta.env.DEV) {
        const revokeStack = new Error(
          "Stack trace for blob URL revocation"
        ).stack
          ?.split("\n")
          .slice(2, 4)
          .join(" → ")
          .trim();
        console.log(`[BlobManager] 🔴 Revoked: ${url}`);
        console.log(`  📍 Created by: ${entry?.source || "unknown"}`);
        console.log(`  🗑️ Revoked by: ${revokeStack}`);
        console.log(
          `  ⏱️ Lifespan: ${entry ? Date.now() - entry.createdAt : "unknown"}ms`
        );
      }

      nativeRevokeObjectURL(url);
      this.blobs.delete(url);
    } else {
      // Even if we didn't create it, respect the in-use guard before revoking
      nativeRevokeObjectURL(url);
    }
  }

  /**
   * Mark a blob URL as in-use to prevent cleanup while it's active.
   */
  markInUse(url: string): void {
    if (!url.startsWith("blob:")) return;
    this.inUseUrls.add(url);
  }

  /**
   * Remove the in-use mark so the URL can be revoked.
   */
  unmarkInUse(url: string): void {
    if (!url.startsWith("blob:")) return;
    this.inUseUrls.delete(url);
  }

  /**
   * Clean up blobs older than maxAge (default: 10 minutes)
   */
  private cleanupOldBlobs(maxAge = 10 * 60 * 1000): void {
    const now = Date.now();

    for (const [url, entry] of this.blobs.entries()) {
      if (now - entry.createdAt > maxAge) {
        if (import.meta.env.DEV) {
          console.warn(`[BlobManager] ⏰ Auto-revoking old blob URL: ${url}`);
          console.warn(`  📍 Created by: ${entry.source}`);
          console.warn(`  🕒 Age: ${(now - entry.createdAt) / 1000}s`);
        }
        this.revokeObjectURL(url);
      }
    }
  }

  /**
   * Get debugging information about active blobs
   */
  getActiveBlobs(): BlobEntry[] {
    return Array.from(this.blobs.values());
  }

  /**
   * Force cleanup all active blobs (use sparingly)
   */
  cleanup(): void {
    if (import.meta.env.DEV) {
      console.log(
        `[BlobManager] 🧹 Force cleanup of ${this.blobs.size} active blob URLs`
      );
    }

    for (const url of this.blobs.keys()) {
      this.revokeObjectURL(url);
    }

    if (
      this.cleanupInterval &&
      typeof window !== "undefined" &&
      window.clearInterval
    ) {
      window.clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get memory usage statistics
   */
  getStats() {
    const active = this.getActiveBlobs();
    const totalSize = active.reduce((sum, entry) => sum + entry.file.size, 0);

    return {
      activeCount: active.length,
      totalSize,
      oldestBlob:
        active.length > 0 ? Math.min(...active.map((e) => e.createdAt)) : null,
    };
  }
}

// Global singleton instance
export const blobManager = new BlobManager();

// Convenience exports that use the managed instance
export const createObjectURL = (file: File | Blob, source?: string): string => {
  return blobManager.createObjectURL(file, source);
};

export const revokeObjectURL = (url: string): void => {
  blobManager.revokeObjectURL(url);
};

export const markBlobInUse = (url: string): void => {
  blobManager.markInUse(url);
};

export const unmarkBlobInUse = (url: string): void => {
  blobManager.unmarkInUse(url);
};

// Development helper to monitor blob usage
if (import.meta.env.DEV) {
  (window as any).debugBlobs = () => {
    const stats = blobManager.getStats();
    console.log("[BlobManager] Stats:", stats);
    console.log("[BlobManager] Active blobs:", blobManager.getActiveBlobs());
  };
}
