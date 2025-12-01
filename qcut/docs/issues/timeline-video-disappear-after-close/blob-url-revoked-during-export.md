# Blob URLs Revoked During Export - Issue Analysis

## 1. What is the Issue

**Summary**: Blob URLs are being prematurely revoked during video export, causing `ERR_FILE_NOT_FOUND` errors and export failures.

**Root Cause**: The `BlobManager` class has an automatic cleanup mechanism that revokes blob URLs after 10 minutes (or when `refCount` reaches 0). During export operations that can take several minutes, the following problems occur:

1. **Auto-cleanup timer**: The `cleanupOldBlobs()` function runs every 5 minutes and revokes any blob URLs older than 10 minutes, regardless of whether they're actively being used by the export process.

2. **Premature release on VideoPlayer unmount**: When the user switches views or VideoPlayer components unmount during export, the blob URLs are released (via `releaseObjectURL`). If the export still needs these URLs, they become invalid.

3. **Race condition**: The logs show blob URLs being created, used briefly (some with lifespan of only 1ms!), then immediately revoked when VideoPlayer unmounts - but the export process still references these URLs.

---

## 1.1 Detailed Export Failure Timeline (from logs)

### Phase 1: Initial Setup (~15 minutes before export)
The user loaded a project with 9 media items. Blob URLs were created for media panel display:

```
[BlobManager] 🟢 Created (cached): blob:app://./3f4af7a9-5dd8-445b-99af-0e5cb4a02fe6
  📍 Source: media-store-display
  📦 Type: File, Size: 4532884 bytes
  🔑 File key: 4532884-0d9c8747-4c26-a3e8-65a3-13859c652b4d
```

9 blob URLs were created for media items (sizes: 4.5MB, 23MB, 23MB, 1.3MB, 5.8MB, 6MB, 45.9MB, 23MB, 3.5MB).

### Phase 2: Auto-Cleanup Triggered (~15 minutes later)
The 5-minute cleanup timer ran and found URLs older than 10 minutes:

```
[BlobManager] ⏰ Auto-revoking old blob URL: blob:app://./3f4af7a9-5dd8-445b-99af-0e5cb4a02fe6
  📍 Created by: media-store-display
  🕒 Age: 895.346s                          <-- ~15 minutes old
[BlobManager] 🔴 Force revoked: blob:app://./3f4af7a9-5dd8-445b-99af-0e5cb4a02fe6
  🕒 Lifespan: 895347ms
  📊 Had refs: 1                            <-- ⚠️ STILL HAD ACTIVE REFERENCE!
```

**Critical Bug**: The cleanup revoked URLs that **still had `refCount: 1`** - an active reference was ignored.

### Phase 3: User Adds Videos to Timeline
User dragged videos to timeline, causing VideoPlayer mount/unmount cycles:

```
[TimelineTrack] Processing media item drop: Object
[BlobManager] 🟢 Created (cached): blob:app://./5d1ced17-b232-408f-b8da-234bebb5981a
  📍 Source: VideoPlayer
[VideoPlayer] Using blob URL for f166dcd6-487f-f0bc-e81d-9e4e6369c734

[VideoPlayer] Component unmount - releasing: blob:app://./5d1ced17-b232-408f-b8da-234bebb5981a
[BlobManager] 🔴 Revoked (no refs): blob:app://./5d1ced17-b232-408f-b8da-234bebb5981a
  🕒 Lifespan: 1ms                          <-- ⚠️ REVOKED AFTER ONLY 1ms!
```

VideoPlayer was mounting, creating blob URL, then immediately unmounting and revoking. This happened repeatedly.

### Phase 4: Export Starts
User clicked export. CLI FFmpeg engine was selected:

```
🎬 EXPORT HOOK - Selecting engine type:
  - isElectron(): true
  - User selected engine: cli
✅ Electron detected - letting factory auto-select FFmpeg CLI

🏗️ EXPORT ENGINE CREATION: Creating cli engine instance
✅ CLI Export Engine module loaded successfully
```

Export analysis determined Mode 1.5 (video normalization):
```
🎯 [MODE DETECTION] Direct copy eligible - 2 video(s), checking requirements...
⚠️ [MODE 1.5 DETECTION] Video 0: No properties found - triggering normalization
⚡ [MODE DETECTION] Videos have different properties - using Mode 1.5
🔍 [EXPORT ANALYSIS] Video localPath validation: Object
```

### Phase 5: Export Fails - All Blob URLs Invalid
Immediately after export started, flood of errors:

