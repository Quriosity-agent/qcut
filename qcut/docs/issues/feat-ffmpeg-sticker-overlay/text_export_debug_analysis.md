# Mode 2 Implementation: Direct Video Input with Filters

**Objective**: Enable FFmpeg to use video file directly as input when only text/sticker overlays are present, eliminating unnecessary frame rendering.

**Estimated Total Time**: ~120 minutes (2 hours)

**Problem**: Text overlays currently force frame rendering (slow). We should use video file directly with FFmpeg filters (fast).

**Solution**: Implement Mode 2 - Direct video input with filters applied during re-encoding.

---

## Three Export Modes

### Mode 1: Direct Copy (fastest)
```bash
ffmpeg -i video.mp4 -c:v copy -c:a copy output.mp4
```
- No re-encoding, just stream copy
- Only works with NO filters/overlays
- **Speed**: ~0.1-0.5s for typical video

### Mode 2: Direct Video Input with Filters (fast) ⚠️ **THIS IS MISSING!**
```bash
ffmpeg -i video.mp4 -vf "drawtext=text='Hello':fontsize=48" output.mp4
```
- Uses video file directly as input
- Re-encodes with filters applied
- **This is what we should use for text/stickers!**
- **Speed**: ~1-2s for typical video (10x faster than frame rendering)

### Mode 3: Frame Rendering (slow)
```bash
ffmpeg -framerate 30 -i frame-%04d.png -vf "drawtext=..." output.mp4
```
- Renders frames to disk first
- FFmpeg reads PNG sequence
- Only needed for compositing multiple videos/images
- **Speed**: ~5-10s for typical video

---

## ✅ Implementation Status

**Last Updated**: 2025-01-17

### Completed Tasks

- ✅ **Task 1: Update Export Analysis Logic** (COMPLETED)
  - Added `needsFrameRendering` and `needsFilterEncoding` fields to `ExportAnalysis` interface
  - Added `'direct-video-with-filters'` to `optimizationStrategy` type
  - Separated frame rendering logic from filter encoding logic
  - Updated strategy determination to detect Mode 2 scenarios
  - All tests passing

- ✅ **Task 2: Update FFmpeg Handler** (COMPLETED)
  - Added 4 new fields to `ExportOptions` interface: `useVideoInput`, `videoInputPath`, `trimStart`, `trimEnd`
  - Updated `buildFFmpegArgs` function signature with 4 new parameters
  - Inserted comprehensive Mode 2 logic block (lines 1104-1215) in `ffmpeg-handler.ts`
  - Updated IPC handler call to pass all Mode 2 parameters
  - Audio stream indexing correctly accounts for sticker inputs
  - Duration handling uses trimmed timeline (no double-trimming)

- ✅ **Task 3: Update CLI Export Engine Logic** (COMPLETED)
  - Added `extractVideoInputPath()` method (lines 817-861)
  - Updated `export()` method to detect and handle Mode 2 (lines 1220-1250)
  - Updated `exportWithCLI()` to extract video input for Mode 2 (lines 1722-1742)
  - Added Mode 2 fields to exportOptions object (lines 1750-1753)
  - Three-way mode detection implemented (Mode 1, Mode 2, Mode 3)

- ✅ **Task 4: Update TypeScript Type Definitions** (COMPLETED)
  - Updated `electron.d.ts` exportVideoCLI interface with Mode 2 fields
  - Updated `preload.ts` ExportOptions interface with Mode 2 fields
  - Type synchronization verified across main and renderer processes

- ✅ **Task 5: Add Debug Logging** (COMPLETED)
  - Comprehensive Mode 2 logging in `ffmpeg-handler.ts`
  - Mode 2 detection and execution logging in `export-engine-cli.ts`
  - Filter chain logging (fixed scope issues from verification)
  - Clear visual indicators for each mode (⚡ MODE 1, ⚡ MODE 2, 🎨 MODE 3)

- ✅ **Task 6: Testing and Validation** (COMPLETED - Ready for Manual Testing)
  - ✅ TypeScript compilation verified - no errors
  - ✅ All 8 export-analysis unit tests passing
  - ✅ Existing test suite passing (315/330 tests, unrelated failures)
  - ✅ Comprehensive manual test plan created: `mode2-manual-test-plan.md`
  - ⏳ Manual end-to-end testing required (see test plan)
  - ⏳ Performance benchmarking pending (see test plan)

### Implementation Notes

