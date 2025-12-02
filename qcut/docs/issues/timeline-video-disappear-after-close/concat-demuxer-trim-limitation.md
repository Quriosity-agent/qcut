# Concat Demuxer Trim Limitation - Multi-Video Export Fails

## 1. What is the Issue

**Summary**: Export fails when exporting multiple trimmed videos that have matching properties, because the mode detection incorrectly selects "direct-copy" strategy instead of "video-normalization".

**Root Cause**: The export mode detection in `export-analysis.ts` checks if video properties (resolution, fps, codec) match to decide between Mode 1 (direct-copy) and Mode 1.5 (video-normalization). However, it does NOT check for trim values. When videos have matching properties but are trimmed, it incorrectly selects "direct-copy", which routes to the concat demuxer path in `buildFFmpegArgs`. The concat demuxer cannot handle per-video trimming and throws an error.

**Key Insight**: Mode 1.5 (video-normalization) already handles trimming correctly via the `normalizeVideo` function. The bug is in mode SELECTION, not in the export implementation.

**Error Message**:
```
? [EXPORT OPTIMIZATION] FFmpeg export FAILED! Error: Error invoking remote method 'export-video-cli':
Error: Video 'video-xxx.mp4' has trim values (trimStart=0s, trimEnd=25.316667s).
The concat demuxer doesn't support per-video trimming in multi-video mode.
Please disable direct copy mode or pre-trim videos before export.
```

---

## 2. Relevant File Paths

| File Path | Line Numbers | Purpose |
|-----------|--------------|---------|
| `apps/web/src/lib/export-analysis.ts` | 441-501 | Mode detection logic - **WHERE THE FIX BELONGS** |
| `apps/web/src/lib/export-engine-cli.ts` | 490-559 | Extracts video sources with trim values |
| `apps/web/src/lib/export-engine-cli.ts` | 1493-1528 | Passes video sources to FFmpeg handler |
| `electron/ffmpeg-handler.ts` | 429-620 | Mode 1.5 (video-normalization) - handles trim correctly |
| `electron/ffmpeg-handler.ts` | 1418-1560 | `normalizeVideo` function - applies trim via `-ss` and `-t` |
| `electron/ffmpeg-handler.ts` | 1967-2036 | Mode 1 single video direct-copy - handles trim correctly |
| `electron/ffmpeg-handler.ts` | 2037-2101 | Multi-video concat demuxer - **THROWS ERROR on trim** |

---

## 3. Relevant Code Parts

### 3.1 Mode Detection Logic (THE BUG LOCATION)

**File**: `apps/web/src/lib/export-analysis.ts:479-494`

```typescript
// Check if all videos match the export settings
const videosMatch = checkVideoPropertiesMatch(
  videoElements,
  mediaItemsMap,
  targetWidth,
  targetHeight,
  targetFps
);

if (videosMatch) {
  // Mode 1: All videos match, can use direct copy
  optimizationStrategy = "direct-copy";  // ?? BUG: Doesn't check for trim values!
} else {
  // Mode 1.5: Videos need normalization
  optimizationStrategy = "video-normalization";  // ? This handles trim correctly
}
```

**Problem**: `checkVideoPropertiesMatch` only checks resolution/fps, NOT trim values.

### 3.2 Video Source Extraction (Includes Trim Values)

**File**: `apps/web/src/lib/export-engine-cli.ts:543-549`

```typescript
videoSources.push({
  path: localPath,
  startTime: element.startTime,
  duration: element.duration,
  trimStart: element.trimStart,  // ? Trim values are extracted
  trimEnd: element.trimEnd,      // ? but mode detection ignores them
});
```

### 3.3 Mode 1.5 Handles Trim Correctly

**File**: `electron/ffmpeg-handler.ts:510-519`

```typescript
// Mode 1.5: normalizeVideo applies trim via -ss and -t
await normalizeVideo(
  source.path,
  normalizedPath,
  width,
  height,
  fps,
  source.duration,
  source.trimStart || 0,  // ? Trim is handled here
  source.trimEnd || 0      // ? Trim is handled here
);
```

### 3.4 Concat Demuxer Throws Error on Trim

**File**: `electron/ffmpeg-handler.ts:2047-2057`

```typescript
// Concat demuxer doesn't support per-source trims
if (
  (video.trimStart && video.trimStart > 0) ||
  (video.trimEnd && video.trimEnd > 0)
) {
  throw new Error(
    `Video '${path.basename(video.path)}' has trim values...`
  );
}
```

