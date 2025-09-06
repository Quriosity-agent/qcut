/**
 * Debug utility to track blob URL creation and catch sources of blob URL errors
 * This helps identify where blob URLs are still being created after our fixes
 */

let originalCreateObjectURL: typeof URL.createObjectURL;
let originalRevokeObjectURL: typeof URL.revokeObjectURL;
let blobUrlTracker = new Map<string, { source: string; created: Date }>();

export function enableBlobUrlDebugging() {
  if (originalCreateObjectURL) {
    console.log("[BlobUrlDebug] Already enabled");
    return;
  }

  // Store original functions
  originalCreateObjectURL = URL.createObjectURL;
  originalRevokeObjectURL = URL.revokeObjectURL;

  // Override createObjectURL to track creation
  URL.createObjectURL = function(object: File | Blob | MediaSource) {
    const url = originalCreateObjectURL.call(this, object);
    
    // Get stack trace to identify source
    const stack = new Error().stack || 'Unknown source';
    const source = stack.split('\n').slice(2, 4).join(' → ').trim();
    
    blobUrlTracker.set(url, {
      source,
      created: new Date(),
    });
    
    console.log(`[BlobUrlDebug] Created: ${url}`, {
      source,
      objectType: object.constructor.name,
      size: object instanceof File ? object.size : 'unknown',
    });
    
    return url;
  };

  // Override revokeObjectURL to track cleanup
  URL.revokeObjectURL = function(url: string) {
    const tracked = blobUrlTracker.get(url);
    if (tracked) {
      blobUrlTracker.delete(url);
      console.log(`[BlobUrlDebug] Revoked: ${url}`, {
        source: tracked.source,
        lifespan: Date.now() - tracked.created.getTime() + 'ms',
      });
    } else {
      console.log(`[BlobUrlDebug] Revoked untracked: ${url}`);
    }
    
    return originalRevokeObjectURL.call(this, url);
  };

  console.log("[BlobUrlDebug] Blob URL debugging enabled");
}

export function disableBlobUrlDebugging() {
  if (originalCreateObjectURL) {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    originalCreateObjectURL = undefined as any;
    originalRevokeObjectURL = undefined as any;
    console.log("[BlobUrlDebug] Blob URL debugging disabled");
  }
}

export function getBlobUrlReport() {
  console.log(`[BlobUrlDebug] Active blob URLs: ${blobUrlTracker.size}`);
  for (const [url, info] of blobUrlTracker.entries()) {
    console.log(`  ${url} - ${info.source} (${Date.now() - info.created.getTime()}ms ago)`);
  }
  return Array.from(blobUrlTracker.entries());
}

// Auto-enable in development
if (import.meta.env.DEV) {
  enableBlobUrlDebugging();
  
  // Add to global for easy access in console
  (window as any).blobUrlDebug = {
    enable: enableBlobUrlDebugging,
    disable: disableBlobUrlDebugging,
    report: getBlobUrlReport,
  };
}