```
blob:app://./3f4af7a9-5dd8-445b-99af-0e5cb4a02fe6:1  Failed to load resource: net::ERR_FILE_NOT_FOUND
blob:app://./40f660b7-0786-46bb-8317-81b5aede7de1:1  Failed to load resource: net::ERR_FILE_NOT_FOUND
blob:app://./e871771b-63a3-4b70-a4d0-534e0222ba7d:1  Failed to load resource: net::ERR_FILE_NOT_FOUND
blob:app://./62a38787-c1b8-4585-94aa-1c15d690fd15:1  Failed to load resource: net::ERR_FILE_NOT_FOUND
blob:app://./d20c7dd2-9493-4f00-a54d-6f5c7c97e62f:1  Failed to load resource: net::ERR_FILE_NOT_FOUND
blob:app://./f8193f0e-947f-4e4f-8a68-772638071501:1  Failed to load resource: net::ERR_FILE_NOT_FOUND
blob:app://./b168cacb-2084-4670-bebe-65cca20fa93d:1  Failed to load resource: net::ERR_FILE_NOT_FOUND
blob:app://./531de73f-a091-4cb2-88b1-061ee6b5c3ae:1  Failed to load resource: net::ERR_FILE_NOT_FOUND
blob:app://./b6701690-b7aa-4540-9359-870189fe9ebf:1  Failed to load resource: net::ERR_FILE_NOT_FOUND
blob:app://./990762e1-757e-4c5b-9ae3-f06a220770ce:1  Failed to load resource: net::ERR_FILE_NOT_FOUND
```

**All 9 original blob URLs were already revoked** by the auto-cleanup. The export process tried to access them but they no longer existed.

### Phase 6: Repeated Access Attempts
The export kept trying to access the revoked URL `990762e1-757e-4c5b-9ae3-f06a220770ce`:

```
blob:app://./990762e1-757e-4c5b-9ae3-f06a220770ce:1  GET ... net::ERR_FILE_NOT_FOUND
blob:app://./990762e1-757e-4c5b-9ae3-f06a220770ce:1  GET ... net::ERR_FILE_NOT_FOUND
blob:app://./990762e1-757e-4c5b-9ae3-f06a220770ce:1  GET ... net::ERR_FILE_NOT_FOUND
```

This URL was revoked in Phase 3 (after only 7.5 seconds) but the export still held a reference to it.

---

## 1.2 Why Export Specifically Fails

### Problem 1: refCount is Ignored During Cleanup
```typescript
// blob-manager.ts:282-292
private cleanupOldBlobs(maxAge = 10 * 60 * 1000): void {
  for (const [url, entry] of this.blobs.entries()) {
    if (now - entry.createdAt > maxAge) {
      this.revokeObjectURL(url);  // <-- Force revokes regardless of refCount!
    }
  }
}
```

The log proves this: `📊 Had refs: 1` but URL was still revoked.

### Problem 2: Export Doesn't Acquire Its Own References
The export process relies on blob URLs that were created by other components (media-store, VideoPlayer) but doesn't acquire its own reference. When those components release their refs, the URL is revoked.

### Problem 3: VideoPlayer Mount/Unmount Churn
During timeline editing, VideoPlayer components rapidly mount/unmount:
```
🟢 Created → 🔴 Revoked (1ms lifespan)
🟢 Created → 🔴 Revoked (1ms lifespan)
🟢 Created → 🔴 Revoked (7577ms lifespan)
```

Each unmount releases the ref, potentially revoking a URL that export needs.

### Problem 4: CLI Export Still Uses Blob URLs Somewhere
Even though CLI export should use `localPath`, the errors show blob URLs being accessed. The export analysis shows:
```
🔍 [EXPORT ANALYSIS] Video localPath validation: Object
```

But something in the pipeline still accesses blob URLs. Possible sources:

1. **MediaRecorder Fallback** - The log shows:
   ```
   export-engine.ts:97 🎬 STANDARD EXPORT ENGINE: Constructor called
   export-engine.ts:98 🎬 STANDARD EXPORT ENGINE: Will use MediaRecorder for export
   ```
   Even when CLI is selected, a standard `ExportEngine` is also created (possibly as fallback), and it uses MediaRecorder which renders video elements that need blob URLs.

2. **Preview Panel** - The preview panel may be rendering videos during export using blob URLs.

3. **Thumbnail Generation** - Timeline thumbnails use blob URLs for video frames.

4. **Media Panel Display** - The media panel maintains blob URLs for all media items (`source: media-store-display`).

### Problem 5: No Export-Specific Blob URL Acquisition
The export process assumes blob URLs will exist but never acquires its own references:

```typescript
// What export SHOULD do (but doesn't):
const exportUrls = mediaItems.map(item =>
  blobManager.getOrCreateObjectURL(item.file, 'export-process')
);
// ... do export ...
exportUrls.forEach(url => blobManager.releaseObjectURL(url, 'export-complete'));
```

Instead, export relies on URLs created by other components (VideoPlayer, media-store), which can be revoked at any time.