---

## 4. How to Fix

### Option A: Force Mode 1.5 When Videos Have Trim (Recommended - Simplest Fix)

**File**: `apps/web/src/lib/export-analysis.ts`

**Location**: After line 477, before the `if (videosMatch)` check

**Implementation**:

```typescript
// Check if all videos match the export settings
const videosMatch = checkVideoPropertiesMatch(
  videoElements,
  mediaItemsMap,
  targetWidth,
  targetHeight,
  targetFps
);

// NEW: Check if any video has trim values
const hasTrimmedVideos = videoElements.some((v) => {
  const trimStart = v.trimStart || 0;
  const trimEnd = v.trimEnd || 0;
  return trimStart > 0 || trimEnd > 0;
});

if (videosMatch && !hasTrimmedVideos) {
  // Mode 1: All videos match AND no trimming needed - use direct copy
  optimizationStrategy = "direct-copy";
  console.log(
    "? [MODE DETECTION] All videos match export settings - using Mode 1: Direct copy (15-48x speedup)"
  );
} else if (videosMatch && hasTrimmedVideos) {
  // Videos match but have trim - force Mode 1.5 to handle trimming
  optimizationStrategy = "video-normalization";
  console.log(
    "? [MODE DETECTION] Videos match but have trim values - using Mode 1.5 for trim support"
  );
} else {
  // Mode 1.5: Videos need normalization (different properties)
  optimizationStrategy = "video-normalization";
  console.log(
    "? [MODE DETECTION] Videos have different properties - using Mode 1.5: Video normalization (5-7x speedup)"
  );
}
```

**Why This Works**:
- Mode 1.5 (`video-normalization`) already handles trimming correctly via `normalizeVideo` function
- No new code needed in ffmpeg-handler.ts
- Minimal change with maximum impact

### Option B: Pre-Trim Videos in Concat Demuxer Path

This is more complex and not recommended since Mode 1.5 already handles trimming. See archived Option A in previous version for details.

### Option C: Remove Error and Ignore Trim (NOT RECOMMENDED)

Could remove the error throw in `ffmpeg-handler.ts:2047-2057`, but this would cause incorrect video output (full videos instead of trimmed).

---

## 5. Subtasks (Option A Implementation)

**Total estimated time**: 15-20 minutes

### Subtask 1: Add Trim Detection in Mode Selection (10 min)

**File**: `apps/web/src/lib/export-analysis.ts`

**Changes**:

1. After `checkVideoPropertiesMatch` call (~line 477), add trim detection:

```typescript
// Check if any video has trim values that need processing
const hasTrimmedVideos = videoElements.some((v) => {
  const trimStart = v.trimStart || 0;
  const trimEnd = v.trimEnd || 0;
  return trimStart > 0 || trimEnd > 0;
});

if (hasTrimmedVideos) {
  console.log(
    `?? [MODE DETECTION] Found ${videoElements.filter(v => (v.trimStart || 0) > 0 || (v.trimEnd || 0) > 0).length} trimmed video(s)`
  );
}
```

2. Modify the mode selection logic (~line 479-494):

```typescript
if (videosMatch && !hasTrimmedVideos) {
  // Mode 1: Direct copy - only when videos match AND no trimming
  optimizationStrategy = "direct-copy";
  console.log(
    "? [MODE DETECTION] All videos match, no trim - using Mode 1: Direct copy (15-48x speedup)"
  );
} else {
  // Mode 1.5: Normalization - handles different properties AND trimming
  optimizationStrategy = "video-normalization";
  if (hasTrimmedVideos) {
    console.log(
      "? [MODE DETECTION] Videos have trim values - using Mode 1.5 for trim support"
    );
  } else {
    console.log(
      "? [MODE DETECTION] Videos have different properties - using Mode 1.5: Video normalization"
    );
  }
}
```

### Subtask 2: Test and Verify (5-10 min)

**Test scenarios**:

1. **Multiple videos, no trim, matching properties** (Mode 1):
   - [ ] Add 2-3 videos with same resolution/fps to timeline
   - [ ] Don't trim any of them
   - [ ] Export ? Should use Mode 1 (concat demuxer direct copy)
   - [ ] Verify: Console shows "All videos match, no trim - using Mode 1"

2. **Multiple videos, WITH trim, matching properties** (Mode 1.5):
   - [ ] Add 2-3 videos with same resolution/fps to timeline
   - [ ] Trim at least one video
   - [ ] Export ? Should use Mode 1.5 (normalization)
   - [ ] Verify: Console shows "Videos have trim values - using Mode 1.5"
   - [ ] Verify: Export succeeds (no more error!)

