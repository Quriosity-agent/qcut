# Text Export Debug Analysis

## 1. What is Happening

Based on console logs from `text_export_console.md`, the text export process is working **CORRECTLY** but **SLOWLY** because it's using the **image pipeline** instead of direct copy optimization.

### Current Flow:
1. ✅ Text filter chain is generated successfully (line 418-421)
2. ✅ Text is being rendered by FFmpeg CLI drawtext (NOT canvas)
3. ❌ **SLOW**: 58 frames are being rendered to disk individually (line 354)
4. ✅ FFmpeg export completes in 2.89s (line 439)

### Key Evidence:
```
Line 355: Canvas text rendering: DISABLED (using FFmpeg)
Line 419: Text filter chain: drawtext=text='Default text':fontsize=48...
Line 421: Text will be rendered by FFmpeg CLI (not canvas)
Line 354: Starting frame rendering: 58 frames
```

---

## 2. Console Messages to Identify the Bug

### Add these console messages to track the slowdown:

#### A. Track why image pipeline is chosen (export-analysis.ts)
```typescript
// In analyzeTimelineForExport function
console.log('🔍 [EXPORT ANALYSIS BUG] Checking optimization eligibility:');
console.log(`   - Has text elements: ${hasTextElements}`);
console.log(`   - Has stickers: ${hasStickers}`);
console.log(`   - Has effects: ${hasEffects}`);
console.log(`   - Has image elements: ${hasImageElements}`);
console.log(`   - Multiple videos: ${hasMultipleVideoSources}`);
console.log(`   - Overlapping videos: ${hasOverlappingVideos}`);
console.log(`   - CAN use direct copy: ${canUseDirectCopy}`);
console.log(`   - REASON: ${reason}`);
```

**File**: `qcut/apps/web/src/lib/export-analysis.ts`

#### B. Track frame-by-frame rendering overhead (export-engine-cli.ts)
```typescript
// In renderFramesToDisk function
const renderStart = Date.now();

for (let frame = 0; frame < totalFrames; frame++) {
  const frameStart = Date.now();

  await this.renderFrame(currentTime);
  await this.saveFrameToDisk(frameName, currentTime);

  const frameTime = Date.now() - frameStart;

  // Log slow frames
  if (frameTime > 100) {
    console.warn(`⚠️ [FRAME RENDERING] Slow frame ${frame}: ${frameTime}ms`);
  }
}

const totalRenderTime = ((Date.now() - renderStart) / 1000).toFixed(2);
console.log(`⏱️ [FRAME RENDERING] Total frame rendering time: ${totalRenderTime}s`);
console.log(`⏱️ [FRAME RENDERING] Average per frame: ${(totalRenderTime * 1000 / totalFrames).toFixed(2)}ms`);
```

**File**: `qcut/apps/web/src/lib/export-engine-cli.ts` (lines 1301-1332)

#### C. Track FFmpeg filter application (export-engine-cli.ts)
```typescript
// In exportWithCLI function, after building filter chains
console.log('🎬 [FILTER CHAIN DEBUG] ============================================');
console.log(`   - Video effects filter: ${combinedFilterChain || 'NONE'}`);
console.log(`   - Text overlay filter: ${textFilterChain || 'NONE'}`);
console.log(`   - Sticker overlay filter: ${stickerFilterChain || 'NONE'}`);
console.log(`   - Total filter complexity: ${(combinedFilterChain?.length || 0) + (textFilterChain?.length || 0) + (stickerFilterChain?.length || 0)} chars`);
console.log('🎬 [FILTER CHAIN DEBUG] ============================================');
```

**File**: `qcut/apps/web/src/lib/export-engine-cli.ts` (after line 1637)

---

## 3. Why Text is NOT Rendered (Answer: IT IS!)

**Text IS being rendered correctly by FFmpeg drawtext filter.**

Evidence from console logs:
- Line 419: `Text filter chain: drawtext=text='Default text':fontsize=48:fontcolor=0xffffff:fontfile=C:/Windows/Fonts/arial.ttf...`
- Line 421: `Text will be rendered by FFmpeg CLI (not canvas)`
- Line 432: `Text elements: YES (using FFmpeg drawtext)`

### The confusion:
Text is rendered, but the export is slow because:
1. **58 frames are rendered individually** to PNG files (canvas → disk)
2. **Each frame is saved as a separate file** (slow I/O)
3. **FFmpeg then processes all 58 PNGs** + applies text filter
4. **Total time: 2.89s for 1.93s video** (frame rendering overhead)