---

## 1.3 Summary of Failure Chain

```
1. User loads project
   ↓
2. Blob URLs created for 9 media items (source: media-store-display)
   ↓
3. User works for ~15 minutes
   ↓
4. Auto-cleanup runs, revokes all URLs older than 10 minutes
   ⚠️ Bug: Revokes URLs WITH active references (refCount: 1)
   ↓
5. User adds videos to timeline
   ↓
6. VideoPlayer creates new blob URLs, then immediately unmounts/revokes them
   ⚠️ Bug: URLs revoked after 1ms, but export hasn't started yet
   ↓
7. User clicks Export
   ↓
8. Export tries to access blob URLs → ERR_FILE_NOT_FOUND
   ❌ All blob URLs are already invalid
   ↓
9. Export fails
```

---

## 2. Relevant File Paths

| File Path | Purpose |
|-----------|---------|
| `apps/web/src/lib/blob-manager.ts` | Central blob URL management with auto-cleanup |
| `apps/web/src/components/ui/video-player.tsx` | Video player that creates/releases blob URLs on mount/unmount |
| `apps/web/src/lib/export/export-engine-factory.ts` | Export engine creation and selection |
| `apps/web/src/lib/export/export-engine-cli.ts` | CLI-based FFmpeg export (uses file paths, not blob URLs) |
| `apps/web/src/lib/export/export-analysis.ts` | Export analysis and mode detection |
| `apps/web/src/hooks/use-export-progress.ts` | Export progress tracking hook |

---

## 3. Relevant Code Parts

### 3.1 Auto-cleanup Timer (Problem Source)

**File**: `apps/web/src/lib/blob-manager.ts:32-42`

```typescript
constructor() {
  // Auto-cleanup orphaned blobs every 5 minutes
  if (typeof window !== "undefined" && window.setInterval) {
    this.cleanupInterval = window.setInterval(
      () => {
        this.cleanupOldBlobs();
      },
      5 * 60 * 1000  // 5 minutes
    );
  }
}
```

### 3.2 Cleanup Logic (Ignores Active Usage)

**File**: `apps/web/src/lib/blob-manager.ts:282-295`

```typescript
private cleanupOldBlobs(maxAge = 10 * 60 * 1000): void {
  const now = Date.now();

  for (const [url, entry] of this.blobs.entries()) {
    if (now - entry.createdAt > maxAge) {
      // WARNING: This revokes even if URL is actively being used elsewhere!
      this.revokeObjectURL(url);
    }
  }
}
```

### 3.3 VideoPlayer Unmount Release (Premature During Export)

**File**: `apps/web/src/components/ui/video-player.tsx:230-242`

```typescript
// Separate cleanup effect for component unmount only
useEffect(() => {
  return () => {
    // Release reference on actual component unmount
    if (pendingCleanupRef.current) {
      console.log(
        `[VideoPlayer] Component unmount - releasing: ${pendingCleanupRef.current}`
      );
      releaseObjectURL(pendingCleanupRef.current, "VideoPlayer-unmount");
      pendingCleanupRef.current = null;
    }
  };
}, []); // Empty deps = only runs on unmount
```

---

## 4. How to Fix

### Fix 1: Add "Export Lock" to BlobManager

Prevent auto-cleanup during export by adding a lock mechanism:

```typescript
// In blob-manager.ts
class BlobManager {
  private exportLockCount = 0;

  lockForExport(): void {
    this.exportLockCount++;
  }

  unlockFromExport(): void {
    this.exportLockCount = Math.max(0, this.exportLockCount - 1);
  }

  private cleanupOldBlobs(maxAge = 10 * 60 * 1000): void {
    // Skip cleanup if export is in progress
    if (this.exportLockCount > 0) {
      if (import.meta.env.DEV) {
        console.log('[BlobManager] Skipping cleanup - export in progress');
      }
      return;
    }
    // ... existing cleanup logic
  }
}
```

### Fix 2: Export Should Acquire Blob URL References

Before export starts, acquire refs to all needed blob URLs:

```typescript
// In export initialization
const acquiredUrls: string[] = [];
for (const mediaItem of mediaItemsForExport) {
  if (mediaItem.file) {
    const url = blobManager.getOrCreateObjectURL(mediaItem.file, 'export-process');
    acquiredUrls.push(url);
  }
}

// After export completes
for (const url of acquiredUrls) {
  blobManager.releaseObjectURL(url, 'export-complete');
}
```

### Fix 3: Don't Revoke URLs with Active References

Modify `cleanupOldBlobs` to check refCount:

```typescript
private cleanupOldBlobs(maxAge = 10 * 60 * 1000): void {
  const now = Date.now();

  for (const [url, entry] of this.blobs.entries()) {
    // Only cleanup if old AND no active references
    if (now - entry.createdAt > maxAge && entry.refCount <= 0) {
      this.revokeObjectURL(url);
    }
  }
}
```

