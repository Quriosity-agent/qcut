/**
 * Centralized BlobURL manager to prevent memory leaks
 * Automatically tracks and cleans up blob URLs
 *
 * Supports two modes:
 * - createObjectURL: Creates unique URL each time (for temporary operations)
 * - getOrCreateObjectURL: Returns cached URL if file already has one (for display/playback)
 */

interface BlobEntry {
  url: string;
  file: File | Blob;
  createdAt: number;
  source?: string;
  refCount: number; // Track how many consumers are using this URL
}

const nativeRevokeObjectURL = URL.revokeObjectURL;

class BlobManager {
  private blobs = new Map<string, BlobEntry>();
  private cleanupInterval: number | null = null;
  private exportLockCount = 0;

  // WeakMap for File instance-based caching (avoids hash collisions)
  // Only works when same File object is passed (not copies)
  private fileToUrl = new WeakMap<File | Blob, string>();

  // Fallback cache using file properties for when File instances differ
  // Key format: "size-name-lastModified"
  private fileKeyToUrl = new Map<string, string>();

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
   * Generate a key for file-based caching (fallback when WeakMap misses).
   *
   * NOTE: We intentionally exclude lastModified because it changes when OPFS
   * reads the file, causing cache misses for the same logical file.
   *
   * Collision risk: Different files with identical name+size could collide.
   * This is mitigated by:
   * 1. WeakMap (fileToUrl) is checked first for exact instance matches
   * 2. In video editor workflows, same-name+same-size different-content files are rare
   * 3. Content hashing would be too expensive for large video files
   */
  private getFileKey(file: File | Blob): string {
    const name = (file as File).name || "blob";
    return `${file.size}-${name}`;
  }

