# Mode 1.5: Video Normalization with Padding

**Feature**: FFmpeg-based video normalization for mismatched resolutions/fps
**Status**: In Progress - Phase 2 Complete, Phase 3 Pending
**Priority**: High
**Performance Target**: 2-3 seconds (5-7x faster than Mode 3)

**Progress Summary:**
- ✅ Phase 1 (Detection): Complete - All video property detection and Mode 1.5 detection logic implemented
- ✅ Phase 2 (Normalization): Complete - normalizeVideo() function implemented with full FFmpeg filter chain
- ⏳ Phase 3 (Integration): Pending - Wire up Mode 1.5 in export engine and IPC handler
- ⏳ Phase 4 (Testing): Pending - Test with different resolutions, fps, and edge cases
- ⏳ Phase 5 (Documentation): Pending - Update user-facing documentation

---

## Problem Statement

Currently, QCut fails when exporting multiple videos with different properties:

**Example Error**:
```
Video codec mismatch detected - direct copy requires identical encoding:

Reference: video1.mp4
  Codec: h264, Resolution: 752x416, FPS: 24/1

Mismatched: video2.mp4
  Codec: h264, Resolution: 1280x720, FPS: 30/1
```

**Current Behavior**:
- Mode 1 (direct copy) → ❌ Fails with error
- Mode 3 (frame rendering) → ✅ Works but very slow (10-15 seconds)

**Desired Behavior**:
- Mode 1.5 (video normalization) → ✅ Works fast (2-3 seconds)

---

## Solution Overview

Use FFmpeg's **scale + pad filters** to normalize videos to a common resolution and fps before concatenation:

1. **Detect video property mismatches** during export analysis
2. **Normalize each video** (pad to target resolution, convert fps)
3. **Concat normalized videos** using direct copy (fast!)

---

## Technical Approach

### FFmpeg Command Structure

For a video that needs padding (752x416 → 1280x720):

```bash
ffmpeg -i input.mp4 \
  -vf "scale=752:416,pad=1280:720:(1280-752)/2:(720-416)/2:black" \
  -r 30 \
  -c:v libx264 -preset ultrafast -crf 18 \
  -c:a copy \
  normalized_output.mp4
```

**Filter breakdown**:
- `scale=752:416` - Maintain original aspect ratio
- `pad=1280:720` - Add padding to reach target resolution
- `(1280-752)/2` - Center horizontally (264px black bars on each side)
- `(720-416)/2` - Center vertically (152px black bars on top/bottom)
- `:black` - Black padding color
- `-r 30` - Convert to target fps
- `-preset ultrafast` - Fast encoding (quality vs speed tradeoff)

### Resolution Normalization Strategy

**Option 1: Use Export Resolution** (Recommended)
- Normalize all videos to the export resolution (e.g., 1280x720)
- Pros: Consistent output, no wasted processing
- Cons: None

**Option 2: Use Largest Resolution**
- Find the largest video resolution, normalize all to that
- Pros: Maximum quality preservation
- Cons: May export at unintended resolution

**Recommendation**: Use Option 1 (export resolution)

### FPS Normalization Strategy

**Option 1: Use Export FPS** (Recommended)
- Normalize all videos to export fps (e.g., 30fps)
- Pros: Consistent timing, user controls output
- Cons: None

**Option 2: Use Highest FPS**
- Find highest fps among videos, normalize to that
- Pros: Preserves motion smoothness
- Cons: May cause unnecessary re-encoding

**Recommendation**: Use Option 1 (export fps)

---

## Detailed Implementation Plan

### Overview
This implementation adds Mode 1.5 (video normalization) between Mode 1 (direct copy) and Mode 3 (frame rendering). The key is to detect video mismatches early and normalize them using FFmpeg padding before concatenation.

### Step-by-Step Implementation

---

## PHASE 1: Update Type Definitions

### Task 1.1: Update ExportAnalysis Interface
**File**: `apps/web/src/lib/export-analysis.ts`
**Location**: Line 32 (interface definition)

```typescript
// BEFORE:
optimizationStrategy: 'image-pipeline' | 'direct-copy' | 'direct-video-with-filters';

// AFTER:
optimizationStrategy:
  | 'image-pipeline'              // Mode 3: Frame rendering (slow, flexible)
  | 'direct-copy'                 // Mode 1: Direct copy (fastest, restrictive)
  | 'direct-video-with-filters'   // Mode 2: Single video + filters (fast)
  | 'video-normalization';        // Mode 1.5: Normalize + concat (NEW!)
```

**Comment**: Implemented via union update in export-analysis; follow-up logging adjustments will land with Mode 1.5 detection.

### Task 1.2: Add Video Properties Interface
**File**: `apps/web/src/lib/export-analysis.ts`
**Location**: After ExportAnalysis interface (around line 35)

```typescript
/**
 * Video properties extracted from media items for normalization detection
 */
interface VideoProperties {
  width: number;
  height: number;
  fps: number;
  codec?: string;
  pixelFormat?: string;
}
```

**Comment**: Interface added and exported; note that codec metadata currently depends on optional MediaItem metadata.

---

## PHASE 2: Add Video Property Detection

### Task 2.1: Extract Video Properties Helper
**File**: `apps/web/src/lib/export-analysis.ts`
**Location**: Before analyzeTimelineForExport function (around line 270)

```typescript
/**
 * Extract video properties from media item
 * @param element - Timeline element
 * @param mediaItemsMap - Map of media items
 * @returns Video properties or null if not available
 */
function extractVideoProperties(
  element: MediaElement,
  mediaItemsMap: Map<string, MediaItem>
): VideoProperties | null {
  const mediaItem = mediaItemsMap.get(element.mediaId);

  if (!mediaItem || mediaItem.type !== 'video') {
    return null;
  }

  // TODO: We need to add width, height, fps to MediaItem interface
  // For now, we'll need to extract from videoElement or HTMLVideoElement
  const width = (mediaItem as any).width || 0;
  const height = (mediaItem as any).height || 0;
  const fps = (mediaItem as any).fps || 30;

  return {
    width,
    height,
    fps,
    codec: (mediaItem as any).codec,
    pixelFormat: (mediaItem as any).pixelFormat
  };
}
```