### Fix 4: CLI Export Should Use File Paths, Not Blob URLs

The CLI export path should use `localPath` from media items instead of blob URLs:

```typescript
// In export-analysis.ts - ensure localPath is used
if (videoElement.localPath) {
  // Use file system path for CLI FFmpeg
  inputPath = videoElement.localPath;
} else {
  // Fallback to blob URL only for WebAssembly FFmpeg
  inputPath = getBlobUrlForMedia(videoElement.mediaId);
}
```

---

## 5. Subtasks (if longer than 20 minutes)

This fix is estimated at **30-45 minutes** total. Breaking into subtasks:

### Subtask 1: Add Export Lock to BlobManager (10 min)
- [ ] Add `exportLockCount` property to `BlobManager` class
- [ ] Add `lockForExport()` and `unlockFromExport()` methods
- [ ] Modify `cleanupOldBlobs()` to skip when locked
- [ ] Export lock/unlock functions from module

### Subtask 2: Integrate Lock with Export Process (10 min)
- [ ] Call `blobManager.lockForExport()` when export starts in `use-export-progress.ts`
- [ ] Call `blobManager.unlockFromExport()` when export completes/fails
- [ ] Add try/finally to ensure unlock on error

### Subtask 3: Fix refCount Check in Cleanup (5 min)
- [ ] Modify `cleanupOldBlobs()` to only revoke URLs with `refCount <= 0`
- [ ] This is a safety net in addition to the export lock

### Subtask 4: Verify CLI Export Uses File Paths (10 min)
- [ ] Audit `export-analysis.ts` to ensure `localPath` is preferred for CLI exports
- [ ] Verify blob URLs are only used when `localPath` is unavailable
- [ ] Add warning log when falling back to blob URL in CLI mode

### Subtask 5: Test and Verify (10 min)
- [ ] Test export with multiple videos in timeline
- [ ] Test export while navigating between views
- [ ] Verify no `ERR_FILE_NOT_FOUND` errors in console
- [ ] Verify blob URLs survive for duration of export

---

## 6. Review Notes

After re-reading the code:

1. **The 10-minute maxAge is too short** for long exports. A 4K video export could easily take 15+ minutes.

2. **The refCount system is bypassed by `cleanupOldBlobs`** - it calls `revokeObjectURL` which force-revokes regardless of refCount (see line 282-292).

3. **VideoPlayer cleanup is correct but problematic during export** - it properly releases on unmount, but if the export process hasn't acquired its own reference, the URL gets revoked.

4. **CLI export SHOULD use file paths** - The logs show "localPath validation" happening, but the errors suggest blob URLs are still being used somewhere in the rendering pipeline.

5. **Multiple blob URLs for same file** - The logs show the same file (size 22946198) getting multiple blob URLs created and immediately revoked. This suggests excessive mount/unmount cycles during export.

**Priority**: High - This bug causes export failures, which is a critical user-facing feature.

---

## 7. Reproduction Steps

### Conditions That Trigger the Bug

1. **Time-based trigger** (most common):
   - Open a project
   - Work for more than 10 minutes
   - Try to export → FAIL (auto-cleanup revoked blob URLs)

2. **Rapid editing trigger**:
   - Add/remove videos from timeline rapidly
   - VideoPlayer mount/unmount cycles revoke blob URLs with 1ms lifespan
   - Export immediately after → FAIL

3. **Long export trigger**:
   - Start export
   - Export takes more than 10 minutes
   - Auto-cleanup runs mid-export → FAIL

### Exact Reproduction Steps (from logs)

1. Launch QCut Electron app
2. Open a project with multiple media items (9 in the log example)
3. Wait ~15 minutes (or just wait for 10+ minutes)
4. Drag 2 videos to the timeline
5. Click Export
6. Observe `ERR_FILE_NOT_FOUND` errors in console
7. Export fails

### Environment

- Platform: Electron (Windows)
- Export engine: CLI FFmpeg
- Export mode: Mode 1.5 (video normalization)
- Media count: 9 items in media panel, 2 on timeline

---

## 8. Impact Assessment

### User Impact
- **Severity**: Critical - Export is a core feature
- **Frequency**: High - Occurs whenever user works for >10 minutes before export
- **Workaround**: None currently (refreshing page loses unsaved work)

### Technical Impact
- Blob URLs created by media-store become invalid after 10 minutes
- Export process cannot access video files
- No recovery mechanism exists

### Affected Components
1. `BlobManager` - Flawed cleanup logic
2. `ExportEngine` - No blob URL acquisition
3. `VideoPlayer` - Aggressive URL release on unmount
4. `media-store` - URLs created for display revoked before export
