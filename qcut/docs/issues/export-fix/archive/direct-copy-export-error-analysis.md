# Direct Copy Export Error Analysis

## Error Summary

**Error Message:**
```
❌ [EXPORT OPTIMIZATION] FFmpeg export FAILED!
Error: Error invoking remote method 'export-video-cli':
Error: No frame files found in: C:\Users\zdhpe\AppData\Local\Temp\qcut-export\1760077984854\frames
```

**Observed Behavior:**
- Export optimization correctly detects video-only timeline ✅
- Skips frame rendering (optimization working) ✅
- Sends `useDirectCopy = true` to FFmpeg ✅
- **FFmpeg fails because no frames exist** ❌

---

## Root Cause Analysis

### The Problem Chain

1. **Frontend Analysis (export-engine-cli.ts:596):**
   - Analyzes timeline and detects video-only content
   - Sets `canUseDirectCopy = true`
   - **Correctly skips frame rendering** to optimize export

2. **Video Source Extraction (export-engine-cli.ts:489-491):**
   ```typescript
   const videoSources = this.exportAnalysis?.canUseDirectCopy
     ? this.extractVideoSources()
     : [];
   ```
   - Calls `extractVideoSources()` to get video file paths
   - **Problem:** Returns empty array if `mediaItem.localPath` is missing
   - **Critical Issue:** Blob URLs don't have `localPath` property!

3. **Missing localPath Check:**
   ```typescript
   if (!mediaItem.localPath) {
     debugWarn(`Video ${mediaItem.id} has no localPath, cannot use direct copy`);
     return; // Skip this video, returns empty array
   }
   ```
   - Videos loaded from blob URLs (browser storage) don't have filesystem paths
   - Only videos loaded via Electron file picker have `localPath`

4. **FFmpeg Handler Fallback (ffmpeg-handler.ts:776-913):**
   ```typescript
   if (useDirectCopy && videoSources && videoSources.length > 0) {
     // Use direct copy optimization
     return args;
   }

   // Fall back to frame-based processing
   if (useDirectCopy) {
     console.log('⚠️ Direct copy requested but videoSources not provided - using frame-based');
   }
   ```
   - Receives `useDirectCopy = true` BUT `videoSources = []` (empty)
   - **Falls back to frame-based FFmpeg command** (needs frames)
   - Tries to read frames from disk that were never created → **ERROR!**

### Why This Happens

The issue occurs when:
- User has a video-only timeline (optimization eligible)
- Video files are stored as blob URLs in IndexedDB
- Videos don't have `localPath` property (web-based, not Electron file system)
- Frontend skips frame rendering (optimization)
- Backend can't find video source files
- Backend falls back to frame-based mode but frames don't exist

---

## How to Fix

### Solution Strategy

We need to validate that videos have `localPath` BEFORE deciding to use direct copy optimization.

### Implementation

#### Fix 1: Validate localPath in Analysis Phase

**File:** `apps/web/src/lib/export-analysis.ts`

Add validation to check if video elements have `localPath`:

```typescript
export function analyzeTimelineForExport(
  tracks: TimelineTrack[],
  mediaItems: MediaItem[]
): ExportAnalysis {
  // ... existing analysis code ...

  // Check if all video elements have localPath (required for direct copy)
  let allVideosHaveLocalPath = true;

  videoElements.forEach(element => {
    const mediaItem = mediaItems.find(item => item.id === element.mediaId);
    if (mediaItem && !mediaItem.localPath) {
      allVideosHaveLocalPath = false;
    }
  });

  // Only enable direct copy if ALL conditions met
  const canUseDirectCopy =
    !needsImageProcessing &&
    videoElements.length > 0 &&
    allVideosHaveLocalPath; // NEW CONDITION

  // ... rest of analysis ...
}
```

#### Fix 2: Add Safety Check in FFmpeg Handler

**File:** `electron/ffmpeg-handler.ts` (lines 310-340)

Update the frame validation logic to handle the fallback case properly:

```typescript
// Verify input based on processing mode
if (useDirectCopy) {
  // Direct copy mode: validate video sources exist
  console.log('🚀 [FFmpeg Handler] Direct copy mode detected');

  if (!options.videoSources || options.videoSources.length === 0) {
    console.log('⚠️ [FFmpeg Handler] No video sources provided, but frames not rendered!');
    const error = `Cannot use direct copy: no video sources found. Frame rendering was skipped.`;
    console.error('❌ [FFmpeg Handler]', error);
    reject(new Error(error));
    return;
  }

  // Validate each video source file exists
  for (const video of options.videoSources) {
    if (!fs.existsSync(video.path)) {
      const error = `Video source not found: ${video.path}`;
      console.error('❌ [FFmpeg Handler]', error);
      reject(new Error(error));
      return;
    }
  }

  console.log(`✅ [FFmpeg Handler] Validated ${options.videoSources.length} video source(s)`);
} else {
  console.log('🎨 [FFmpeg Handler] Frame-based mode - validating frames exist');

  // Frame-based mode: verify frames exist
  if (!fs.existsSync(frameDir)) {
    const error = `Frame directory does not exist: ${frameDir}`;
    console.error('❌ [FFmpeg Handler] Frame directory not found!');
    reject(new Error(error));
    return;
  }

  const frameFiles = fs.readdirSync(frameDir)
    .filter(f => f.startsWith("frame-") && f.endsWith(".png"));

  console.log(`📊 [FFmpeg Handler] Found ${frameFiles.length} frame files`);

  if (frameFiles.length === 0) {
    const error = `No frame files found in: ${frameDir}`;
    console.error('❌ [FFmpeg Handler] No frames found!');
    reject(new Error(error));
    return;
  }
}
```

#### Fix 3: Prevent Fallback in buildFFmpegArgs

**File:** `electron/ffmpeg-handler.ts` (buildFFmpegArgs function)

Remove the silent fallback to frame-based processing:

```typescript
function buildFFmpegArgs(
  // ... parameters ...
  useDirectCopy: boolean = false,
  videoSources?: VideoSource[]
): string[] {
  // ... quality settings ...

  // Handle direct copy mode
  if (useDirectCopy && videoSources && videoSources.length > 0) {
    console.log(`[buildFFmpegArgs] ✅ Using direct copy with ${videoSources.length} source(s)`);
    // ... direct copy implementation ...
    return args;
  }

  // REMOVED: Silent fallback
  // if (useDirectCopy) {
  //   console.log('⚠️ Direct copy requested but videoSources not provided - using frame-based');
  // }

  // If we reach here with useDirectCopy=true, something is wrong
  if (useDirectCopy) {
    throw new Error(
      'Direct copy requested but no video sources available. ' +
      'This indicates a configuration error - frames were not rendered.'
    );
  }

  // Frame-based processing (normal path)
  console.log('[buildFFmpegArgs] Using frame-based processing');
  // ... frame-based implementation ...
}
```

---

## Verification Plan

### Console Messages to Add

#### 1. In export-analysis.ts

```typescript
console.log('🔍 [EXPORT ANALYSIS] Video localPath validation:', {
  totalVideos: videoElements.length,
  videosWithLocalPath: videoElements.filter(el => {
    const media = mediaItems.find(m => m.id === el.mediaId);
    return media?.localPath;
  }).length,
  allHaveLocalPath: allVideosHaveLocalPath
});

if (!allVideosHaveLocalPath) {
  console.log('⚠️ [EXPORT ANALYSIS] Some videos lack localPath - direct copy disabled');
  console.log('📝 [EXPORT ANALYSIS] Videos without localPath:',
    videoElements
      .filter(el => {
        const media = mediaItems.find(m => m.id === el.mediaId);
        return !media?.localPath;
      })
      .map(el => {
        const media = mediaItems.find(m => m.id === el.mediaId);
        return {
          elementId: el.id,
          mediaId: media?.id,
          hasUrl: !!media?.url,
          urlType: media?.url?.substring(0, 20)
        };
      })
  );
}
```

#### 2. In export-engine-cli.ts (extractVideoSources)