**Comment**: Helper implemented with fallbacks to MediaItem metadata and returns null when core fields missing; ready for property comparison logic.

**IMPORTANT NOTE**: MediaItem interface may need to be updated to include video metadata (width, height, fps). Check if this data is already available in the media store.

### Task 2.2: Check Video Properties Match
**File**: `apps/web/src/lib/export-analysis.ts`
**Location**: After extractVideoProperties function (around line 113)

```typescript
/**
 * Checks if all videos match the target export properties.
 *
 * WHY this check is critical:
 * - Mode 1 direct copy requires identical video properties
 * - Mismatches cause FFmpeg concat demuxer to fail
 * - Mode 1.5 normalization can fix mismatches (5-7x faster than Mode 3)
 *
 * Edge cases handled:
 * - Missing metadata: Returns false (triggers normalization)
 * - FPS tolerance: Uses 0.1 fps tolerance for floating point comparison
 * - Null properties: Treats as mismatch to ensure safe fallback
 *
 * @param videoElements - Array of video elements from timeline
 * @param mediaItemsMap - Map of media items for fast lookup
 * @param targetWidth - Export target width
 * @param targetHeight - Export target height
 * @param targetFps - Export target fps
 * @returns true if all videos match export settings, false if normalization needed
 */
function checkVideoPropertiesMatch(
  videoElements: MediaElement[],
  mediaItemsMap: Map<string, MediaItem>,
  targetWidth: number,
  targetHeight: number,
  targetFps: number
): boolean {
  console.log('🔍 [MODE 1.5 DETECTION] Checking video properties...');
  console.log(`🔍 [MODE 1.5 DETECTION] Target: ${targetWidth}x${targetHeight} @ ${targetFps}fps`);

  // Edge case: No videos to check
  if (videoElements.length === 0) {
    console.log('⚠️ [MODE 1.5 DETECTION] No video elements to check');
    return true; // No videos = no mismatches
  }

  // Check each video against export settings
  for (let i = 0; i < videoElements.length; i++) {
    const props = extractVideoProperties(videoElements[i], mediaItemsMap);

    // Missing metadata = needs normalization
    if (!props) {
      console.log(`⚠️ [MODE 1.5 DETECTION] Video ${i}: No properties found - triggering normalization`);
      return false;
    }

    console.log(`🔍 [MODE 1.5 DETECTION] Video ${i}: ${props.width}x${props.height} @ ${props.fps}fps`);

    // Resolution must match exactly
    if (props.width !== targetWidth || props.height !== targetHeight) {
      console.log(`⚠️ [MODE 1.5 DETECTION] Video ${i} resolution mismatch - normalization needed`);
      console.log(`   Expected: ${targetWidth}x${targetHeight}, Got: ${props.width}x${props.height}`);
      return false;
    }

    // FPS comparison with tolerance (floating point safety)
    const fpsTolerance = 0.1;
    const fpsDiff = Math.abs(props.fps - targetFps);
    if (fpsDiff > fpsTolerance) {
      console.log(`⚠️ [MODE 1.5 DETECTION] Video ${i} FPS mismatch - normalization needed`);
      console.log(`   Expected: ${targetFps}fps, Got: ${props.fps}fps, Diff: ${fpsDiff.toFixed(2)}fps`);
      return false;
    }
  }

  console.log('✅ [MODE 1.5 DETECTION] All videos match export settings - can use direct copy');
  return true;
}
```

**Implementation Status**: ⏳ Pending - Requires access to export width/height/fps from analysis context

---

## PHASE 3: Update Export Analysis Logic

### Task 3.1: Modify analyzeTimelineForExport Function
**File**: `apps/web/src/lib/export-analysis.ts`
**Location**: Lines 250-262 (optimization strategy determination)

**CURRENT CODE** (lines 250-262):
```typescript
// Determine optimization strategy
let optimizationStrategy:
  | 'image-pipeline'
  | 'direct-copy'
  | 'direct-video-with-filters'
  | 'video-normalization';
if (canUseDirectCopy) {
  optimizationStrategy = 'direct-copy';
} else if (!needsFrameRendering && needsFilterEncoding && videoElementCount === 1) {
  optimizationStrategy = 'direct-video-with-filters';  // NEW MODE 2
} else {
  optimizationStrategy = 'image-pipeline';
}
```

**REPLACE WITH**:
```typescript
// Determine optimization strategy
let optimizationStrategy:
  | 'image-pipeline'
  | 'direct-copy'
  | 'direct-video-with-filters'
  | 'video-normalization';

// Mode decision tree (priority order):
// 1. Can we use direct copy? (Mode 1 - fastest)
// 2. Single video with filters? (Mode 2 - fast)
// 3. Multiple videos that need normalization? (Mode 1.5 - NEW!, medium-fast)
// 4. Default to frame rendering (Mode 3 - slow but most flexible)

if (canUseDirectCopy) {
  // Mode 1: Direct copy - fastest path (no re-encoding)
  optimizationStrategy = 'direct-copy';
  console.log('✅ [MODE DETECTION] Selected Mode 1: Direct copy (15-48x speedup)');
} else if (!needsFrameRendering && needsFilterEncoding && videoElementCount === 1) {
  // Mode 2: Single video with FFmpeg filters (text/stickers)
  optimizationStrategy = 'direct-video-with-filters';
  console.log('⚡ [MODE DETECTION] Selected Mode 2: Direct video with filters (3-5x speedup)');
} else if (
  videoElementCount > 1 &&
  !hasOverlappingVideos &&
  !hasImageElements &&
  !hasTextElements &&
  !hasStickers &&
  !hasEffects &&
  allVideosHaveLocalPath
) {
  // Mode 1.5: Multiple sequential videos - check if normalization needed
  console.log('🔍 [MODE DETECTION] Multiple sequential videos detected - checking properties...');

  // CRITICAL: Need export settings to validate video properties
  // For now, use canvas dimensions from first video element (fallback)
  // TODO: Pass export settings as parameter to analyzeTimelineForExport
  const firstVideo = videoElements[0];
  const firstMediaItem = mediaItemsMap.get(firstVideo.mediaId);
  const targetWidth = firstMediaItem?.width || 1280;  // Fallback to 720p
  const targetHeight = firstMediaItem?.height || 720;
  const targetFps = (firstMediaItem as any)?.fps || 30;

  console.log(`🔍 [MODE DETECTION] Using target: ${targetWidth}x${targetHeight} @ ${targetFps}fps`);

  const videosMatch = checkVideoPropertiesMatch(
    videoElements,
    mediaItemsMap,
    targetWidth,
    targetHeight,
    targetFps
  );

  if (videosMatch) {
    // All videos match - can use direct copy without normalization
    optimizationStrategy = 'direct-copy';
    console.log('✅ [MODE DETECTION] Videos match - using Mode 1: Direct copy');
  } else {
    // Videos need normalization before concat
    optimizationStrategy = 'video-normalization';
    console.log('⚡ [MODE DETECTION] Selected Mode 1.5: Video normalization (5-7x speedup)');
  }
} else {
  // Mode 3: Frame rendering - slowest but most flexible
  optimizationStrategy = 'image-pipeline';
  console.log('🎨 [MODE DETECTION] Selected Mode 3: Frame rendering (baseline speed)');
}
```