---

## 4. Do We Use FFmpeg CLI for Text? Why So Slow?

### Yes, FFmpeg CLI is used for text rendering

**Process breakdown:**

```
Step 1: Frame Rendering (SLOW - 58 frames)
  ├─ Render frame 0 → save to disk (frame-0000.png)
  ├─ Render frame 1 → save to disk (frame-0001.png)
  ├─ ...
  └─ Render frame 57 → save to disk (frame-0057.png)
  Time: ~2-3 seconds for 58 frames

Step 2: FFmpeg Processing (FAST)
  ├─ Read all PNGs: ffmpeg -framerate 30 -i frame-%04d.png
  ├─ Apply text filter: drawtext=text='Default text'...
  └─ Encode to MP4: -c:v libx264 -crf 23
  Time: ~2.89s (includes frame reading)
```

### Why is it slow?

**Root Cause**: Image Pipeline Overhead

1. **Canvas Rendering**: Each frame is rendered on HTML canvas (even without text)
2. **PNG Encoding**: Each frame is converted to PNG (base64 → Buffer)
3. **Disk I/O**: 58 individual file writes
4. **FFmpeg Input**: Reading 58 PNG files from disk

### Optimization opportunity:

If we could use **direct copy mode**, the process would be:
```
Step 1: Direct Copy (FAST)
  └─ Use existing video file directly
  Time: 0s (no frame rendering)

Step 2: FFmpeg Processing (FAST)
  ├─ Copy video stream: -c:v copy
  ├─ Apply text overlay: -vf drawtext=...
  └─ Encode to MP4: -c:v libx264
  Time: ~0.5-1s
```

### Current limitation:

**Direct copy is disabled when text is present** (line 1663 in export-engine-cli.ts):
```typescript
useDirectCopy: !!(this.exportAnalysis?.canUseDirectCopy && !hasTextFilters && !hasStickerFilters)
```

This is by design because FFmpeg's `-c:v copy` (stream copy) cannot apply filters. When text/stickers are present, we MUST re-encode the video.

However, we could optimize by:
1. **Skipping frame rendering** if we have a single video source
2. **Using the video file directly** as FFmpeg input
3. **Applying text filter during encoding** (instead of reading PNGs)

---

## 5. Relevant File Paths

### Core Export Logic
- `qcut/apps/web/src/lib/export-engine-cli.ts` - Main CLI export engine (frame rendering, FFmpeg invocation)
- `qcut/apps/web/src/lib/export-analysis.ts` - Export optimization analysis (determines image vs direct copy)
- `qcut/apps/web/src/lib/export-engine-factory.ts` - Engine selection logic

### FFmpeg Integration
- `qcut/electron/ffmpeg-handler.ts` - Electron IPC handlers for FFmpeg operations
- `qcut/apps/web/src/types/electron.d.ts` - TypeScript definitions for Electron API

### Text Rendering
- `qcut/apps/web/src/lib/export-engine-cli.ts:672-726` - `buildTextOverlayFilters()` function
- `qcut/apps/web/src/lib/export-engine-cli.ts:549-666` - `convertTextElementToDrawtext()` function
- `qcut/apps/web/src/lib/export-engine-cli.ts:297-317` - `renderTextElementCLI()` function (canvas text - disabled)

### Frame Rendering
- `qcut/apps/web/src/lib/export-engine-cli.ts:1301-1332` - `renderFramesToDisk()` function
- `qcut/apps/web/src/lib/export-engine-cli.ts:1334-1439` - `saveFrameToDisk()` function

### Export Configuration
- `qcut/apps/web/src/lib/export-engine-cli.ts:1441-1729` - `exportWithCLI()` function
- `qcut/apps/web/src/hooks/use-export-progress.ts` - Export UI hook with engine selection

---

## Summary

| Aspect | Status | Details |
|--------|--------|---------|
| **Text rendering method** | ✅ Correct | Using FFmpeg drawtext filter (not canvas) |
| **Filter chain generation** | ✅ Working | Text filter properly generated |
| **Export completion** | ✅ Success | Video exported successfully |
| **Performance** | ❌ Slow | Image pipeline overhead (58 frame writes) |
| **Root cause** | Image pipeline | Direct copy disabled when text present |
| **Optimization needed** | Use video file directly | Skip frame rendering for single video + text |