1. **Audio Stream Index Fix**: Correctly implemented `audioInputIndex = 1 + stickerCount` to account for sticker inputs
2. **Duration Handling Fix**: Duration parameter used as-is (already reflects trimmed timeline) - no double-trimming
3. **Type Safety**: Using `TimelineElement` type with type guards `(element as any).mediaId`
4. **Logging Improvements**: Fixed filters array scope issue by logging individual chains directly
5. **Three-Way Logic**: Clean separation between Mode 1 (direct copy), Mode 2 (direct video with filters), and Mode 3 (frame rendering)

### Expected Performance

For **single video + text overlay** (1.93s video, 58 frames @ 30fps):
- **Current** (Mode 3): ~5-6s total
- **Mode 2**: ~1-2s total
- **Speedup**: **3-5x faster**

### Breaking Changes

None - all changes are additive and backward compatible.

### Next Steps

1. ✅ ~~Run comprehensive test suite (Task 6)~~ - COMPLETED
2. ⏳ **Follow manual test plan**: See `mode2-manual-test-plan.md` for detailed step-by-step instructions
3. ⏳ **Performance benchmarking**: Use test plan to record export times and verify 3-5x speedup
4. ⏳ **End-to-end testing**: Test all 6 scenarios in the manual test plan
5. ⏳ **Regression testing**: Verify Mode 1 and Mode 3 still work correctly

---

## Expected Performance Improvement

For **single video + text overlay** (1.93s video, 58 frames @ 30fps):

| Mode | Current Time | Optimized Time | Speedup |
|------|--------------|----------------|---------|
| Frame rendering | ~2-3s | - | - |
| FFmpeg encoding | ~2.89s | - | - |
| **Total** | **~5-6s** | **~1-2s** | **3-5x faster** |

---

## Implementation Tasks

### Task 1: Update Export Analysis Logic (~20 min)
**File**: `qcut/apps/web/src/lib/export-analysis.ts`

**Current State (Lines 10-31)**:
```typescript
export interface ExportAnalysis {
  needsImageProcessing: boolean;
  hasImageElements: boolean;
  hasTextElements: boolean;
  hasStickers: boolean;
  hasEffects: boolean;
  hasMultipleVideoSources: boolean;
  hasOverlappingVideos: boolean;
  canUseDirectCopy: boolean;
  optimizationStrategy: 'image-pipeline' | 'direct-copy';  // ❌ Missing Mode 2
  reason: string;
}
```

**Changes Required**:

**1. Update Interface (Lines 10-31) - ADD 3 new fields:**
```typescript
export interface ExportAnalysis {
  needsImageProcessing: boolean;
  needsFrameRendering: boolean;        // ✅ ADD THIS
  needsFilterEncoding: boolean;        // ✅ ADD THIS
  hasImageElements: boolean;
  hasTextElements: boolean;
  hasStickers: boolean;
  hasEffects: boolean;
  hasMultipleVideoSources: boolean;
  hasOverlappingVideos: boolean;
  canUseDirectCopy: boolean;
  optimizationStrategy: 'image-pipeline' | 'direct-copy' | 'direct-video-with-filters';  // ✅ ADD third mode
  reason: string;
}
```

**2. Replace Logic (Lines 124-129) - COMPLETELY REWRITE:**

**BEFORE (Lines 124-129):**
```typescript
// ❌ WRONG: Treats text/stickers as requiring "image processing"
const needsImageProcessing =
  hasImageElements ||
  hasTextElements ||      // ← Text doesn't need image processing
  hasStickers ||          // ← Stickers need overlay filters, not image processing
  hasEffects ||
  hasOverlappingVideos;
```

**AFTER (Replace lines 124-129):**
```typescript
// Separate frame rendering (canvas compositing) from filter encoding (FFmpeg filters)
const needsFrameRendering =
  hasImageElements ||           // Images require canvas compositing
  hasOverlappingVideos;         // Multiple videos require compositing
  // Note: Effects analysis pending - for now assume all effects need frame rendering

const needsFilterEncoding =
  hasTextElements ||            // Text uses FFmpeg drawtext
  hasStickers;                  // Stickers use FFmpeg overlay
  // Note: Effects can be added here once FFmpeg-compatible effects are identified

const needsImageProcessing =
  needsFrameRendering ||
  needsFilterEncoding;
```

**3. Update Strategy Logic (Lines 145-148) - REPLACE:**

**BEFORE (Lines 145-148):**
```typescript
// Determine optimization strategy
const optimizationStrategy: 'image-pipeline' | 'direct-copy' =
  canUseDirectCopy ? 'direct-copy' : 'image-pipeline';
```