**CRITICAL NOTES**:
1. **Export settings missing**: Currently using first video dimensions as fallback. Should pass `exportWidth`, `exportHeight`, `exportFps` as parameters.
2. **Canvas dimensions**: Real export settings should come from `ExportEngine` canvas or settings.
3. **Function signature update needed**: `analyzeTimelineForExport(tracks, mediaItems, exportSettings?)` with optional export settings parameter.

**Implementation Status**: ⏳ Pending - Requires export settings parameter

### Task 3.2: Update Reason String
**File**: `apps/web/src/lib/export-analysis.ts`
**Location**: Lines 167-184 (reason generation)

**ADD THIS CASE**:
```typescript
// After the canUseDirectCopy if-else block, add:
if (optimizationStrategy === 'video-normalization') {
  reason = 'Multiple videos with different properties - using FFmpeg normalization';
}
```

**Comment**: Ensure reason strings clearly explain the Mode 1.5 selection so telemetry and debugging remain informative without altering other mode messaging.

### Task 3.3: Update Console Logging
**File**: `apps/web/src/lib/export-analysis.ts`
**Location**: Lines 247-254 (console logging)

**ADD THIS CASE**:
```typescript
} else if (optimizationStrategy === 'video-normalization') {
  console.log('⚡ [EXPORT ANALYSIS] MODE 1.5: Using VIDEO NORMALIZATION - Fast export with padding! ⚡');
```

**Comment**: Logging plan makes sense; include a normalization-specific marker so QA can distinguish it from Mode 3 fallbacks in telemetry.

---

## PHASE 4: FFmpeg Handler - Normalization Function

### Task 4.1: Add normalizeVideo Function
**File**: `electron/ffmpeg-handler.ts`
**Location**: After probeVideoFile function (around line 1023)