### Recommendation:

Implement **hybrid optimization**: Use video file directly as FFmpeg input (instead of rendering frames) when:
- Single video source
- Text/sticker overlays present
- No video effects applied

This would eliminate frame rendering overhead while still allowing text/sticker filters.

---

## 6. Deep Analysis: Do We Need Frame Rendering for Text?

**Updated: 2025-10-17**

### Current Understanding of Text Export Flow

**What's happening now:**

1. User exports a video with text elements
2. System renders 58 frames to disk (frame-0000.png, frame-0001.png, etc.)
3. Each frame is a full canvas render (video + any images)
4. FFmpeg then reads these 58 PNG files
5. FFmpeg applies text drawtext filter on top
6. FFmpeg encodes to final MP4

**The key insight:**

Text IS being rendered by FFmpeg drawtext filter (correctly), but we're **unnecessarily rendering frames to disk** when we could skip that step entirely.

### Do We Need Frame Rendering for Text?

**NO - We should NOT need frame rendering for text-only overlays!**

#### Scenario 1: Single video + text overlay
- **Current (slow)**: Render 58 frames → Save to disk → FFmpeg reads PNGs → Apply text filter
- **Optimal (fast)**: FFmpeg reads video file directly → Apply text filter → Encode
- **Performance gain**: ~5-10x faster (no frame rendering overhead)

#### Scenario 2: Single video + text + stickers
- **Current (slow)**: Render 58 frames → Save to disk → FFmpeg reads PNGs → Apply text + sticker filters
- **Optimal (fast)**: FFmpeg reads video file directly → Apply text + sticker overlay filters → Encode
- **Performance gain**: ~5-10x faster

#### Scenario 3: Multiple videos or images (requires compositing)
- **Current (correct)**: Render frames → FFmpeg processes
- **Reason**: Canvas compositing needed for multiple video layers or image elements

### When DO We Need Frame Rendering?