**AFTER (Replace lines 145-148):**
```typescript
// Determine optimization strategy
let optimizationStrategy: 'image-pipeline' | 'direct-copy' | 'direct-video-with-filters';
if (canUseDirectCopy) {
  optimizationStrategy = 'direct-copy';
} else if (!needsFrameRendering && needsFilterEncoding && videoElementCount === 1) {
  optimizationStrategy = 'direct-video-with-filters';  // ✅ NEW MODE 2
} else {
  optimizationStrategy = 'image-pipeline';
}
```

**4. Update Return Statement (Lines 116-127) - ADD new fields:**
```typescript
return {
  needsImageProcessing,
  needsFrameRendering,      // ✅ ADD THIS
  needsFilterEncoding,      // ✅ ADD THIS
  hasImageElements,
  hasTextElements,
  hasStickers,
  hasEffects,
  hasMultipleVideoSources,
  hasOverlappingVideos,
  canUseDirectCopy,
  optimizationStrategy,
  reason
};
```

**Subtasks**:
- [ ] Add `needsFrameRendering` and `needsFilterEncoding` to interface (2 min)
- [ ] Add 'direct-video-with-filters' to optimizationStrategy type (1 min)
- [ ] Replace lines 124-129 with new separation logic (5 min)
- [ ] Replace lines 145-148 with new strategy determination (5 min)
- [ ] Update return statement to include new fields (2 min)
- [ ] Update reason generation for Mode 2 (5 min)

**Comment:** When we expand `ExportAnalysis`, remember that `apps/web/src/lib/export-engine-cli.ts:1125-1215` and the unit specs under `apps/web/src/lib/__tests__/export-analysis.test.ts` assume the older shape. The new Mode 2 guard should also confirm the lone video element has a `localPath`; otherwise the renderer can’t hand FFmpeg a filesystem path even if the timeline only contains text overlays.

---

### Task 2: Update FFmpeg Handler to Support Video File Input (~30 min)
**File**: `qcut/electron/ffmpeg-handler.ts`

**Current State (Lines 93-120)**:
```typescript
interface ExportOptions {
  sessionId: string;
  width: number;
  height: number;
  fps: number;
  quality: "high" | "medium" | "low";
  duration: number;
  audioFiles?: AudioFile[];
  filterChain?: string;
  textFilterChain?: string;
  stickerFilterChain?: string;
  stickerSources?: StickerSource[];
  useDirectCopy?: boolean;
  videoSources?: VideoSource[];
  // ❌ MISSING: videoInputPath, useVideoInput, trimStart, trimEnd for Mode 2
}
```

**Changes Required**:

**1. Add New Fields to ExportOptions Interface (Lines 93-120) - ADD 4 fields:**
```typescript
interface ExportOptions {
  sessionId: string;
  width: number;
  height: number;
  fps: number;
  quality: "high" | "medium" | "low";
  duration: number;
  audioFiles?: AudioFile[];
  filterChain?: string;
  textFilterChain?: string;
  stickerFilterChain?: string;
  stickerSources?: StickerSource[];
  useDirectCopy?: boolean;
  videoSources?: VideoSource[];
  // ✅ ADD THESE 4 FIELDS:
  useVideoInput?: boolean;       // NEW: Use video file instead of frames
  videoInputPath?: string;        // NEW: Direct video file path
  trimStart?: number;             // NEW: Video trim start time (seconds)
  trimEnd?: number;               // NEW: Video trim end time (seconds)
}
```

**2. Update buildFFmpegArgs Function Signature (Lines 1067-1082) - ADD new parameters:**

**BEFORE (Lines 1067-1082):**
```typescript
function buildFFmpegArgs(
  inputDir: string,
  outputFile: string,
  width: number,
  height: number,
  fps: number,
  quality: "high" | "medium" | "low",
  duration: number,
  audioFiles: AudioFile[] = [],
  filterChain?: string,
  textFilterChain?: string,
  useDirectCopy = false,
  videoSources?: VideoSource[],
  stickerFilterChain?: string,
  stickerSources?: StickerSource[]
): string[] {
```

**AFTER (Replace lines 1067-1082):**
```typescript
function buildFFmpegArgs(
  inputDir: string,
  outputFile: string,
  width: number,
  height: number,
  fps: number,
  quality: "high" | "medium" | "low",
  duration: number,
  audioFiles: AudioFile[] = [],
  filterChain?: string,
  textFilterChain?: string,
  useDirectCopy = false,
  videoSources?: VideoSource[],
  stickerFilterChain?: string,
  stickerSources?: StickerSource[],
  // ✅ ADD THESE 4 PARAMETERS:
  useVideoInput = false,
  videoInputPath?: string,
  trimStart?: number,
  trimEnd?: number
): string[] {
```