3. **Multiple videos, different properties** (Mode 1.5):
   - [ ] Add videos with different resolutions
   - [ ] Export ? Should use Mode 1.5
   - [ ] Verify: Works as before

4. **Single video with trim** (Mode 1):
   - [ ] Add one video, trim it
   - [ ] Export ? Should use Mode 1 (single video direct copy)
   - [ ] Verify: Trim is applied correctly

**Console logs to verify success**:
```
?? [MODE DETECTION] Found 1 trimmed video(s)
? [MODE DETECTION] Videos have trim values - using Mode 1.5 for trim support
? [MODE 1.5 EXPORT] Mode 1.5: Video Normalization with Padding
? [MODE 1.5 NORMALIZE] Trim start: 0s
? [MODE 1.5 NORMALIZE] Trim end: 25.316667s
? [FFMPEG EXPORT DEBUG] FFmpeg export completed
```

---

## 6. Console Logs Analysis (from consolev2.md)

### The Bug in Action

```
export-analysis.ts:442 ?? [MODE DETECTION] Direct copy eligible - 3 video(s), checking requirements...
export-analysis.ts:448 ?? [MODE DETECTION] Multiple sequential videos detected - checking properties...
export-analysis.ts:466 ?? [MODE DETECTION] Using target: 1248x704 @ 30fps (source: media-fallback)
export-analysis.ts:488 ? [MODE DETECTION] Videos have different properties - using Mode 1.5  ? Actually triggered Mode 1.5
```

Wait - the logs show Mode 1.5 was selected, but the error still occurred. Let me re-check...

The error occurs in `buildFFmpegArgs` which is called BEFORE the Mode 1.5 async block executes. The issue is in how `effectiveUseDirectCopy` is calculated:

**File**: `electron/ffmpeg-handler.ts:374-380`
```typescript
const effectiveUseDirectCopy =
  (options.useDirectCopy ?? false) &&
  options.videoSources &&
  options.videoSources.length > 0 &&
  !options.filterChain;
```

And `buildFFmpegArgs` is called with this value (line 403-422), which routes to the concat demuxer path that throws the error.

### Updated Root Cause

The `buildFFmpegArgs` function is called BEFORE the Mode 1.5 block processes videos. It receives `useDirectCopy=true` and `videoSources` with trim values, and throws the error at line 2047-2057.

The Mode 1.5 block at line 429 checks `options.optimizationStrategy === "video-normalization"` and bypasses the error path, BUT it happens AFTER `buildFFmpegArgs` was already called.

### Actual Fix Location

**File**: `electron/ffmpeg-handler.ts`

The fix should be in the `buildFFmpegArgs` call or the `effectiveUseDirectCopy` calculation:

```typescript
// Line 374-380: Disable direct copy if videos have trim values
const hasTrimmedVideos = options.videoSources?.some(
  (v) => (v.trimStart && v.trimStart > 0) || (v.trimEnd && v.trimEnd > 0)
);

const effectiveUseDirectCopy =
  (options.useDirectCopy ?? false) &&
  options.videoSources &&
  options.videoSources.length > 0 &&
  !options.filterChain &&
  !hasTrimmedVideos;  // ? NEW: Disable direct copy for trimmed videos
```

OR skip `buildFFmpegArgs` entirely when Mode 1.5 is used (it builds its own args).

---

## 7. Architecture Flow Diagram

```
???????????????????????????????????????????????????????????????????????????????
?                        EXPORT FLOW                                          ?
???????????????????????????????????????????????????????????????????????????????
?                                                                             ?
?  1. export-analysis.ts                                                      ?
?     ??? analyzeTimelineForExport()                                          ?
?         ??? Checks video properties (resolution, fps)                       ?
?         ??? Sets optimizationStrategy: "direct-copy" | "video-normalization"?
?         ??? ?? Does NOT check trim values for multi-video                   ?
?                                                                             ?
?  2. export-engine-cli.ts                                                    ?
?     ??? extractVideoSources()                                               ?
?         ??? Returns VideoSourceInput[] with trimStart/trimEnd               ?
?                                                                             ?
?  3. export-engine-cli.ts                                                    ?
?     ??? export() ? calls electronAPI.ffmpeg.exportVideoCLI(options)         ?
?         ??? options.useDirectCopy = true (from analysis)                    ?
?         ??? options.videoSources = [{...trimStart, trimEnd}]                ?
?         ??? options.optimizationStrategy = "video-normalization" or         ?
?                                            "direct-copy"                    ?
?                                                                             ?
?  4. electron/ffmpeg-handler.ts                                              ?
?     ??? exportVideoCLI handler                                              ?
?         ?                                                                   ?
?         ??? Calculates effectiveUseDirectCopy (line 374-380)                ?
?         ?   ??? true if useDirectCopy && videoSources.length > 0            ?
?         ?                                                                   ?
?         ??? Calls buildFFmpegArgs() (line 403)                              ?
?         ?   ??? ? THROWS ERROR if multi-video + trim (line 2047-2057)      ?
?         ?                                                                   ?
?         ??? Mode 1.5 block (line 429) - NEVER REACHED if error thrown       ?
?             ??? ? Would handle trim correctly via normalizeVideo()         ?
?                                                                             ?
???????????????????????????????????????????????????????????????????????????????
```