```typescript
private extractVideoSources(): Array<VideoSource> {
  console.log('🎬 [VIDEO SOURCES] Starting extraction...');
  const videoSources: Array<VideoSource> = [];

  this.tracks.forEach((track) => {
    if (track.type !== "media") return;

    track.elements.forEach((element) => {
      if (element.hidden) return;
      if (element.type !== "media") return;

      const mediaItem = this.mediaItems.find(item => item.id === element.mediaId);
      if (!mediaItem || mediaItem.type !== "video") return;

      console.log('🎥 [VIDEO SOURCES] Found video element:', {
        elementId: element.id,
        mediaId: mediaItem.id,
        hasLocalPath: !!mediaItem.localPath,
        localPath: mediaItem.localPath,
        hasUrl: !!mediaItem.url,
        urlType: mediaItem.url?.substring(0, 20)
      });

      if (!mediaItem.localPath) {
        debugWarn(`[VIDEO SOURCES] ❌ Video ${mediaItem.id} has no localPath - cannot use direct copy`);
        return;
      }

      videoSources.push({
        path: mediaItem.localPath,
        startTime: element.startTime,
        duration: element.duration,
        trimStart: element.trimStart,
        trimEnd: element.trimEnd,
      });

      console.log('✅ [VIDEO SOURCES] Added video source:', mediaItem.localPath);
    });
  });

  console.log(`📦 [VIDEO SOURCES] Extraction complete: ${videoSources.length} sources`);
  return videoSources;
}
```

#### 3. In ffmpeg-handler.ts (export-video-cli handler)

```typescript
console.log('🎬 [FFmpeg Handler] Export request received:', {
  sessionId,
  useDirectCopy,
  hasVideoSources: !!options.videoSources,
  videoSourceCount: options.videoSources?.length || 0,
  videoSourcePaths: options.videoSources?.map(v => v.path) || []
});

// After validation block
if (useDirectCopy) {
  console.log('✅ [FFmpeg Handler] Direct copy validation PASSED');
  console.log('📂 [FFmpeg Handler] Video sources:', options.videoSources);
} else {
  console.log('✅ [FFmpeg Handler] Frame validation PASSED');
  console.log('📁 [FFmpeg Handler] Frame directory:', frameDir);
}
```

### Test Cases

#### Test 1: Video with localPath (Electron file picker)
**Expected Result:** ✅ Direct copy should work
```
🔍 [EXPORT ANALYSIS] allHaveLocalPath: true
🎬 [VIDEO SOURCES] Added video source: C:\Users\...\video.mp4
📦 [VIDEO SOURCES] Extraction complete: 1 sources
✅ [FFmpeg Handler] Direct copy validation PASSED
✅ [buildFFmpegArgs] Using direct copy with 1 source(s)
```

#### Test 2: Video from blob URL (no localPath)
**Expected Result:** ⚠️ Falls back to image pipeline gracefully
```
🔍 [EXPORT ANALYSIS] allHaveLocalPath: false
⚠️ [EXPORT ANALYSIS] Some videos lack localPath - direct copy disabled
🎨 [EXPORT OPTIMIZATION] Image processing required - RENDERING FRAMES
📊 [FFmpeg Handler] Found 150 frame files
✅ [FFmpeg Handler] Frame validation PASSED
```

#### Test 3: Mixed videos (some with localPath, some without)
**Expected Result:** ⚠️ Falls back to image pipeline (safest option)
```
🔍 [EXPORT ANALYSIS] Videos without localPath: [{elementId: "...", mediaId: "..."}]
⚠️ [EXPORT ANALYSIS] Direct copy disabled
🎨 [EXPORT OPTIMIZATION] Image processing required
```

---

## Summary

### The Bug
Direct copy optimization was enabled based on timeline content analysis (video-only), but video files stored as blob URLs don't have filesystem paths (`localPath`). This caused the frontend to skip frame rendering, but the backend couldn't find video sources and silently fell back to frame-based processing, which then failed because frames didn't exist.

### The Fix
1. Add `localPath` validation to export analysis
2. Only enable direct copy if ALL videos have `localPath`
3. Add proper error handling in FFmpeg handler
4. Remove silent fallback that causes inconsistent state
5. Add comprehensive logging for debugging

### The Result
- Direct copy works for Electron file picker videos ✅
- Graceful fallback for blob URL videos ✅
- Clear error messages for debugging ✅
- No silent failures ✅