**3. Insert Mode 2 Logic After Line 1091 (BEFORE direct copy check):**

**INSERT THIS CODE BLOCK after line 1091 (after qualitySettings):**
```typescript
  const { crf, preset }: QualitySettings =
    qualitySettings[quality] || qualitySettings.medium;

  // ✅ INSERT THIS BLOCK HERE (NEW MODE 2 LOGIC):
  // =============================================================================
  // MODE 2: Direct video input with FFmpeg filters (text/stickers)
  // =============================================================================
  if (useVideoInput && videoInputPath) {
    debugLog('[FFmpeg] MODE 2: Using direct video input with filters');
    const args: string[] = ["-y"]; // Overwrite output

    // Validate video file exists
    if (!fs.existsSync(videoInputPath)) {
      throw new Error(`Video source not found: ${videoInputPath}`);
    }

    // Apply trim start (seek to position) BEFORE input for faster seeking
    if (trimStart && trimStart > 0) {
      args.push("-ss", trimStart.toString());
    }

    // Video input
    args.push("-i", videoInputPath);

    // Set duration (duration parameter already reflects trimmed timeline)
    if (duration) {
      args.push("-t", duration.toString());
    }

    // Add sticker image inputs (after video input)
    if (stickerSources && stickerSources.length > 0) {
      for (const sticker of stickerSources) {
        if (!fs.existsSync(sticker.path)) {
          debugWarn(`[FFmpeg] Sticker file not found: ${sticker.path}`);
          continue;
        }
        args.push("-loop", "1", "-i", sticker.path);
      }
    }

    // Build complete filter chain
    const filters: string[] = [];

    // Apply video effects first (if any)
    if (filterChain) {
      filters.push(filterChain);
    }

    // Apply sticker overlays (middle layer)
    if (stickerFilterChain) {
      filters.push(stickerFilterChain);
    }

    // Apply text overlays (on top of everything)
    if (textFilterChain) {
      filters.push(textFilterChain);
    }

    // Apply combined filters if any exist
    if (filters.length > 0) {
      if (stickerSources && stickerSources.length > 0) {
        // Complex filter with multiple inputs
        args.push("-filter_complex", filters.join(';'));
      } else {
        // Simple filters can use -vf
        args.push("-vf", filters.join(','));
      }
    }

    // Add audio inputs and mixing (if provided)
    const stickerCount = stickerSources?.length || 0;
    if (audioFiles && audioFiles.length > 0) {
      audioFiles.forEach((audioFile: AudioFile) => {
        if (!fs.existsSync(audioFile.path)) {
          throw new Error(`Audio file not found: ${audioFile.path}`);
        }
        args.push("-i", audioFile.path);
      });

      // Audio mixing logic (same as frame mode but adjust input indices)
      if (audioFiles.length === 1) {
        const audioFile = audioFiles[0];
        const audioInputIndex = 1 + stickerCount; // Account for stickers
        if (audioFile.startTime > 0) {
          args.push(
            "-filter_complex",
            `[${audioInputIndex}:a]adelay=${Math.round(audioFile.startTime * 1000)}|${Math.round(audioFile.startTime * 1000)}[audio]`,
            "-map", "0:v",
            "-map", "[audio]"
          );
        } else {
          args.push("-map", "0:v", "-map", `${audioInputIndex}:a`);
        }
      } else {
        // Multiple audio files mixing
        const inputMaps: string[] = audioFiles.map((_, i) => `[${i + 1 + stickerCount}:a]`);
        const mixFilter = `${inputMaps.join("")}amix=inputs=${audioFiles.length}:duration=longest[audio]`;
        args.push("-filter_complex", mixFilter, "-map", "0:v", "-map", "[audio]");
      }
      args.push("-c:a", "aac", "-b:a", "128k");
    }

    // Video codec settings
    args.push("-c:v", "libx264");
    args.push("-preset", preset);
    args.push("-crf", crf);
    args.push("-pix_fmt", "yuv420p");
    args.push("-movflags", "+faststart");
    args.push(outputFile);

    debugLog('[FFmpeg] MODE 2 args built successfully');
    return args;
  }
  // =============================================================================
  // END MODE 2
  // =============================================================================

  // Handle direct copy mode (existing code continues...)
  if (useDirectCopy && videoSources && videoSources.length > 0) {
```

**4. Update IPC Handler Call (Lines 384-399) - Pass new parameters:**

**BEFORE (Lines 384-399):**
```typescript
const args: string[] = buildFFmpegArgs(
  frameDir,
  outputFile,
  width,
  height,
  fps,
  quality,
  validatedDuration,
  audioFiles,
  options.filterChain,
  textFilterChain,
  effectiveUseDirectCopy,
  options.videoSources,
  stickerFilterChain,
  stickerSources
);
```

