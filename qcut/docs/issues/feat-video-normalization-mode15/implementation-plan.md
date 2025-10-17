# Mode 1.5: Video Normalization with Padding

**Feature**: FFmpeg-based video normalization for mismatched resolutions/fps
**Status**: Planning
**Priority**: High
**Performance Target**: 2-3 seconds (5-7x faster than Mode 3)

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
**Location**: Before analyzeTimelineForExport function (around line 300)

```typescript
/**
 * Check if all videos match the target export properties
 * Used to determine if normalization is needed
 *
 * @param videoElements - Array of video elements from timeline
 * @param mediaItemsMap - Map of media items
 * @param targetWidth - Export target width
 * @param targetHeight - Export target height
 * @param targetFps - Export target fps
 * @returns true if all videos match, false if normalization needed
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

  for (let i = 0; i < videoElements.length; i++) {
    const props = extractVideoProperties(videoElements[i], mediaItemsMap);

    if (!props) {
      console.log(`⚠️ [MODE 1.5 DETECTION] Video ${i}: No properties found`);
      return false; // Can't determine, needs normalization
    }

    console.log(`🔍 [MODE 1.5 DETECTION] Video ${i}: ${props.width}x${props.height} @ ${props.fps}fps`);

    // Check if video properties match export target
    if (
      props.width !== targetWidth ||
      props.height !== targetHeight ||
      props.fps !== targetFps
    ) {
      console.log(`⚠️ [MODE 1.5 DETECTION] Video ${i} properties mismatch - normalization needed`);
      return false;
    }
  }

  console.log('✅ [MODE 1.5 DETECTION] All videos match export settings');
  return true;
}
```

**Comment**: Plan looks good—consider tolerances for fps rounding and guard against missing metadata causing false negatives.

---

## PHASE 3: Update Export Analysis Logic

### Task 3.1: Modify analyzeTimelineForExport Function
**File**: `apps/web/src/lib/export-analysis.ts`
**Location**: Lines 157-165 (optimization strategy determination)

**CURRENT CODE**:
```typescript
// Determine optimization strategy
let optimizationStrategy: 'image-pipeline' | 'direct-copy' | 'direct-video-with-filters';
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
let optimizationStrategy: 'image-pipeline' | 'direct-copy' | 'direct-video-with-filters' | 'video-normalization';

// Mode decision tree:
// 1. Can we use direct copy? (Mode 1)
// 2. Single video with filters? (Mode 2)
// 3. Multiple videos that need normalization? (Mode 1.5 - NEW!)
// 4. Default to frame rendering (Mode 3)

if (canUseDirectCopy) {
  // Mode 1: Direct copy - fastest path
  optimizationStrategy = 'direct-copy';
} else if (!needsFrameRendering && needsFilterEncoding && videoElementCount === 1) {
  // Mode 2: Single video with filters
  optimizationStrategy = 'direct-video-with-filters';
} else if (
  videoElementCount > 1 &&
  !hasOverlappingVideos &&
  !hasImageElements &&
  !hasTextElements &&
  !hasStickers &&
  !hasEffects &&
  allVideosHaveLocalPath
) {
  // Mode 1.5: Multiple videos that MIGHT need normalization
  // Check if videos match export properties

  // Note: We need export dimensions and fps here
  // For now, we'll assume standard export settings
  // TODO: Pass export settings to this function
  const targetWidth = 1280;  // Should come from export settings
  const targetHeight = 720;  // Should come from export settings
  const targetFps = 30;      // Should come from export settings

  const videosMatch = checkVideoPropertiesMatch(
    videoElements,
    mediaItemsMap,
    targetWidth,
    targetHeight,
    targetFps
  );

  if (videosMatch) {
    // All videos match export settings - use direct copy
    optimizationStrategy = 'direct-copy';
  } else {
    // Videos need normalization - use Mode 1.5
    optimizationStrategy = 'video-normalization';
  }
} else {
  // Mode 3: Frame rendering - slowest but most flexible
  optimizationStrategy = 'image-pipeline';
}
```

**Comment**: Agree with the decision tree but we should source export width, height, and fps from the actual export settings rather than hard coding defaults.

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
**Location**: Before buildFFmpegArgs function (around line 100)