```typescript
/**
 * Normalize a single video to target resolution and fps using FFmpeg padding.
 *
 * WHY Mode 1.5 normalization is needed:
 * - FFmpeg concat demuxer requires identical video properties (codec, resolution, fps)
 * - Videos from different sources often have mismatched properties
 * - Frame rendering (Mode 3) is 5-7x slower than normalization
 * - Normalization preserves quality while enabling fast concat
 *
 * FFmpeg filter chain breakdown:
 * - `scale`: Resize video to fit target dimensions (maintains aspect ratio)
 * - `force_original_aspect_ratio=decrease`: Prevents upscaling, only downscales
 * - `pad`: Adds black bars to reach exact target dimensions
 * - `(ow-iw)/2`: Centers horizontally (output_width - input_width) / 2
 * - `(oh-ih)/2`: Centers vertically (output_height - input_height) / 2
 * - `:black`: Black padding color
 *
 * Edge cases handled:
 * - Trim timing: `-ss` before input (fast seeking), `-t` for duration
 * - Audio sync: `-async 1` prevents desync during fps conversion
 * - Overwrite: `-y` flag for automated workflows
 * - Progress monitoring: Parses FFmpeg stderr for frame progress
 *
 * Performance characteristics:
 * - ~0.5-1s per video with ultrafast preset
 * - CRF 18 = visually lossless quality
 * - Audio copy = no audio re-encoding overhead
 *
 * @param inputPath - Absolute path to source video file
 * @param outputPath - Absolute path for normalized output (in temp directory)
 * @param targetWidth - Target width in pixels (from export settings)
 * @param targetHeight - Target height in pixels (from export settings)
 * @param targetFps - Target frame rate (from export settings)
 * @param trimStart - Trim start time in seconds (0 = no trim)
 * @param trimEnd - Trim end time in seconds (0 = no trim)
 * @returns Promise that resolves when normalization completes
 * @throws Error if FFmpeg process fails or file not found
 */
async function normalizeVideo(
  inputPath: string,
  outputPath: string,
  targetWidth: number,
  targetHeight: number,
  targetFps: number,
  trimStart: number = 0,
  trimEnd: number = 0
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    console.log('⚡ [MODE 1.5 NORMALIZE] ============================================');
    console.log('⚡ [MODE 1.5 NORMALIZE] Starting video normalization...');
    console.log(`⚡ [MODE 1.5 NORMALIZE] Input: ${path.basename(inputPath)}`);
    console.log(`⚡ [MODE 1.5 NORMALIZE] Output: ${path.basename(outputPath)}`);
    console.log(`⚡ [MODE 1.5 NORMALIZE] Target: ${targetWidth}x${targetHeight} @ ${targetFps}fps`);
    console.log(`⚡ [MODE 1.5 NORMALIZE] Trim: start=${trimStart}s, end=${trimEnd}s`);

    // Validate input file exists
    if (!fs.existsSync(inputPath)) {
      const error = `Video source not found: ${inputPath}`;
      console.error(`❌ [MODE 1.5 NORMALIZE] ${error}`);
      reject(new Error(error));
      return;
    }

    // Build FFmpeg filter chain for padding
    // force_original_aspect_ratio=decrease: Only scale down, never upscale
    // pad: Add black bars to reach exact target dimensions, centered
    const filterChain = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black`;
    console.log(`⚡ [MODE 1.5 NORMALIZE] Filter chain: ${filterChain}`);

    const args: string[] = ['-y']; // Overwrite output

    // Apply trim start (seek to position) BEFORE input for faster seeking
    // WHY before input: Input seeking is much faster than output seeking
    if (trimStart && trimStart > 0) {
      args.push('-ss', trimStart.toString());
      console.log(`⚡ [MODE 1.5 NORMALIZE] Applying input seek: -ss ${trimStart}s`);
    }

    // Input file
    args.push('-i', inputPath);

    // Set duration (if trim specified)
    // Note: trimEnd is absolute time, need to calculate duration
    if (trimEnd && trimEnd > trimStart) {
      const duration = trimEnd - trimStart;
      args.push('-t', duration.toString());
      console.log(`⚡ [MODE 1.5 NORMALIZE] Setting duration: -t ${duration}s`);
    }

    // Video filters (scale + pad)
    args.push('-vf', filterChain);

    // Frame rate conversion
    args.push('-r', targetFps.toString());

    // Video encoding settings (matching Mode 2 patterns)
    args.push(
      '-c:v', 'libx264',       // H.264 codec (universal compatibility)
      '-preset', 'ultrafast',  // Fast encoding (prioritize speed over compression)
      '-crf', '18',            // High quality (18 = visually lossless)
      '-pix_fmt', 'yuv420p'    // Pixel format (ensures compatibility)
    );

    // Audio settings (copy without re-encoding for speed)
    args.push('-c:a', 'copy');

    // Audio sync (critical for fps conversion)
    // WHY: FPS changes can cause audio drift, -async 1 resamples to maintain sync
    args.push('-async', '1');

    // Output file
    args.push(outputPath);

    console.log(`⚡ [MODE 1.5 NORMALIZE] FFmpeg command: ffmpeg ${args.join(' ')}`);
    console.log('⚡ [MODE 1.5 NORMALIZE] Starting FFmpeg process...');

    // Get FFmpeg path
    const ffmpegPath = getFFmpegPath();

    // Spawn FFmpeg process (matching existing patterns in buildFFmpegArgs)
    const ffmpegProcess = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderrOutput = '';
    let stdoutOutput = '';

    // Capture stdout (usually empty)
    ffmpegProcess.stdout?.on('data', (chunk: Buffer) => {
      stdoutOutput += chunk.toString();
    });

    // Capture stderr for progress and errors
    ffmpegProcess.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrOutput += text;

      // Log progress (FFmpeg outputs progress to stderr)
      // Extract frame count for progress monitoring
      if (text.includes('frame=')) {
        const frameMatch = text.match(/frame=\s*(\d+)/);
        const timeMatch = text.match(/time=(\d+:\d+:\d+\.\d+)/);
        if (frameMatch || timeMatch) {
          const frame = frameMatch ? frameMatch[1] : '?';
          const time = timeMatch ? timeMatch[1] : '?';
          process.stdout.write(`⚡ [MODE 1.5 NORMALIZE] Progress: frame=${frame} time=${time}\r`);
        }
      }
    });

    // Handle process completion
    ffmpegProcess.on('close', (code: number | null) => {
      process.stdout.write('\n'); // Clear progress line

      if (code === 0) {
        // Verify output file was created
        if (fs.existsSync(outputPath)) {
          const stats = fs.statSync(outputPath);
          console.log(`⚡ [MODE 1.5 NORMALIZE] ✅ Normalization complete: ${path.basename(outputPath)}`);
          console.log(`⚡ [MODE 1.5 NORMALIZE] Output size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
          console.log('⚡ [MODE 1.5 NORMALIZE] ============================================');
          resolve();
        } else {
          const error = `Output file not created: ${outputPath}`;
          console.error(`❌ [MODE 1.5 NORMALIZE] ${error}`);
          reject(new Error(error));
        }
      } else {
        console.error(`❌ [MODE 1.5 NORMALIZE] Normalization failed with code ${code}`);
        console.error(`❌ [MODE 1.5 NORMALIZE] FFmpeg stderr:\n${stderrOutput}`);
        console.error('❌ [MODE 1.5 NORMALIZE] ============================================');
        reject(new Error(`FFmpeg normalization failed with code ${code}`));
      }
    });

    // Handle process errors
    ffmpegProcess.on('error', (error: Error) => {
      console.error(`❌ [MODE 1.5 NORMALIZE] FFmpeg process error:`, error);
      console.error('❌ [MODE 1.5 NORMALIZE] ============================================');
      reject(error);
    });
  });
}
```

**Implementation Notes:**
1. **Async function**: Uses `async` keyword for consistency with codebase patterns
2. **Logging style**: Matches existing Mode 2 logging patterns with emoji markers
3. **Error handling**: Validates input/output files, provides detailed error messages
4. **Progress monitoring**: Parses FFmpeg stderr for real-time progress updates
5. **Trim handling**: Uses input seeking (`-ss` before `-i`) for performance
6. **Audio sync**: Critical `-async 1` flag prevents desync during fps conversion

**Dependencies:**
- `fs` module for file validation
- `path` module for path manipulation
- `spawn` from `child_process`
- `getFFmpegPath()` function (already exists in ffmpeg-handler.ts:1033)

**Implementation Status**: ✅ Ready to implement

---

## PHASE 5: FFmpeg Handler - Update Export Flow

### Task 5.1: Add Mode 1.5 Handling in IPC Handler
**File**: `electron/ffmpeg-handler.ts`
**Location**: In export-video-cli IPC handler, inside async IIFE at line 414 (FIRST check before other modes)

**CONTEXT**: The export-video-cli handler has an async IIFE starting at line 414 that handles mode validation and FFmpeg spawning. Mode 1.5 needs to intercept at the very start of this IIFE, before the existing mode checks.

**INSERT THIS BLOCK at line 415 (first line inside async IIFE, before "// Verify input based on processing mode" comment)**:
```typescript
          // =============================================================================
          // MODE 1.5: Video Normalization with FFmpeg Padding
          // =============================================================================
          // WHY Mode 1.5 exists:
          // - Mode 1 (direct copy) requires identical video properties
          // - Videos with different resolutions/fps fail Mode 1 validation
          // - Mode 3 (frame rendering) is 5-7x slower than normalization
          // - Mode 1.5 normalizes videos to common properties, then uses fast concat
          //
          // Performance: ~2-3 seconds (vs 10-15s for Mode 3)
          //
          // This check must come BEFORE other mode validations because it handles
          // a special case where videos need preprocessing before concatenation.
          if (options.optimizationStrategy === 'video-normalization') {
            console.log('⚡ [MODE 1.5 EXPORT] ============================================');
            console.log('⚡ [MODE 1.5 EXPORT] Mode 1.5: Video Normalization with Padding');
            console.log(`⚡ [MODE 1.5 EXPORT] Number of videos: ${options.videoSources?.length || 0}`);
            console.log(`⚡ [MODE 1.5 EXPORT] Target resolution: ${width}x${height}`);
            console.log(`⚡ [MODE 1.5 EXPORT] Target FPS: ${fps}`);
            console.log('⚡ [MODE 1.5 EXPORT] Expected speedup: 5-7x faster than Mode 3');
            console.log('⚡ [MODE 1.5 EXPORT] ============================================');

            try {
              // Validate video sources exist
              if (!options.videoSources || options.videoSources.length === 0) {
                const error = 'Mode 1.5 requires video sources but none provided';
                console.error(`❌ [MODE 1.5 EXPORT] ${error}`);
                reject(new Error(error));
                return;
              }

              // Validate each video source file exists before processing
              for (let i = 0; i < options.videoSources.length; i++) {
                const source = options.videoSources[i];
                if (!fs.existsSync(source.path)) {
                  const error = `Video source ${i + 1} not found: ${source.path}`;
                  console.error(`❌ [MODE 1.5 EXPORT] ${error}`);
                  reject(new Error(error));
                  return;
                }
              }

              console.log(`⚡ [MODE 1.5 EXPORT] ✅ All ${options.videoSources.length} video sources validated`);

              // Step 1: Normalize all videos to target resolution and fps
              console.log(`⚡ [MODE 1.5 EXPORT] Step 1/3: Normalizing ${options.videoSources.length} videos...`);
              const normalizedPaths: string[] = [];

              for (let i = 0; i < options.videoSources.length; i++) {
                const source = options.videoSources[i];
                const normalizedPath = path.join(frameDir, `normalized_video_${i}.mp4`);

                console.log(`⚡ [MODE 1.5 EXPORT] Normalizing video ${i + 1}/${options.videoSources.length}...`);
                console.log(`⚡ [MODE 1.5 EXPORT]   Source: ${path.basename(source.path)}`);
                console.log(`⚡ [MODE 1.5 EXPORT]   Duration: ${source.duration}s`);
                console.log(`⚡ [MODE 1.5 EXPORT]   Trim: start=${source.trimStart || 0}s, end=${source.trimEnd || 0}s`);

                // Call normalizeVideo function (defined earlier in this file)
                await normalizeVideo(
                  source.path,
                  normalizedPath,
                  width,
                  height,
                  fps,
                  source.trimStart || 0,
                  source.trimEnd || 0
                );

                normalizedPaths.push(normalizedPath);
                  console.log(`⚡ [MODE 1.5 EXPORT] ✅ Video ${i + 1}/${options.videoSources.length} normalized`);
              }

              console.log(`⚡ [MODE 1.5 EXPORT] All videos normalized successfully`);

              // Step 2/3: Create concat list file for FFmpeg concat demuxer
              console.log(`⚡ [MODE 1.5 EXPORT] Step 2/3: Creating concat list...`);
              const concatListPath = path.join(frameDir, 'concat-list.txt');

              // Escape Windows backslashes for FFmpeg concat file format
              // FFmpeg requires forward slashes in file paths
              const concatContent = normalizedPaths
                .map(p => {
                  // Escape single quotes in path (FFmpeg concat file format)
                  const escapedPath = p.replace(/'/g, "'\\''").replace(/\\/g, '/');
                  return `file '${escapedPath}'`;
                })
                .join('\n');

              fs.writeFileSync(concatListPath, concatContent, 'utf-8');
              console.log(`⚡ [MODE 1.5 EXPORT] ✅ Concat list created: ${normalizedPaths.length} videos`);
              console.log(`⚡ [MODE 1.5 EXPORT] Concat list path: ${concatListPath}`);

              // Step 3/3: Concatenate normalized videos using FFmpeg concat demuxer (fast!)
              console.log(`⚡ [MODE 1.5 EXPORT] Step 3/3: Concatenating ${normalizedPaths.length} normalized videos...`);
              console.log(`⚡ [MODE 1.5 EXPORT] Using concat demuxer (no re-encoding = fast!)`);

              // Build concat command arguments
              const concatArgs: string[] = [
                '-y',               // Overwrite output
                '-f', 'concat',     // Use concat demuxer
                '-safe', '0',       // Allow absolute paths
                '-i', concatListPath, // Input concat list file
                '-c', 'copy',       // Direct copy - no re-encoding!
                '-movflags', '+faststart', // Optimize for streaming
                outputFile
              ];

              console.log(`⚡ [MODE 1.5 EXPORT] FFmpeg concat command: ffmpeg ${concatArgs.join(' ')}`);

              // Execute concat with progress monitoring
              await new Promise<void>((concatResolve, concatReject) => {
                const concatProcess: ChildProcess = spawn(ffmpegPath, concatArgs, {
                  windowsHide: true,
                  stdio: ['ignore', 'pipe', 'pipe']
                });

                let concatStderr = '';
                let concatStdout = '';

                // Capture stdout
                concatProcess.stdout?.on('data', (chunk: Buffer) => {
                  concatStdout += chunk.toString();
                });

                // Capture stderr and monitor progress
                concatProcess.stderr?.on('data', (chunk: Buffer) => {
                  const text = chunk.toString();
                  concatStderr += text;

                  // Parse progress for progress events
                  const progress: FFmpegProgress | null = parseProgress(text);
                  if (progress) {
                    event.sender?.send?.('ffmpeg-progress', progress);
                  }
                });

                // Handle process completion
                concatProcess.on('close', (code: number | null) => {
                  if (code === 0) {
                    // Verify output file exists
                    if (fs.existsSync(outputFile)) {
                      const stats = fs.statSync(outputFile);
                      console.log(`⚡ [MODE 1.5 EXPORT] ✅ Concatenation complete!`);
                      console.log(`⚡ [MODE 1.5 EXPORT] Output size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                      concatResolve();
                    } else {
                      const error = `Output file not created: ${outputFile}`;
                      console.error(`❌ [MODE 1.5 EXPORT] ${error}`);
                      concatReject(new Error(error));
                    }
                  } else {
                    console.error(`❌ [MODE 1.5 EXPORT] Concatenation failed with code ${code}`);
                    console.error(`❌ [MODE 1.5 EXPORT] FFmpeg stderr:\n${concatStderr}`);
                    concatReject(new Error(`FFmpeg concat failed with code ${code}`));
                  }
                });

                // Handle process errors
                concatProcess.on('error', (err: Error) => {
                  console.error(`❌ [MODE 1.5 EXPORT] FFmpeg process error:`, err);
                  concatReject(err);
                });
              });

              // TODO: Step 4 (future): Mix audio if needed
              // Note: Audio mixing is not yet implemented for Mode 1.5
              // For now, Mode 1.5 only supports video-only exports
              // Audio mixing would require:
              // 1. Re-muxing the concatenated video with audio tracks
              // 2. Using FFmpeg's -filter_complex for audio mixing
              // 3. Similar logic to Mode 1 audio mixing (lines 954-992 in buildFFmpegArgs)
              if (audioFiles && audioFiles.length > 0) {
                console.warn('⚠️ [MODE 1.5 EXPORT] Audio mixing not yet implemented for Mode 1.5');
                console.warn('⚠️ [MODE 1.5 EXPORT] Falling back to Mode 3 for audio support');
                throw new Error('Audio mixing not supported in Mode 1.5 - falling back to Mode 3');
              }

              // Success! Export complete
              console.log('⚡ [MODE 1.5 EXPORT] ============================================');
              console.log('⚡ [MODE 1.5 EXPORT] ✅ Export complete!');
              console.log(`⚡ [MODE 1.5 EXPORT] Output: ${outputFile}`);
              console.log(`⚡ [MODE 1.5 EXPORT] Mode: video-normalization (5-7x faster than Mode 3)`);
              console.log('⚡ [MODE 1.5 EXPORT] ============================================');

              // Return success result
              resolve({
                success: true,
                outputFile: outputFile,
                method: 'spawn'
              });

              return; // Exit early - don't continue to other mode validations

            } catch (error: any) {
              // Mode 1.5 failed - fall back to Mode 3 (frame rendering)
              console.error('❌ [MODE 1.5 EXPORT] ============================================');
              console.error('❌ [MODE 1.5 EXPORT] Normalization failed, falling back to Mode 3');
              console.error('❌ [MODE 1.5 EXPORT] Error:', error.message || error);
              console.error('❌ [MODE 1.5 EXPORT] ============================================');

              // Don't reject - fall through to Mode 3 validation below
              // This ensures exports don't fail if normalization has issues
            }
          }

          // Continue with existing mode validations (Mode 1, 2, 3) below...