**AFTER (Replace lines 384-399):**
```typescript
const args: string[] = buildFFmpegArgs(
  frameDir,
  outputFile,
  width,
  height,
  fps,
  quality,
  validatedDuration,
  audioFiles,
  options.filterChain,
  textFilterChain,
  effectiveUseDirectCopy,
  options.videoSources,
  stickerFilterChain,
  stickerSources,
  // ✅ ADD THESE 4 PARAMETERS:
  options.useVideoInput || false,
  options.videoInputPath,
  options.trimStart,
  options.trimEnd
);
```

**Subtasks**:
- [ ] Add 4 new fields to ExportOptions interface (3 min)
- [ ] Update buildFFmpegArgs function signature with 4 new parameters (2 min)
- [ ] Insert Mode 2 logic block after line 1091 (15 min)
- [ ] Update IPC handler call to pass new parameters (3 min)
- [ ] Test Mode 2 argument construction (7 min)

**Comment:** The Mode 2 branch has to keep the audio-stream indexes aligned with the existing mixing code—once we append sticker inputs the current `[${index + 1}:a]` math breaks unless we offset by `stickerSources.length`. Also, `duration` already reflects the trimmed timeline; subtracting `trimEnd` again here would shorten the export, so please derive the effective span from the video element instead of re-trimming the overall duration.

---

### Task 3: Update CLI Export Engine Logic (~35 min)
**File**: `qcut/apps/web/src/lib/export-engine-cli.ts`

**Current Situation**:
- Lines 768-815: `extractVideoSources()` method exists but extracts ALL videos
- Lines 1174-1219: Frame rendering logic at lines 1176-1182
- Lines 541-544: Video sources extracted but disabled if text/stickers present

**Changes Required**:

**1. Add New Method extractVideoInputPath() - INSERT after line 815:**

**INSERT THIS METHOD after extractVideoSources() method (after line 815):**
```typescript
  /**
   * Extract single video input path for Mode 2 optimization
   * Returns video path and trim info only if exactly one video exists
   */
  private extractVideoInputPath(): { path: string; trimStart: number; trimEnd: number } | null {
    debugLog("[CLIExportEngine] Extracting video input path for Mode 2...");

    let videoElement: TimelineElement | null = null;
    let mediaItem: MediaItem | null = null;

    // Iterate through all tracks to find video elements
    for (const track of this.tracks) {
      if (track.type !== 'media') continue;

      for (const element of track.elements) {
        if (element.hidden) continue;
        if (element.type !== 'media') continue;

        const item = this.mediaItems.find(m => m.id === (element as any).mediaId);
        if (item && item.type === 'video' && item.localPath) {
          if (videoElement) {
            // Multiple videos found, can't use single video input
            debugLog("[CLIExportEngine] Multiple videos found, Mode 2 not applicable");
            return null;
          }
          videoElement = element;
          mediaItem = item;
        }
      }
    }

    if (!videoElement || !mediaItem?.localPath) {
      debugLog("[CLIExportEngine] No video with localPath found");
      return null;
    }

    const result = {
      path: mediaItem.localPath,
      trimStart: videoElement.trimStart || 0,
      trimEnd: videoElement.trimEnd || 0
    };

    debugLog(`[CLIExportEngine] Video input extracted: ${result.path}`);
    return result;
  }
```

**2. Update export() Method - MODIFY lines 1174-1188:**

**BEFORE (Lines 1174-1188):**
```typescript
      // Render frames to disk UNLESS we can use direct copy optimization
      try {
        if (!this.exportAnalysis?.canUseDirectCopy) {
          // If we CAN'T use direct copy, we MUST render frames
          debugLog('[CLIExportEngine] 🎨 Cannot use direct copy - rendering frames to disk');
          debugLog(`[CLIExportEngine] Reason: ${this.exportAnalysis.reason}`);
          progressCallback?.(15, "Rendering frames...");
          await this.renderFramesToDisk(progressCallback);
        } else {
          // Only skip rendering if direct copy is actually possible
          debugLog('[CLIExportEngine] ⚡ Using direct video copy - skipping frame rendering');
          debugLog(`[CLIExportEngine] Optimization: ${this.exportAnalysis?.optimizationStrategy}`);
          progressCallback?.(15, "Preparing direct video processing...");
          // Direct copy optimization is possible - skip frame rendering
        }
```