  /**
   * Get existing URL for file if available, or create new one.
   * Use this for long-lived URLs (display, playback) to avoid duplicates.
   *
   * @param file - The file to create/get URL for
   * @param source - Identifier for debugging (e.g., "storage-service")
   * @returns Blob URL (may be reused from cache)
   */
  getOrCreateObjectURL(file: File | Blob, source?: string): string {
    // First, try WeakMap (exact instance match)
    const existingFromWeakMap = this.fileToUrl.get(file);
    if (existingFromWeakMap && this.blobs.has(existingFromWeakMap)) {
      const entry = this.blobs.get(existingFromWeakMap)!;
      entry.refCount++;

      if (import.meta.env.DEV) {
        console.log(
          `[BlobManager] ♻️ Reusing URL (instance match): ${(file as File).name || "blob"}`
        );
        console.log(`  📍 Original source: ${entry.source}`);
        console.log(`  🔄 Requested by: ${source}`);
        console.log(`  📊 Ref count: ${entry.refCount}`);
      }

      return existingFromWeakMap;
    }

    // Second, try file key cache (property-based match)
    const fileKey = this.getFileKey(file);
    const existingFromKeyCache = this.fileKeyToUrl.get(fileKey);
    if (existingFromKeyCache && this.blobs.has(existingFromKeyCache)) {
      const entry = this.blobs.get(existingFromKeyCache)!;
      entry.refCount++;

      // Also add to WeakMap for faster future lookups with this instance
      this.fileToUrl.set(file, existingFromKeyCache);

      if (import.meta.env.DEV) {
        console.log(
          `[BlobManager] ♻️ Reusing URL (key match): ${(file as File).name || "blob"}`
        );
        console.log(`  📍 Original source: ${entry.source}`);
        console.log(`  🔄 Requested by: ${source}`);
        console.log(`  📊 Ref count: ${entry.refCount}`);
        console.log(`  🔑 File key: ${fileKey}`);
      }

      return existingFromKeyCache;
    }

    // No existing URL found, create new one
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
      refCount: 1,
    });

    // Add to both caches
    this.fileToUrl.set(file, url);
    this.fileKeyToUrl.set(fileKey, url);

    if (import.meta.env.DEV) {
      console.log(`[BlobManager] 🟢 Created (cached): ${url}`);
      console.log(`  📍 Source: ${callerStack}`);
      console.log(
        `  📦 Type: ${file.constructor.name}, Size: ${file.size} bytes`
      );
      console.log(`  🔑 File key: ${fileKey}`);
    }

    return url;
  }

  /**
   * Create a tracked blob URL that will be automatically cleaned up.
   * Always creates a NEW URL - use for temporary operations that revoke immediately.
   *
   * For long-lived URLs, use getOrCreateObjectURL() instead.
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
      refCount: 1,
    });

    if (import.meta.env.DEV) {
      console.log(`[BlobManager] 🟢 Created (unique): ${url}`);
      console.log(`  📍 Source: ${callerStack}`);
      console.log(
        `  📦 Type: ${file.constructor.name}, Size: ${file.size} bytes`
      );
    }

    return url;
  }

  /**
   * Release a reference to a cached blob URL.
   * Only actually revokes when refCount reaches 0.
   * Use this for URLs obtained via getOrCreateObjectURL().
   *
   * @param url - The blob URL to release
   * @param context - Identifier for debugging
   * @returns true if released successfully
   */
  releaseObjectURL(url: string, context?: string): boolean {
    const entry = this.blobs.get(url);
    if (!entry) {
      if (import.meta.env.DEV) {
        console.warn(
          `[BlobManager] ⚠️ Attempted to release unknown URL: ${url}`
        );
      }
      return false;
    }

    entry.refCount--;

    if (import.meta.env.DEV) {
      console.log(`[BlobManager] 📉 Released: ${url}`);
      console.log(`  📍 Created by: ${entry.source}`);
      console.log(`  🔄 Released by: ${context || "unknown"}`);
      console.log(`  📊 Remaining refs: ${entry.refCount}`);
    }

    if (entry.refCount <= 0) {
      // Actually revoke - no more references
      this.forceRevokeInternal(url, entry, context);
    }

    return true;
  }

  /**
   * Internal method to force revoke and clean up caches
   */
  private forceRevokeInternal(
    url: string,
    entry: BlobEntry,
    context?: string
  ): void {
    nativeRevokeObjectURL(url);
    this.blobs.delete(url);

    // Remove from file key cache
    const fileKey = this.getFileKey(entry.file);
    if (this.fileKeyToUrl.get(fileKey) === url) {
      this.fileKeyToUrl.delete(fileKey);
    }

    // Note: WeakMap entry will be GC'd automatically when File is GC'd

    if (import.meta.env.DEV) {
      console.log(`[BlobManager] 🔴 Revoked (no refs): ${url}`);
      console.log(`  🕒 Lifespan: ${Date.now() - entry.createdAt}ms`);
      if (context) {
        console.log(`  🏷️ Context: ${context}`);
      }
    }
  }

  /**
   * Manually revoke a blob URL immediately (ignores refCount).
   * Use for temporary URLs created with createObjectURL().
   * For cached URLs, prefer releaseObjectURL() instead.
   */
  revokeObjectURL(url: string, context?: string): boolean {
    const contextTag = context ? ` [from: ${context}]` : "";

    if (this.blobs.has(url)) {
      const entry = this.blobs.get(url)!;

      if (import.meta.env.DEV) {
        const revokeStack = new Error(
          "Stack trace for blob URL revocation"
        ).stack
          ?.split("\n")
          .slice(2, 4)
          .join("  ޚ  ")
          .trim();
        console.log(`[BlobManager] 🔴 Force revoked: ${url}`);
        console.log(`  📍 Created by: ${entry.source || "unknown"}`);
        console.log(`  🗑️ Revoked by: ${revokeStack}`);
        console.log(`  🕒 Lifespan: ${Date.now() - entry.createdAt}ms`);
        console.log(`  📊 Had refs: ${entry.refCount}`);
        if (contextTag) {
          console.log(`  🏷️ Context:${contextTag}`);
        }
      }

      this.forceRevokeInternal(url, entry, context);
      return true;
    }
    // Even if we didn't create it, respect the in-use guard before revoking
    nativeRevokeObjectURL(url);
    return true;
  }

  /**
   * Clean up blobs older than maxAge (default: 10 minutes)
   * Skips cleanup if export is in progress to prevent ERR_FILE_NOT_FOUND errors.
   * Also respects refCount to never revoke URLs that are actively in use.
   */
  private cleanupOldBlobs(maxAge = 10 * 60 * 1000): void {
    // Skip cleanup entirely if export is in progress
    if (this.exportLockCount > 0) {
      if (import.meta.env.DEV) {
        console.log(
          "[BlobManager] ⏸️ Skipping auto-cleanup - export in progress"
        );
      }
      return;
    }

    const now = Date.now();

    for (const [url, entry] of this.blobs.entries()) {
      // Only cleanup if old AND no active references (safety check)
      if (now - entry.createdAt > maxAge && entry.refCount <= 0) {
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

  /**
   * Lock blob URLs from auto-cleanup during export.
   * Call this before starting an export operation.
   * Uses a counter to support nested/concurrent exports.
   */
  lockForExport(): void {
    this.exportLockCount++;
    if (import.meta.env.DEV) {
      console.log(
        `[BlobManager] 🔒 Export lock acquired (count: ${this.exportLockCount})`
      );
    }
  }

  /**
   * Release export lock. Call after export completes or fails.
   * Uses try/finally in caller to ensure this is always called.
   */
  unlockFromExport(): void {
    this.exportLockCount = Math.max(0, this.exportLockCount - 1);
    if (import.meta.env.DEV) {
      console.log(
        `[BlobManager] 🔓 Export lock released (count: ${this.exportLockCount})`
      );
    }
  }

  /**
   * Check if export is in progress (blob URLs should not be auto-cleaned)
   */
  isExportLocked(): boolean {
    return this.exportLockCount > 0;
  }
}

// Global singleton instance
export const blobManager = new BlobManager();

// Convenience exports that use the managed instance
export const createObjectURL = (file: File | Blob, source?: string): string => {
  return blobManager.createObjectURL(file, source);
};

export const revokeObjectURL = (url: string, context?: string): boolean => {
  return blobManager.revokeObjectURL(url, context);
};

// NEW: For long-lived URLs (display, playback) - returns cached URL if available
export const getOrCreateObjectURL = (
  file: File | Blob,
  source?: string
): string => {
  return blobManager.getOrCreateObjectURL(file, source);
};

// NEW: For releasing refs (instead of immediate revoke) - only revokes when refCount reaches 0
export const releaseObjectURL = (url: string, context?: string): boolean => {
  return blobManager.releaseObjectURL(url, context);
};

// Export lock functions - prevent auto-cleanup during export operations
export const lockForExport = (): void => {
  blobManager.lockForExport();
};

export const unlockFromExport = (): void => {
  blobManager.unlockFromExport();
};

export const isExportLocked = (): boolean => {
  return blobManager.isExportLocked();
};

// Development helper to monitor blob usage
if (import.meta.env.DEV) {
  (window as any).debugBlobs = () => {
    const stats = blobManager.getStats();
    console.log("[BlobManager] Stats:", stats);
    console.log("[BlobManager] Active blobs:", blobManager.getActiveBlobs());
  };
}