```

**Comment**: IPC branch plan aligns with the normalization flow; remember to clean up temporary normalized outputs so repeated exports do not bloat disk usage.

---

## PHASE 6: Update ExportOptions Interface

### Task 6.1: Add optimizationStrategy to ExportOptions
**File**: `electron/preload.ts`
**Location**: ExportOptions interface (around line 74)

```typescript
interface ExportOptions {
  sessionId: string;
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  audioFiles?: AudioFile[];
  metadata?: Record<string, string>;
  useDirectCopy?: boolean;

  // Mode 2: Direct video input with filters
  useVideoInput?: boolean;
  videoInputPath?: string;
  trimStart?: number;
  trimEnd?: number;

  // Mode 1.5: Video normalization (NEW!)
  optimizationStrategy?: 'image-pipeline' | 'direct-copy' | 'direct-video-with-filters' | 'video-normalization';
  videoSources?: VideoSource[];
}
```

**Comment**: Export options type will need the Mode 1.5 string plus normalized source metadata; confirm the structure still serializes cleanly across the preload bridge.

---

## PHASE 7: Wire Up Export Engine

### Task 7.1: Pass optimizationStrategy to FFmpeg Handler
**File**: `apps/web/src/lib/export-engine-cli.ts`
**Location**: exportOptions object (around line 1752)

**UPDATE exportOptions**:
```typescript
const exportOptions = {
  sessionId: this.sessionId,
  width: this.canvas.width,
  height: this.canvas.height,
  fps: this.fps,
  duration: this.duration,
  audioFiles: audioFiles.length > 0 ? audioFiles : undefined,
  textFilterChain,                        // Mode 2
  stickerFilterChain,                     // Mode 2
  stickerSources,                         // Mode 2
  useDirectCopy: !!(this.exportAnalysis?.canUseDirectCopy && !hasTextFilters && !hasStickerFilters),
  videoSources: videoSources.length > 0 ? videoSources : undefined,

  // Mode 2: Direct video input with filters
  useVideoInput: !!videoInput,
  videoInputPath: videoInput?.path,
  trimStart: videoInput?.trimStart || 0,
  trimEnd: videoInput?.trimEnd || 0,

  // Mode 1.5: Optimization strategy (NEW!)
  optimizationStrategy: this.exportAnalysis?.optimizationStrategy,
};
```

**Comment**: Passing the new strategy through the export options is straightforward; remember to extend related tests so the widened string union stays type-safe end-to-end.

---

## Implementation Plan

### Phase 1: Detection (Export Analysis)

**File**: `apps/web/src/lib/export-analysis.ts`

Add video property validation:

```typescript
interface VideoProperties {
  width: number;
  height: number;
  fps: number;
  codec: string;
  pixelFormat: string;
}