Frame rendering is ONLY needed when:
1. ✅ **Multiple overlapping videos** (compositing required)
2. ✅ **Image elements mixed with video** (canvas compositing)
3. ✅ **Video effects applied on canvas** (transformations, filters that can't be done in FFmpeg)

### When DON'T We Need Frame Rendering?

We can skip frame rendering when:
1. ✅ **Single video source**
2. ✅ **Text overlays** (FFmpeg drawtext)
3. ✅ **Sticker overlays** (FFmpeg overlay filter)
4. ✅ **No canvas-based effects**

### The Bug Identified

**Location**: `export-engine-cli.ts` line 1176-1181:

```typescript
if (!this.exportAnalysis?.canUseDirectCopy) {
  // If we CAN'T use direct copy, we MUST render frames
  await this.renderFramesToDisk(progressCallback);
} else {
  // Using direct video copy - skipping frame rendering
}
```

**Location**: `export-engine-cli.ts` line 1368-1372:

```typescript
const hasTextFilters = textFilterChain.length > 0;
const hasStickerFilters = (stickerFilterChain?.length ?? 0) > 0;
const videoSources = (this.exportAnalysis?.canUseDirectCopy && !hasTextFilters && !hasStickerFilters)
  ? this.extractVideoSources()
  : [];
```

**The problem:** When text or stickers are present, `canUseDirectCopy` is set to `false` (in export-analysis.ts), which forces frame rendering.

But this is **WRONG**! We should:
1. ✅ **Use video file directly as input** (not rendered frames)
2. ✅ **Apply text/sticker filters** (FFmpeg can do this)
3. ✅ **Re-encode with filters** (can't use `-c:v copy`, but don't need frame rendering)

### The Confusion: Direct Copy vs Frame Rendering

There are actually **THREE** export modes, not two:

#### Mode 1: Direct Copy Mode (fastest)
```bash
ffmpeg -i video.mp4 -c:v copy -c:a copy output.mp4
```
- No re-encoding, just stream copy
- Only works with NO filters/overlays
- **Speed**: ~0.1-0.5s for typical video

#### Mode 2: Direct Video Input with Filters (fast) ⚠️ **THIS IS MISSING!**
```bash
ffmpeg -i video.mp4 -vf "drawtext=text='Hello':fontsize=48" output.mp4
```
- Uses video file directly as input
- Re-encodes with filters applied
- **This is what we should use for text/stickers!**
- **Speed**: ~1-2s for typical video (10x faster than frame rendering)

#### Mode 3: Frame Rendering Mode (slow)
```bash
ffmpeg -framerate 30 -i frame-%04d.png -vf "drawtext=..." output.mp4
```
- Renders frames to disk first
- FFmpeg reads PNG sequence
- Only needed for compositing multiple videos/images
- **Speed**: ~5-10s for typical video

### The Fix Needed

We need to distinguish between:
- **Needs re-encoding** (text/stickers present - use video file with filters) ← **Mode 2**
- **Needs frame rendering** (multiple videos, images, complex compositing) ← **Mode 3**

**Current bug in `export-analysis.ts`:**
```typescript
// WRONG: Treats text/stickers as requiring "image processing"
const needsImageProcessing =
  hasImageElements ||
  hasTextElements ||      // ← WRONG! Text doesn't need image processing
  hasStickers ||          // ← WRONG! Stickers need overlay filters, not image processing
  hasEffects ||
  hasOverlappingVideos;
```

**Correct logic should be:**
```typescript
// Separate concerns: frame rendering vs filter application
const needsFrameRendering =
  hasImageElements ||           // Images need canvas compositing
  hasOverlappingVideos ||       // Multiple videos need compositing
  hasCanvasEffects;             // Canvas-only effects

const needsFilterEncoding =
  hasTextElements ||            // Text uses FFmpeg drawtext
  hasStickers ||                // Stickers use FFmpeg overlay
  hasFFmpegEffects;             // FFmpeg-compatible effects

const canUseDirectCopy =
  !needsFrameRendering &&
  !needsFilterEncoding &&
  videoElementCount >= 1;
```

### Implementation Strategy

1. **Add new export mode**: `direct-video-with-filters`
2. **Update export analysis** to distinguish frame rendering from filter encoding
3. **Modify FFmpeg handler** to accept video file path as input (instead of frame sequence)
4. **Update CLI export engine** to skip frame rendering when using direct video input

### Expected Performance Improvement

For **single video + text overlay** (1.93s video, 58 frames @ 30fps):

| Mode | Current Time | Optimized Time | Speedup |
|------|--------------|----------------|---------|
| Frame rendering | ~2-3s | - | - |
| FFmpeg encoding | ~2.89s | - | - |
| **Total** | **~5-6s** | **~1-2s** | **3-5x faster** |

### Code Changes Required

1. **`export-analysis.ts`**: Add `needsFrameRendering` vs `needsFilterEncoding` distinction
2. **`export-engine-cli.ts`**: Add logic to use video file directly when frame rendering not needed
3. **`ffmpeg-handler.ts`**: Support video file input path (already partially implemented)
4. **Type definitions**: Update `ExportOptions` to include `videoInputPath` parameter

### Summary

**Current behavior:** Text overlays → Frame rendering (WRONG - unnecessarily slow)

**Correct behavior:** Text overlays → Direct video input + FFmpeg filters (FAST)

**Root cause:** Conflating "needs re-encoding" with "needs frame rendering"

**Solution:** Implement Mode 2 (direct video input with filters) for text/sticker overlays

---

## 7. Implementation Plan: Add Mode 2 (Direct Video Input with Filters)

**Objective**: Enable FFmpeg to use video file directly as input when only text/sticker overlays are present, eliminating unnecessary frame rendering.

**Estimated Total Time**: ~120-150 minutes

### Task Breakdown

#### Task 1: Update Export Analysis Logic (~20 min)
**File**: `qcut/apps/web/src/lib/export-analysis.ts`

**Changes**:
1. Add new fields to `ExportAnalysis` interface:
   - `needsFrameRendering: boolean` - Requires canvas compositing
   - `needsFilterEncoding: boolean` - Requires FFmpeg filters but not frame rendering
   - `optimizationStrategy: 'direct-copy' | 'direct-video-with-filters' | 'frame-rendering'`

2. Update `analyzeTimelineForExport()` logic:
   ```typescript
   // Separate frame rendering from filter encoding
   const needsFrameRendering =
     hasImageElements ||           // Images require canvas compositing
     hasOverlappingVideos ||       // Multiple videos require compositing
     (hasEffects && !isFFmpegCompatible);  // Canvas-only effects

   const needsFilterEncoding =
     hasTextElements ||            // Text uses FFmpeg drawtext
     hasStickers ||                // Stickers use FFmpeg overlay
     (hasEffects && isFFmpegCompatible);   // FFmpeg-compatible effects

   const canUseDirectCopy =
     videoElementCount >= 1 &&
     !needsFrameRendering &&
     !needsFilterEncoding &&
     allVideosHaveLocalPath;

   // Determine strategy
   let optimizationStrategy;
   if (canUseDirectCopy) {
     optimizationStrategy = 'direct-copy';
   } else if (!needsFrameRendering && needsFilterEncoding && videoElementCount === 1) {
     optimizationStrategy = 'direct-video-with-filters';  // NEW MODE
   } else {
     optimizationStrategy = 'frame-rendering';
   }
   ```

3. Update reason generation to reflect new logic

**Subtasks**:
- [ ] Add new interface fields (5 min)
- [ ] Implement `needsFrameRendering` logic (5 min)
- [ ] Implement `needsFilterEncoding` logic (5 min)
- [ ] Update strategy determination (3 min)
- [ ] Update reason generation (2 min)

---

#### Task 2: Update FFmpeg Handler to Support Video File Input (~30 min)
**File**: `qcut/electron/ffmpeg-handler.ts`

**Changes**:
1. Update `ExportOptions` interface to include:
   ```typescript
   interface ExportOptions {
     // ... existing fields
     videoInputPath?: string;           // NEW: Direct video file path
     useVideoInput?: boolean;           // NEW: Use video file instead of frames
     trimStart?: number;                // NEW: Video trim start time
     trimEnd?: number;                  // NEW: Video trim end time
   }
   ```

2. Update `buildFFmpegArgs()` to handle video input mode:
   ```typescript
   function buildFFmpegArgs(/* params */): string[] {
     const args: string[] = ['-y']; // Overwrite output

     if (useVideoInput && videoInputPath) {
       // MODE 2: Direct video input with filters

       // Trim video if needed
       if (trimStart > 0) {
         args.push('-ss', trimStart.toString());
       }

       // Video input
       args.push('-i', videoInputPath);

       // Duration limit
       if (duration) {
         args.push('-t', duration.toString());
       }

       // Add sticker inputs
       if (stickerSources && stickerSources.length > 0) {
         for (const sticker of stickerSources) {
           args.push('-loop', '1', '-i', sticker.path);
         }
       }

       // Build complete filter chain
       const filters: string[] = [];

       // Apply sticker overlays first (if any)
       if (stickerFilterChain) {
         filters.push(stickerFilterChain);
       }

       // Apply text overlays (on top of stickers)
       if (textFilterChain) {
         filters.push(textFilterChain);
       }

       // Apply video effects (if any)
       if (filterChain) {
         filters.push(filterChain);
       }

       if (filters.length > 0) {
         args.push('-vf', filters.join(','));
       }

     } else {
       // MODE 3: Frame sequence input (existing logic)
       args.push('-framerate', fps.toString());
       args.push('-i', `${frameDir}/frame-%04d.png`);
       // ... existing frame-based logic
     }

     // Audio mixing (common to both modes)
     // ... existing audio logic

     // Encoding settings (common to both modes)
     args.push('-c:v', 'libx264');
     args.push('-preset', preset);
     args.push('-crf', crf.toString());

     return args;
   }
   ```

**Subtasks**:
- [ ] Add new ExportOptions fields (3 min)
- [ ] Implement video input mode detection (5 min)
- [ ] Add video trim support (-ss, -t flags) (5 min)
- [ ] Update sticker input handling for video mode (7 min)
- [ ] Build complete filter chain for video mode (7 min)
- [ ] Test FFmpeg args construction (3 min)

---

#### Task 3: Update CLI Export Engine Logic (~35 min)
**File**: `qcut/apps/web/src/lib/export-engine-cli.ts`

**Changes**:
1. Add method to extract video input path:
   ```typescript
   private extractVideoInputPath(): { path: string; trimStart: number; trimEnd: number } | null {
     // Find the single video element
     let videoElement: MediaElement | null = null;
     let mediaItem: MediaItem | null = null;

     for (const track of this.tracks) {
       if (track.type !== 'media') continue;

       for (const element of track.elements) {
         if (element.hidden) continue;
         if (element.type !== 'media') continue;

         const item = this.mediaItems.find(m => m.id === element.mediaId);
         if (item && item.type === 'video' && item.localPath) {
           if (videoElement) {
             // Multiple videos found, can't use single video input
             return null;
           }
           videoElement = element;
           mediaItem = item;
         }
       }
     }

     if (!videoElement || !mediaItem?.localPath) {
       return null;
     }

     return {
       path: mediaItem.localPath,
       trimStart: videoElement.trimStart || 0,
       trimEnd: videoElement.trimEnd || 0
     };
   }
   ```

2. Update `export()` method to skip frame rendering for Mode 2:
   ```typescript
   async export(progressCallback?: ProgressCallback): Promise<Blob> {
     // ... existing setup code

     // Determine if we can use direct video input
     const canUseVideoInput =
       this.exportAnalysis?.optimizationStrategy === 'direct-video-with-filters';

     const videoInput = canUseVideoInput ? this.extractVideoInputPath() : null;

     try {
       await this.preloadAllVideos();

       // Only render frames if we MUST use frame rendering mode
       if (this.exportAnalysis?.optimizationStrategy === 'frame-rendering') {
         debugLog('[CLIExportEngine] Using frame rendering mode');
         progressCallback?.(15, "Rendering frames...");
         await this.renderFramesToDisk(progressCallback);
       } else if (videoInput) {
         debugLog('[CLIExportEngine] Using direct video input with filters mode');
         debugLog(`[CLIExportEngine] Video path: ${videoInput.path}`);
         progressCallback?.(15, "Preparing video with filters...");
         // Skip frame rendering entirely!
       } else {
         debugLog('[CLIExportEngine] Using direct copy mode');
         progressCallback?.(15, "Preparing direct video copy...");
       }

       // ... rest of export logic
     }
   }
   ```

3. Update `exportWithCLI()` to pass video input options:
   ```typescript
   const exportOptions = {
     sessionId: this.sessionId,
     // ... existing fields

     // NEW: Video input mode
     useVideoInput: !!videoInput,
     videoInputPath: videoInput?.path,
     trimStart: videoInput?.trimStart || 0,
     trimEnd: videoInput?.trimEnd || 0,

     // Filter chains (already implemented)
     textFilterChain: hasTextFilters ? textFilterChain : undefined,
     stickerFilterChain,
     stickerSources,
   };
   ```

**Subtasks**:
- [ ] Implement extractVideoInputPath() method (10 min)
- [ ] Update export() to detect Mode 2 (5 min)
- [ ] Skip frame rendering for Mode 2 (5 min)
- [ ] Add console logging for Mode 2 (3 min)
- [ ] Update exportWithCLI() options (5 min)
- [ ] Add error handling for video input failures (7 min)

---

#### Task 4: Update TypeScript Type Definitions (~10 min)
**File**: `qcut/apps/web/src/types/electron.d.ts`

**Changes**:
1. Update ExportAnalysis interface:
   ```typescript
   export interface ExportAnalysis {
     needsImageProcessing: boolean;
     needsFrameRendering: boolean;        // NEW
     needsFilterEncoding: boolean;        // NEW
     hasImageElements: boolean;
     hasTextElements: boolean;
     hasStickers: boolean;
     hasEffects: boolean;
     hasMultipleVideoSources: boolean;
     hasOverlappingVideos: boolean;
     canUseDirectCopy: boolean;
     optimizationStrategy: 'direct-copy' | 'direct-video-with-filters' | 'frame-rendering';  // UPDATED
     reason: string;
   }
   ```

2. Update exportVideoCLI options:
   ```typescript
   exportVideoCLI: (options: {
     sessionId: string;
     // ... existing fields

     // NEW fields
     useVideoInput?: boolean;
     videoInputPath?: string;
     trimStart?: number;
     trimEnd?: number;
   }) => Promise<{ success: boolean; outputFile: string }>;
   ```

**Subtasks**:
- [ ] Update ExportAnalysis interface (3 min)
- [ ] Update exportVideoCLI options (3 min)
- [ ] Update FFmpeg handler types (2 min)
- [ ] Verify type consistency across files (2 min)

---

#### Task 5: Add Debug Logging and Console Messages (~10 min)
**Files**:
- `qcut/apps/web/src/lib/export-analysis.ts`
- `qcut/apps/web/src/lib/export-engine-cli.ts`

**Changes**:
1. Add console logging for optimization strategy selection:
   ```typescript
   // In export-analysis.ts
   console.log('🎯 [EXPORT OPTIMIZATION] Strategy selected:', optimizationStrategy);
   console.log('🎯 [EXPORT OPTIMIZATION] Needs frame rendering:', needsFrameRendering);
   console.log('🎯 [EXPORT OPTIMIZATION] Needs filter encoding:', needsFilterEncoding);
   ```

2. Add console logging for Mode 2 execution:
   ```typescript
   // In export-engine-cli.ts
   if (videoInput) {
     console.log('⚡ [MODE 2] Using direct video input with filters');
     console.log(`⚡ [MODE 2] Video path: ${videoInput.path}`);
     console.log(`⚡ [MODE 2] Trim: ${videoInput.trimStart}s - ${videoInput.trimEnd}s`);
     console.log('⚡ [MODE 2] Skipping frame rendering - performance boost expected!');
   }
   ```

**Subtasks**:
- [ ] Add strategy selection logging (3 min)
- [ ] Add Mode 2 detection logging (3 min)
- [ ] Add performance comparison logging (2 min)
- [ ] Add error state logging (2 min)

---

#### Task 6: Testing and Validation (~15 min)

**Test Cases**:
1. **Test Mode 2: Single video + text overlay**
   - Timeline: 1 video clip + 1 text element
   - Expected: Direct video input mode, no frame rendering
   - Verify: Console shows "MODE 2" messages
   - Verify: Export completes faster than before

2. **Test Mode 3: Single video + image element**
   - Timeline: 1 video clip + 1 image element
   - Expected: Frame rendering mode
   - Verify: Console shows frame rendering messages

3. **Test Mode 2: Single video + text + stickers**
   - Timeline: 1 video clip + text + sticker overlays
   - Expected: Direct video input mode with overlay filters
   - Verify: All overlays appear correctly

4. **Test Mode 1: Single video, no overlays**
   - Timeline: 1 video clip, no text/stickers
   - Expected: Direct copy mode
   - Verify: Fastest export time

**Subtasks**:
- [ ] Test Mode 2 with text only (3 min)
- [ ] Test Mode 2 with text + stickers (3 min)
- [ ] Test Mode 3 with images (3 min)
- [ ] Test Mode 1 with no overlays (2 min)
- [ ] Verify console logging accuracy (2 min)
- [ ] Measure performance improvement (2 min)

---

### Implementation Checklist

**Phase 1: Analysis and Type Definitions** (~30 min)
- [ ] Task 1: Update Export Analysis Logic (20 min)
- [ ] Task 4: Update TypeScript Type Definitions (10 min)

**Phase 2: FFmpeg Integration** (~30 min)
- [ ] Task 2: Update FFmpeg Handler (30 min)

**Phase 3: Export Engine Updates** (~45 min)
- [ ] Task 3: Update CLI Export Engine Logic (35 min)
- [ ] Task 5: Add Debug Logging (10 min)

**Phase 4: Testing** (~15 min)
- [ ] Task 6: Testing and Validation (15 min)

**Total Estimated Time**: ~120 minutes (2 hours)

---

### Success Criteria

1. ✅ Export analysis correctly identifies Mode 2 scenarios
2. ✅ FFmpeg handler builds correct args for video input mode
3. ✅ CLI export engine skips frame rendering for Mode 2
4. ✅ Text overlays render correctly on video
5. ✅ Sticker overlays render correctly on video
6. ✅ Performance improvement: 3-5x faster for Mode 2 exports
7. ✅ Console logging clearly shows which mode is being used
8. ✅ No regression in existing Mode 1 and Mode 3 functionality

---

### Risk Mitigation

**Risk 1**: Video input path not accessible by FFmpeg
- **Mitigation**: Add path validation before starting export
- **Fallback**: Revert to frame rendering mode if video input fails

**Risk 2**: Sticker overlay filters incompatible with video input mode
- **Mitigation**: Test sticker filter chain construction thoroughly
- **Fallback**: Document which sticker types require frame rendering

**Risk 3**: Trim timing not accurate with video input mode
- **Mitigation**: Test trim start/end with various video formats
- **Fallback**: Add frame-accurate seeking using `-ss` before `-i` (fast) and after `-i` (accurate)

**Risk 4**: Performance not as expected
- **Mitigation**: Add detailed timing logs to identify bottlenecks
- **Fallback**: Profile FFmpeg execution to optimize encoding settings