---

## 8. Updated Fix Strategy

### Primary Fix: Skip buildFFmpegArgs for Mode 1.5

**File**: `electron/ffmpeg-handler.ts`

**Location**: Lines 403-422

**Current code calls buildFFmpegArgs unconditionally**:
```typescript
const args: string[] = buildFFmpegArgs(
  frameDir, outputFile, width, height, fps, quality, validatedDuration,
  audioFiles, options.filterChain, textFilterChain, effectiveUseDirectCopy,
  options.videoSources, stickerFilterChain, stickerSources,
  options.useVideoInput || false, options.videoInputPath,
  options.trimStart, options.trimEnd
);
```

**Fix**: Only call buildFFmpegArgs if NOT using Mode 1.5:
```typescript
// Mode 1.5 builds its own args inside the async block
let args: string[] = [];
if (options.optimizationStrategy !== "video-normalization") {
  args = buildFFmpegArgs(
    frameDir, outputFile, width, height, fps, quality, validatedDuration,
    audioFiles, options.filterChain, textFilterChain, effectiveUseDirectCopy,
    options.videoSources, stickerFilterChain, stickerSources,
    options.useVideoInput || false, options.videoInputPath,
    options.trimStart, options.trimEnd
  );
}
```

## 9. Impact Assessment

### User Impact
- **Severity**: Medium - Export fails for specific scenario
- **Frequency**: Medium - Occurs when trimming multiple videos with matching properties
- **Workaround**: Manually select lower quality (forces re-encode) or don't trim

### Affected Scenarios
| Scenario | Mode | Result |
|----------|------|--------|
| Single video, no trim | Mode 1 | Works |
| Single video, with trim | Mode 1 | Works |
| Multiple videos, no trim, same props | Mode 1 | Works |
| Multiple videos, no trim, diff props | Mode 1.5 | Works |
| **Multiple videos, with trim, same props** | Mode 1.5 | FIXED |
| Multiple videos, with trim, diff props | Mode 1.5 | Works |

### After Fix
All scenarios should work correctly by routing trimmed multi-video exports to Mode 1.5.

---

## 10. Related Issues

- **Blob URL Revoked During Export**: ? FIXED (see `blob-url-revoked-during-export.md`)
- This issue was discovered after fixing the blob URL issue

---

## 11. Priority

**Medium-High** - Affects common workflow (trimming videos), but has workaround. Fix is straightforward.

---

## 12. Fix Implementation Status

### FIXED (2025-12-02)

Fix Applied: Force Mode 1.5 when trim is present and unblock Mode 1.5 pipeline.

Files modified (all required):

- apps/web/src/lib/export-engine-cli.ts
- electron/ffmpeg-handler.ts

How It Works:
1. Renderer sets useDirectCopy = false when optimizationStrategy is "video-normalization".
2. Renderer always supplies videoSources for Mode 1.5.
3. Electron disables direct copy when trimmed multi-videos are present and defers buildFFmpegArgs for Mode 1.5, preventing the early throw.
4. Mode 1.5 runs, normalizes, and concatenates while respecting trims.

### Updated Scenario Results

| Scenario | Mode | Result |
|----------|------|--------|
| Single video, no trim | Mode 1 | Works |
| Single video, with trim | Mode 1 | Works |
| Multiple videos, no trim, same props | Mode 1 | Works |
| Multiple videos, no trim, diff props | Mode 1.5 | Works |
| **Multiple videos, with trim, same props** | **Mode 1.5** | FIXED |
| Multiple videos, with trim, diff props | Mode 1.5 | Works |