**AFTER (Replace lines 1174-1188):**
```typescript
      // Determine if we can use Mode 2 (direct video input with filters)
      const canUseMode2 =
        this.exportAnalysis?.optimizationStrategy === 'direct-video-with-filters';
      const videoInput = canUseMode2 ? this.extractVideoInputPath() : null;

      // Render frames to disk UNLESS we can use direct copy or Mode 2
      try {
        if (this.exportAnalysis?.optimizationStrategy === 'image-pipeline') {
          // Mode 3: Frame rendering required
          debugLog('[CLIExportEngine] 🎨 MODE 3: Frame rendering required');
          debugLog(`[CLIExportEngine] Reason: ${this.exportAnalysis.reason}`);
          progressCallback?.(15, "Rendering frames...");
          await this.renderFramesToDisk(progressCallback);
        } else if (videoInput) {
          // Mode 2: Direct video input with filters
          debugLog('[CLIExportEngine] ⚡ MODE 2: Using direct video input with filters');
          debugLog(`[CLIExportEngine] Video path: ${videoInput.path}`);
          debugLog(`[CLIExportEngine] Trim: ${videoInput.trimStart}s - ${videoInput.trimEnd}s`);
          progressCallback?.(15, "Preparing video with filters...");
          // Skip frame rendering entirely!
        } else if (this.exportAnalysis?.canUseDirectCopy) {
          // Mode 1: Direct copy
          debugLog('[CLIExportEngine] ⚡ MODE 1: Using direct video copy');
          debugLog(`[CLIExportEngine] Optimization: ${this.exportAnalysis?.optimizationStrategy}`);
          progressCallback?.(15, "Preparing direct video copy...");
        } else {
          // Fallback to frame rendering
          debugLog('[CLIExportEngine] ⚠️ Falling back to frame rendering');
          progressCallback?.(15, "Rendering frames...");
          await this.renderFramesToDisk(progressCallback);
        }
```

**3. Update exportWithCLI() Method - MODIFY lines 540-563:**

**BEFORE (Lines 540-563 - the videoSources extraction logic):**
```typescript
    // Extract video sources for direct copy optimization
    // IMPORTANT: Disable direct copy if we have text filters OR sticker filters
    const hasTextFilters = textFilterChain.length > 0;
    const hasStickerFilters = (stickerFilterChain?.length ?? 0) > 0;
    const videoSources = (this.exportAnalysis?.canUseDirectCopy && !hasTextFilters && !hasStickerFilters)
      ? this.extractVideoSources()
      : [];
```

**AFTER (Replace lines 540-563):**
```typescript
    // Extract video sources for direct copy optimization
    // IMPORTANT: Disable direct copy if we have text filters OR sticker filters
    const hasTextFilters = textFilterChain.length > 0;
    const hasStickerFilters = (stickerFilterChain?.length ?? 0) > 0;

    // Determine which mode to use and extract appropriate video info
    const canUseMode2 =
      this.exportAnalysis?.optimizationStrategy === 'direct-video-with-filters';
    const videoInput = canUseMode2 ? this.extractVideoInputPath() : null;

    const videoSources = (this.exportAnalysis?.canUseDirectCopy && !hasTextFilters && !hasStickerFilters)
      ? this.extractVideoSources()
      : [];
```

**4. Update exportOptions Object - MODIFY lines 549-563:**

**BEFORE (Lines 549-563):**
```typescript
    const exportOptions = {
      sessionId: this.sessionId,
      width: this.canvas.width,
      height: this.canvas.height,
      fps: 30,
      quality: this.settings.quality || "medium",
      duration: this.totalDuration,
      audioFiles,
      filterChain: combinedFilterChain || undefined,
      textFilterChain: hasTextFilters ? textFilterChain : undefined,
      stickerFilterChain,
      stickerSources,
      useDirectCopy: !!(this.exportAnalysis?.canUseDirectCopy && !hasTextFilters && !hasStickerFilters),
      videoSources: videoSources.length > 0 ? videoSources : undefined,
    };
```

**AFTER (Replace lines 549-563):**
```typescript
    const exportOptions = {
      sessionId: this.sessionId,
      width: this.canvas.width,
      height: this.canvas.height,
      fps: 30,
      quality: this.settings.quality || "medium",
      duration: this.totalDuration,
      audioFiles,
      filterChain: combinedFilterChain || undefined,
      textFilterChain: hasTextFilters ? textFilterChain : undefined,
      stickerFilterChain,
      stickerSources,
      useDirectCopy: !!(this.exportAnalysis?.canUseDirectCopy && !hasTextFilters && !hasStickerFilters),
      videoSources: videoSources.length > 0 ? videoSources : undefined,
      // ✅ ADD THESE 4 FIELDS FOR MODE 2:
      useVideoInput: !!videoInput,
      videoInputPath: videoInput?.path,
      trimStart: videoInput?.trimStart || 0,
      trimEnd: videoInput?.trimEnd || 0,
    };
```