```typescript
/**
 * Normalize a single video to target resolution and fps using FFmpeg
 * Uses scale + pad filters to add black bars while maintaining aspect ratio
 *
 * @param inputPath - Source video file path
 * @param outputPath - Normalized video output path
 * @param targetWidth - Target width (export resolution)
 * @param targetHeight - Target height (export resolution)
 * @param targetFps - Target frame rate (export fps)
 * @param trimStart - Trim start time in seconds (0 = no trim)
 * @param trimEnd - Trim end time in seconds (0 = no trim)
 * @returns Promise that resolves when normalization completes
 */
function normalizeVideo(
  inputPath: string,
  outputPath: string,
  targetWidth: number,
  targetHeight: number,
  targetFps: number,
  trimStart: number = 0,
  trimEnd: number = 0
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('⚡ [MODE 1.5 NORMALIZE] Starting video normalization...');
    console.log(`⚡ [MODE 1.5 NORMALIZE] Input: ${inputPath}`);
    console.log(`⚡ [MODE 1.5 NORMALIZE] Output: ${outputPath}`);
    console.log(`⚡ [MODE 1.5 NORMALIZE] Target: ${targetWidth}x${targetHeight} @ ${targetFps}fps`);

    // Build FFmpeg filter chain
    // force_original_aspect_ratio=decrease ensures video fits within target dimensions
    // pad adds black bars to reach exact target dimensions, centered
    const filterChain = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:black`;

    const args: string[] = [];

    // Input file
    args.push('-i', inputPath);

    // Trim if specified
    if (trimStart > 0) {
      args.push('-ss', trimStart.toString());
    }

    if (trimEnd > 0) {
      // Calculate duration from trim settings
      // Note: This assumes we know the video duration
      // We may need to get duration from video metadata first
      const duration = trimEnd - trimStart;
      args.push('-t', duration.toString());
    }

    // Video filters (scale + pad)
    args.push('-vf', filterChain);

    // Frame rate conversion
    args.push('-r', targetFps.toString());

    // Video encoding settings
    args.push(
      '-c:v', 'libx264',      // H.264 codec
      '-preset', 'ultrafast', // Fast encoding (quality vs speed)
      '-crf', '18',           // High quality (18 = visually lossless)
      '-pix_fmt', 'yuv420p'   // Pixel format for compatibility
    );

    // Audio settings (copy without re-encoding)
    args.push('-c:a', 'copy');

    // Audio sync (important for fps conversion)
    args.push('-async', '1');

    // Overwrite output file
    args.push('-y');

    // Output file
    args.push(outputPath);

    console.log(`⚡ [MODE 1.5 NORMALIZE] FFmpeg command: ffmpeg ${args.join(' ')}`);

    // Spawn FFmpeg process
    const ffmpegProcess = spawn(getFfmpegPath(), args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderrOutput = '';

    // Capture stderr for progress/errors
    ffmpegProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrOutput += text;

      // Log progress (FFmpeg outputs progress to stderr)
      if (text.includes('frame=')) {
        process.stdout.write(`⚡ [MODE 1.5 NORMALIZE] ${text.trim()}\r`);
      }
    });

    // Handle completion
    ffmpegProcess.on('close', (code: number) => {
      if (code === 0) {
        console.log(`\n⚡ [MODE 1.5 NORMALIZE] ✅ Normalization complete: ${outputPath}`);
        resolve();
      } else {
        console.error(`\n❌ [MODE 1.5 NORMALIZE] Normalization failed with code ${code}`);
        console.error(`❌ [MODE 1.5 NORMALIZE] FFmpeg stderr:\n${stderrOutput}`);
        reject(new Error(`FFmpeg normalization failed with code ${code}`));
      }
    });

    // Handle errors
    ffmpegProcess.on('error', (error: Error) => {
      console.error(`❌ [MODE 1.5 NORMALIZE] FFmpeg process error:`, error);
      reject(error);
    });
  });
}
```

**Comment**: When wiring normalizeVideo ensure trim handling mirrors the CLI duration math and reuse shared FFmpeg utilities where possible to avoid drift.

---

## PHASE 5: FFmpeg Handler - Update Export Flow

### Task 5.1: Add Mode 1.5 Handling in IPC Handler
**File**: `electron/ffmpeg-handler.ts`
**Location**: In export-video-cli IPC handler, after validation (around line 520)

**ADD THIS BLOCK BEFORE EXISTING MODE CHECKS**:
```typescript
// MODE 1.5: Video Normalization
if (options.optimizationStrategy === 'video-normalization') {
  console.log('⚡ [MODE 1.5 EXPORT] ============================================');
  console.log('⚡ [MODE 1.5 EXPORT] Mode 1.5: Video Normalization enabled!');
  console.log(`⚡ [MODE 1.5 EXPORT] Number of videos: ${options.videoSources?.length || 0}`);
  console.log(`⚡ [MODE 1.5 EXPORT] Target resolution: ${options.width}x${options.height}`);
  console.log(`⚡ [MODE 1.5 EXPORT] Target FPS: ${options.fps}`);
  console.log('⚡ [MODE 1.5 EXPORT] Expected speedup: 5-7x faster than frame rendering');
  console.log('⚡ [MODE 1.5 EXPORT] ============================================');

  try {
    // Validate video sources exist
    if (!options.videoSources || options.videoSources.length === 0) {
      throw new Error('Mode 1.5 requires video sources');
    }

    // Step 1: Normalize all videos
    console.log(`⚡ [MODE 1.5 EXPORT] Step 1: Normalizing ${options.videoSources.length} videos...`);
    const normalizedPaths: string[] = [];

    for (let i = 0; i < options.videoSources.length; i++) {
      const source = options.videoSources[i];
      const normalizedPath = path.join(frameDir, `normalized_video_${i}.mp4`);

      console.log(`⚡ [MODE 1.5 EXPORT] Normalizing video ${i + 1}/${options.videoSources.length}...`);
      console.log(`⚡ [MODE 1.5 EXPORT]   Source: ${source.path}`);
      console.log(`⚡ [MODE 1.5 EXPORT]   Trim: ${source.trimStart}s - ${source.trimEnd}s`);

      await normalizeVideo(
        source.path,
        normalizedPath,
        options.width,
        options.height,
        options.fps,
        source.trimStart || 0,
        source.trimEnd || 0
      );

      normalizedPaths.push(normalizedPath);
      console.log(`⚡ [MODE 1.5 EXPORT] ✅ Video ${i + 1} normalized`);
    }

    // Step 2: Create concat list file
    console.log('⚡ [MODE 1.5 EXPORT] Step 2: Creating concat list...');
    const concatListPath = path.join(frameDir, 'concat_list.txt');
    const concatContent = normalizedPaths
      .map(p => `file '${p.replace(/\\/g, '/')}'`)
      .join('\n');

    fs.writeFileSync(concatListPath, concatContent, 'utf-8');
    console.log(`⚡ [MODE 1.5 EXPORT] Concat list created: ${concatListPath}`);

    // Step 3: Concat normalized videos using demuxer (fast!)
    console.log('⚡ [MODE 1.5 EXPORT] Step 3: Concatenating videos...');

    const concatArgs = [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',  // Direct copy - no re-encoding!
      '-y',
      options.outputPath
    ];

    // Execute concat
    await new Promise<void>((resolve, reject) => {
      const concatProcess = spawn(getFfmpegPath(), concatArgs);

      concatProcess.on('close', (code) => {
        if (code === 0) {
          console.log('⚡ [MODE 1.5 EXPORT] ✅ Concatenation complete');
          resolve();
        } else {
          reject(new Error(`Concat failed with code ${code}`));
        }
      });

      concatProcess.on('error', reject);
    });

    // Step 4: Mix audio if needed
    if (options.audioFiles && options.audioFiles.length > 0) {
      console.log('⚡ [MODE 1.5 EXPORT] Step 4: Mixing audio...');
      // Use existing audio mixing logic
      // ... (call existing audio mixing function)
    }

    console.log('⚡ [MODE 1.5 EXPORT] ============================================');
    console.log('⚡ [MODE 1.5 EXPORT] ✅ Export complete!');
    console.log(`⚡ [MODE 1.5 EXPORT] Output: ${options.outputPath}`);
    console.log('⚡ [MODE 1.5 EXPORT] ============================================');

    resolve({
      success: true,
      outputPath: options.outputPath
    });

    return; // Exit early - don't continue to other modes
  } catch (error) {
    console.error('❌ [MODE 1.5 EXPORT] Normalization failed, falling back to Mode 3');
    console.error('❌ [MODE 1.5 EXPORT] Error:', error);
    // Fall through to Mode 3 (frame rendering) as fallback
  }
}
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

### Phase 1: Detection
- [ ] Add `VideoProperties` interface
- [ ] Implement `extractVideoProperties()` function
- [ ] Implement `checkVideoPropertiesMatch()` function
- [ ] Update `ExportAnalysis` interface with `video-normalization` strategy
- [ ] Update `analyzeTimelineForExport()` to detect mismatches
- [ ] Add console logging for Mode 1.5 detection

### Phase 2: Normalization
- [ ] Implement `normalizeVideo()` function in ffmpeg-handler.ts
- [ ] Build FFmpeg filter chain for scale + pad
- [ ] Handle trim settings during normalization
- [ ] Add progress reporting for normalization step
- [ ] Implement video concatenation after normalization
- [ ] Add error handling and fallback to Mode 3

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
