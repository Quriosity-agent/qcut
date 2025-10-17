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

### Task 2: Update FFmpeg Handler to Support Video File Input (~30 min)
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

### Task 3: Update CLI Export Engine Logic (~35 min)
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

### Task 4: Update TypeScript Type Definitions (~10 min)
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

### Task 5: Add Debug Logging and Console Messages (~10 min)
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

### Task 6: Testing and Validation (~15 min)

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