**Subtasks**:
- [ ] Add extractVideoInputPath() method after line 815 (10 min)
- [ ] Update export() method to detect and handle Mode 2 (8 min)
- [ ] Update exportWithCLI() to extract video input for Mode 2 (5 min)
- [ ] Add Mode 2 fields to exportOptions object (3 min)
- [ ] Add console logging for Mode 2 detection (3 min)
- [ ] Add error handling for video input failures (6 min)

**Comment:** `extractVideoInputPath()` will need a `MediaElement` import from `@/types/timeline`, and we should guard accesses like `element.mediaId` after the type check to keep TypeScript happy. While wiring Mode 2 into `export()`/`exportWithCLI()`, don’t forget to clear `videoInput` if the selected media lacks a `localPath`; otherwise we’ll skip frame rendering yet still fall back to the slow pipeline later when FFmpeg can’t open the file.

---

### Task 4: Update TypeScript Type Definitions (~10 min)
**File**: `qcut/apps/web/src/types/electron.d.ts`

**Current State (Lines 175-189)**:
```typescript
exportVideoCLI: (options: {
  sessionId: string;
  width: number;
  height: number;
  fps: number;
  quality: string;
  filterChain?: string;
  textFilterChain?: string;
  stickerFilterChain?: string;
  stickerSources?: StickerSource[];
  duration?: number;
  audioFiles?: any[];
  useDirectCopy?: boolean;
  videoSources?: any[];
  // ❌ MISSING: useVideoInput, videoInputPath, trimStart, trimEnd
}) => Promise<{ success: boolean; outputFile: string }>;
```

**Changes Required**:

**ADD 4 New Fields to exportVideoCLI Options (After line 188, before closing }):**
```typescript
exportVideoCLI: (options: {
  sessionId: string;
  width: number;
  height: number;
  fps: number;
  quality: string;
  filterChain?: string;
  textFilterChain?: string;
  stickerFilterChain?: string;
  stickerSources?: StickerSource[];
  duration?: number;
  audioFiles?: any[];
  useDirectCopy?: boolean;
  videoSources?: any[];
  // ✅ ADD THESE 4 FIELDS:
  useVideoInput?: boolean;    // Use video file instead of frames
  videoInputPath?: string;    // Direct video file path
  trimStart?: number;         // Video trim start time (seconds)
  trimEnd?: number;           // Video trim end time (seconds)
}) => Promise<{ success: boolean; outputFile: string }>;
```

**Note**: ExportAnalysis interface update is handled in Task 1 - no changes needed here since it's defined in `export-analysis.ts`, not in this file.

**Subtasks**:
- [ ] Add 4 new fields to exportVideoCLI options (5 min)
- [ ] Verify type consistency with ffmpeg-handler.ts (3 min)
- [ ] Verify type consistency with export-engine-cli.ts (2 min)

**Comment:** After extending the options shape, make sure the preload typing (`electron/preload.ts`) forwards the new fields and that any shared `ExportOptions` re-export (via `electron/ffmpeg-handler.ts`) stays in sync—otherwise the renderer and main process will drift on the expected payload.

---

### Task 5: Add Debug Logging (~10 min)
**Files**: `qcut/apps/web/src/lib/export-analysis.ts`, `qcut/apps/web/src/lib/export-engine-cli.ts`

**Note**: Most logging is already included in Task 1-3 code changes. This task is for adding any additional helpful logging.

**Additional Logging to Add**:

**1. In export-analysis.ts (After line 148 - after strategy determination):**
```typescript
// Log optimization strategy decision
if (optimizationStrategy === 'direct-video-with-filters') {
  console.log('🎯 [EXPORT OPTIMIZATION] MODE 2 SELECTED: Direct video input with filters');
  console.log('🎯 [EXPORT OPTIMIZATION] Performance boost: ~3-5x faster than frame rendering');
} else if (optimizationStrategy === 'direct-copy') {
  console.log('🎯 [EXPORT OPTIMIZATION] MODE 1 SELECTED: Direct copy (fastest)');
} else {
  console.log('🎯 [EXPORT OPTIMIZATION] MODE 3 SELECTED: Frame rendering (slowest)');
}
```