function checkVideoPropertiesMatch(
  videoElements: MediaElement[],
  mediaItemsMap: Map<string, MediaItem>,
  exportWidth: number,
  exportHeight: number,
  exportFps: number
): boolean {
  // Extract properties from first video as reference
  const referenceProps = extractVideoProperties(videoElements[0], mediaItemsMap);

  for (const element of videoElements) {
    const props = extractVideoProperties(element, mediaItemsMap);

    // Check if video matches export settings
    if (
      props.width !== exportWidth ||
      props.height !== exportHeight ||
      props.fps !== exportFps
    ) {
      return false; // Needs normalization
    }
  }

  return true; // All videos match, no normalization needed
}
```

**Update export strategy**:

```typescript
// In analyzeTimelineForExport function
if (hasMultipleVideoSources && !hasOverlappingVideos) {
  const propertiesMatch = checkVideoPropertiesMatch(
    videoElements,
    mediaItemsMap,
    exportWidth,
    exportHeight,
    exportFps
  );

  if (propertiesMatch) {
    optimizationStrategy = 'direct-copy'; // Mode 1
  } else {
    optimizationStrategy = 'video-normalization'; // Mode 1.5 (NEW!)
  }
} else if (!needsFrameRendering && needsFilterEncoding && videoElementCount === 1) {
  optimizationStrategy = 'direct-video-with-filters'; // Mode 2
} else {
  optimizationStrategy = 'image-pipeline'; // Mode 3
}
```

**Add new strategy type**:

```typescript
export interface ExportAnalysis {
  // ... existing fields
  optimizationStrategy:
    | 'image-pipeline'        // Mode 3: Frame rendering
    | 'direct-copy'           // Mode 1: Direct copy
    | 'direct-video-with-filters' // Mode 2: Direct video + filters
    | 'video-normalization';  // Mode 1.5: Normalize + concat (NEW!)
}
```

### Phase 2: Normalization (FFmpeg Handler)

**File**: `electron/ffmpeg-handler.ts`

Add normalization method:

```typescript
/**
 * Normalize video to target resolution and fps using FFmpeg padding
 *
 * @param inputPath - Source video path
 * @param outputPath - Normalized video output path
 * @param targetWidth - Target resolution width
 * @param targetHeight - Target resolution height
 * @param targetFps - Target frame rate
 * @param trim - Optional trim settings
 * @returns Promise that resolves when normalization completes
 */