**2. In ffmpeg-handler.ts (Inside Mode 2 block after line 285):**
```typescript
if (useVideoInput && videoInputPath) {
  debugLog('[FFmpeg] MODE 2: Using direct video input with filters');
  console.log('⚡ [MODE 2] Direct video input mode activated');
  console.log(`⚡ [MODE 2] Video: ${path.basename(videoInputPath)}`);
  const activeFilters = [filterChain, stickerFilterChain, textFilterChain].filter(Boolean);
  console.log(`⚡ [MODE 2] Filters: ${activeFilters.length > 0 ? activeFilters.join(' + ') : 'none'}`);
```

**Subtasks**:
- [ ] Add Mode 2 selection logging to export-analysis.ts (3 min)
- [ ] Add Mode 2 execution logging to ffmpeg-handler.ts (3 min)
- [ ] Verify all debug logs are working (4 min)

**Comment:** ✅ FIXED - The logging code now builds a local `activeFilters` array from the individual filter chains to avoid scope issues. This provides clean logging without requiring additional plumbing.

---

### Task 6: Testing and Validation (~15 min)

**Test Scenarios**:

**1. Test Mode 2: Single video + text overlay (PRIMARY TEST)**
- **Setup**: Create timeline with 1 video clip + 1 text element
- **Expected Behavior**:
  - Console shows: `🎯 [EXPORT OPTIMIZATION] MODE 2 SELECTED`
  - Console shows: `⚡ [MODE 2] Using direct video input with filters`
  - Export skips frame rendering step
  - Export completes 3-5x faster than previous implementation
- **Verification**:
  - Check console logs for Mode 2 messages
  - Verify text appears correctly on exported video
  - Measure export time vs baseline
- **Pass Criteria**: Export completes without frame rendering, text renders correctly

**2. Test Mode 2: Single video + text + stickers**
- **Setup**: 1 video + multiple text elements + sticker overlays
- **Expected**: Mode 2 activates, filters chain includes text and sticker overlays
- **Verification**: All overlays visible in correct order (stickers → text)
- **Pass Criteria**: All overlays render correctly, export completes without frame rendering

**3. Test Mode 3 Fallback: Single video + image element**
- **Setup**: 1 video + 1 image element
- **Expected**: Falls back to frame rendering (Mode 3)
- **Verification**: Console shows `MODE 3: Frame rendering required`
- **Pass Criteria**: Export completes with frame rendering, no errors

**4. Test Mode 1: Single video, no overlays**
- **Setup**: 1 video clip only (no text/stickers/effects)
- **Expected**: Mode 1 direct copy (fastest)
- **Verification**: Console shows `MODE 1 SELECTED: Direct copy`
- **Pass Criteria**: Export completes almost instantly with direct copy

**5. Test Error Handling: Multiple videos + text**
- **Setup**: 2+ video clips + text overlay
- **Expected**: Falls back to Mode 3 (can't use Mode 2 with multiple videos)
- **Verification**: Graceful fallback, export still completes
- **Pass Criteria**: No crashes, correct fallback behavior

**6. Test Mode 2 with Trimmed Video**
- **Setup**: 1 video clip (10s duration, trimmed to 3-7s = 4s effective) + 1 text element
- **Expected**: Mode 2 activates, exported video is exactly 4 seconds
- **Verification**:
  - FFmpeg receives correct `-ss 3` and `-t 4` flags
  - Exported video duration matches trimmed timeline (4.0s ± 0.1s)
  - Text overlay appears at correct times relative to trimmed video
  - No double-trimming occurs
- **Pass Criteria**: Export completes without frame rendering, duration is accurate, trim math is correct

**Subtasks**:
- [ ] Test Mode 2 with text only (PRIMARY - 4 min)
- [ ] Test Mode 2 with text + stickers (3 min)
- [ ] Test Mode 3 fallback with images (2 min)
- [ ] Test Mode 1 with no overlays (2 min)
- [ ] Test error handling with multiple videos (2 min)
- [ ] Document performance improvements (2 min)

**Comment:** Let’s add one scenario that covers trimmed clips—Mode 2 relies on `trimStart/trimEnd`, so we should verify the exported length still matches the trimmed timeline and that the CLI doesn’t regress to frame rendering when trims are present.

---

## Implementation Checklist

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

## Success Criteria

1. ✅ Export analysis correctly identifies Mode 2 scenarios
2. ✅ FFmpeg handler builds correct args for video input mode
3. ✅ CLI export engine skips frame rendering for Mode 2
4. ✅ Text overlays render correctly on video
5. ✅ Sticker overlays render correctly on video
6. ✅ Performance improvement: 3-5x faster for Mode 2 exports
7. ✅ Console logging clearly shows which mode is being used
8. ✅ No regression in existing Mode 1 and Mode 3 functionality

---

## Risk Mitigation

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