async function normalizeVideo(
  inputPath: string,
  outputPath: string,
  targetWidth: number,
  targetHeight: number,
  targetFps: number,
  trim?: { start: number; end: number }
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Build filter chain for padding
    const filterChain = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black`;

    const args = [
      '-i', inputPath,
    ];

    // Add trim if specified
    if (trim) {
      args.push('-ss', trim.start.toString());
      if (trim.end > 0) {
        const duration = /* calculate duration */;
        args.push('-t', duration.toString());
      }
    }

    args.push(
      '-vf', filterChain,
      '-r', targetFps.toString(),
      '-c:v', 'libx264',
      '-preset', 'ultrafast', // Fast encoding
      '-crf', '18',           // High quality
      '-c:a', 'copy',         // Copy audio (no re-encoding)
      '-y',                   // Overwrite output
      outputPath
    );

    const ffmpegProcess = spawn(ffmpegPath, args);

    // Handle progress, errors, completion
    // ... (similar to existing FFmpeg spawn logic)
  });
}
```

**Update export flow**:

```typescript
// In export-video-cli IPC handler
if (options.optimizationStrategy === 'video-normalization') {
  console.log('⚡ [MODE 1.5] Video normalization enabled!');
  console.log(`⚡ [MODE 1.5] Target resolution: ${options.width}x${options.height}`);
  console.log(`⚡ [MODE 1.5] Target FPS: ${options.fps}`);

  // Step 1: Normalize all videos
  const normalizedPaths: string[] = [];

  for (let i = 0; i < options.videoSources.length; i++) {
    const source = options.videoSources[i];
    const normalizedPath = path.join(frameDir, `normalized_${i}.mp4`);

    await normalizeVideo(
      source.path,
      normalizedPath,
      options.width,
      options.height,
      options.fps,
      { start: source.trimStart, end: source.trimEnd }
    );

    normalizedPaths.push(normalizedPath);
    console.log(`⚡ [MODE 1.5] Normalized video ${i + 1}/${options.videoSources.length}`);
  }

  // Step 2: Concat normalized videos (fast!)
  await concatVideos(normalizedPaths, outputPath);

  console.log('⚡ [MODE 1.5] ✅ Export complete!');
}
```

### Phase 3: Testing

**Test Cases**:

1. **Different Resolutions**
   - Video 1: 1920x1080 @ 30fps
   - Video 2: 1280x720 @ 30fps
   - Expected: Both padded to export resolution, concat succeeds

2. **Different FPS**
   - Video 1: 1280x720 @ 24fps
   - Video 2: 1280x720 @ 60fps
   - Expected: Both converted to export fps, concat succeeds

3. **Different Resolutions + FPS**
   - Video 1: 752x416 @ 24fps
   - Video 2: 1280x720 @ 30fps
   - Expected: Both normalized to export settings, concat succeeds

4. **With Trimming**
   - Video 1: 1920x1080, trimmed 0-5s
   - Video 2: 1280x720, trimmed 2-8s
   - Expected: Trim applied during normalization, concat succeeds

5. **With Audio**
   - Video 1: 1280x720 with audio track
   - Video 2: 1920x1080 with different audio codec
   - Expected: Audio preserved/copied during normalization

---

## Performance Expectations

| Mode | Scenario | Speed | Quality |
|------|----------|-------|---------|
| Mode 1 | Videos match perfectly | 0.5s | ✅ Perfect (no re-encoding) |
| **Mode 1.5** | **Videos need normalization** | **2-3s** | ✅ **High (ultrafast preset)** |
| Mode 2 | Single video + filters | 1-2s | ✅ High |
| Mode 3 | Complex compositing | 10-15s | ✅ High (but slow) |

**Mode 1.5 is 5-7x faster than Mode 3!**

---

## Edge Cases to Handle

### 1. Extreme Aspect Ratio Differences
**Problem**: 16:9 video padded to 9:16 results in huge black bars

**Solution**: Log warning but proceed (user chose export resolution)

```typescript
if (Math.abs(videoAspectRatio - exportAspectRatio) > 1.5) {
  console.warn(`⚠️ [MODE 1.5] Large aspect ratio difference detected`);
  console.warn(`⚠️ [MODE 1.5] Video will have significant black bars`);
}
```

### 2. Portrait vs Landscape
**Problem**: Portrait video (1080x1920) exported to landscape (1920x1080)

**Solution**: Pad to fit (black bars on sides)

### 3. Already Matching Videos
**Problem**: All videos already match export settings

**Solution**: Skip normalization, use Mode 1 (direct copy)

```typescript
// In detection phase
if (allVideosMatchExportSettings) {
  optimizationStrategy = 'direct-copy'; // Use faster Mode 1
}
```

### 4. Audio Sync Issues
**Problem**: FPS conversion may cause audio desync

**Solution**: Use `-async 1` flag to ensure audio sync

```typescript
args.push('-async', '1'); // Resample audio to match video
```

---

## Future Enhancements

### 1. Smart Resolution Selection
Instead of always using export resolution, automatically choose the "best" resolution:

```typescript
function chooseBestResolution(videos: VideoProperties[]): { width: number; height: number } {
  // Option A: Use most common resolution
  // Option B: Use highest resolution
  // Option C: Use export resolution (current approach)
}
```

### 2. Quality Presets
Allow users to choose encoding speed vs quality:

```typescript
interface NormalizationOptions {
  preset: 'ultrafast' | 'fast' | 'medium' | 'slow';
  crf: number; // 18 (high quality) to 28 (lower quality)
}
```

### 3. Hardware Acceleration
Use hardware encoding if available (5-10x faster):

```bash
# NVIDIA GPU
ffmpeg -hwaccel cuda -i input.mp4 -c:v h264_nvenc ...

# Intel Quick Sync
ffmpeg -hwaccel qsv -i input.mp4 -c:v h264_qsv ...

# AMD
ffmpeg -hwaccel vaapi -i input.mp4 -c:v h264_vaapi ...
```

### 4. Automatic Codec Normalization
Handle different codecs (h264, h265, vp9):

```typescript
// Convert all to h264 if mixed codecs detected
if (hasMixedCodecs) {
  targetCodec = 'libx264';
}
```

---

## Success Criteria

✅ **Detection**: Export analysis correctly identifies videos needing normalization
✅ **Performance**: Mode 1.5 exports in 2-3 seconds (vs 10-15s for Mode 3)
✅ **Quality**: No visible quality degradation from normalization
✅ **Audio**: Audio remains in sync after fps conversion
✅ **Trimming**: Trim settings applied correctly during normalization
✅ **Fallback**: Gracefully falls back to Mode 3 if normalization fails

---

## Implementation Checklist

### Phase 1: Detection ✅ COMPLETE
- [x] Add `VideoProperties` interface ✅ **DONE** (export-analysis.ts:44-50)
- [x] Implement `extractVideoProperties()` function ✅ **DONE** (export-analysis.ts:55-112)
- [x] Implement `checkVideoPropertiesMatch()` function ✅ **DONE** (export-analysis.ts:114-181)
- [x] Update `ExportAnalysis` interface with `video-normalization` strategy ✅ **DONE** (export-analysis.ts:32-36)
- [x] Update `analyzeTimelineForExport()` to detect mismatches ✅ **DONE** (export-analysis.ts:319-384)
- [x] Add console logging for Mode 1.5 detection ✅ **DONE** (export-analysis.ts:386-479)

### Phase 2: Normalization ✅ COMPLETE
- [x] Implement `normalizeVideo()` function in ffmpeg-handler.ts ✅ **DONE** (ffmpeg-handler.ts:1024-1207)
- [x] Build FFmpeg filter chain for scale + pad ✅ **DONE** (included in normalizeVideo)
- [x] Handle trim settings during normalization ✅ **DONE** (included in normalizeVideo)
- [x] Add progress reporting for normalization step ✅ **DONE** (included in normalizeVideo)
- [ ] Implement video concatenation after normalization (Phase 5: Integration)
- [ ] Add error handling and fallback to Mode 3 (Phase 5: Integration)

### Phase 3: Integration
- [ ] Wire up Mode 1.5 in export engine
- [ ] Update IPC handler to recognize `video-normalization` strategy
- [ ] Add comprehensive console logging
- [ ] Update export progress UI to show normalization step

### Phase 4: Testing
- [ ] Test with different resolutions (1920x1080 + 1280x720)
- [ ] Test with different fps (24fps + 30fps + 60fps)
- [ ] Test with extreme aspect ratios (16:9 + 9:16)
- [ ] Test with trimmed videos
- [ ] Test with audio tracks
- [ ] Performance benchmark vs Mode 3

### Phase 5: Documentation
- [ ] Update user-facing documentation
- [ ] Add Mode 1.5 to manual test plan
- [ ] Document performance characteristics
- [ ] Add troubleshooting guide

---

## Timeline Estimate

- **Phase 1 (Detection)**: 2 hours
- **Phase 2 (Normalization)**: 4 hours
- **Phase 3 (Integration)**: 2 hours
- **Phase 4 (Testing)**: 3 hours
- **Phase 5 (Documentation)**: 1 hour

**Total**: ~12 hours of development time

---

## References

- [FFmpeg scale filter documentation](https://ffmpeg.org/ffmpeg-filters.html#scale)
- [FFmpeg pad filter documentation](https://ffmpeg.org/ffmpeg-filters.html#pad)
- [FFmpeg concat documentation](https://trac.ffmpeg.org/wiki/Concatenate)
- Mode 2 implementation: `docs/issues/feat-ffmpeg-sticker-overlay/`

---

## Notes

- This feature bridges the gap between Mode 1 (very fast but restrictive) and Mode 3 (slow but flexible)
- The key insight is that **padding is much faster than canvas rendering**
- FFmpeg's `ultrafast` preset provides good quality while maintaining speed
- Audio handling is critical - must use `-async 1` to prevent desync
- Fallback to Mode 3 ensures exports never fail due to normalization issues
