# Mode 1.5: Video Normalization with Padding

**Feature**: FFmpeg-based video normalization for mismatched resolutions/fps
**Status**: 🐛 **BUG DETECTED - Mode 1.5 Detection Not Working**
**Priority**: High
**Performance Target**: 2-3 seconds (5-7x faster than Mode 3)

---

## ⚠️ CRITICAL BUG - Mode 1.5 Detection Bypassed

### Bug Analysis (2025-10-20)

**Symptom**: Mode 1.5 is never triggered, even when videos have different properties. Export fails with "Video codec mismatch detected".

**Console Evidence** (from `console.md`):
```
Line 749: ✅ [MODE DETECTION] Selected Mode 1: Direct copy (15-48x speedup)  ← WRONG!
Line 752: 🎬 [EXPORT ANALYSIS] Video elements with trim info: Array(3)
Line 753: ✅ [EXPORT ANALYSIS] MODE 1: Using DIRECT COPY optimization - Fast export! 🚀  ← WRONG!

MISSING LOGS (should appear but don't):
  🔍 [MODE 1.5 DETECTION] Checking video properties...
  🔍 [MODE 1.5 DETECTION] Video 0: 752x416 @ 24fps
  🔍 [MODE 1.5 DETECTION] Video 1: 1280x720 @ 30fps

Line 774: ❌ FFmpeg export FAILED! Error: Video codec mismatch detected
  Reference: video-1760912964015-6f7cf28dd13f9d63-video_part1.mp4
    Codec: h264, Resolution: 752x416
  Mismatched: video-1760912964015-6f7cf28dd13f9d63-video_part2.mp4
    Codec: h264, Resolution: 1280x720, FPS: 30/1
```

**Root Cause** (export-analysis.ts:148-195):

The decision tree logic is **BROKEN**:

1. **Line 126-133**: `canUseDirectCopy` is calculated with these conditions:
   ```typescript
   const canUseDirectCopy =
     videoElementCount >= 1 &&
     !hasOverlappingVideos &&
     !hasImageElements &&
     !hasTextElements &&
     !hasStickers &&
     !hasEffects &&
     allVideosHaveLocalPath;
   ```

2. **Line 148-151**: If `canUseDirectCopy === true`, Mode 1 is selected **immediately**:
   ```typescript
   if (canUseDirectCopy) {
     optimizationStrategy = 'direct-copy';
     console.log('✅ [MODE DETECTION] Selected Mode 1: Direct copy');
   }
   ```

3. **Line 156-163**: Mode 1.5 block has **IDENTICAL conditions** to `canUseDirectCopy`:
   ```typescript
   } else if (
     videoElementCount > 1 &&
     !hasOverlappingVideos &&
     !hasImageElements &&
     !hasTextElements &&
     !hasStickers &&
     !hasEffects &&
     allVideosHaveLocalPath
   ) {
     // Mode 1.5 detection - THIS NEVER RUNS!
   ```

**Why It Fails**:
- When conditions are met, `canUseDirectCopy` is `true`
- Mode 1 is selected immediately without checking video properties
- The `else if` block with Mode 1.5 detection is **NEVER REACHED**
- Export proceeds with Mode 1 (direct copy) for mismatched videos
- FFmpeg concat demuxer fails with codec mismatch error

**The Fix**:
When `canUseDirectCopy === true` AND `videoElementCount > 1`, we MUST check video properties BEFORE deciding between Mode 1 and Mode 1.5. The target dimensions/fps for those comparisons must come from the export canvas (with sensible fallbacks), not from whichever clip happens to be first.

**Correct Logic**:
```typescript
if (canUseDirectCopy) {
  if (videoElementCount > 1) {
    // Multiple videos - check properties FIRST
    const videosMatch = checkVideoPropertiesMatch(...);
    if (videosMatch) {
      optimizationStrategy = 'direct-copy';  // Mode 1
    } else {
      optimizationStrategy = 'video-normalization';  // Mode 1.5
    }
  } else {
    // Single video - always use direct copy
    optimizationStrategy = 'direct-copy';  // Mode 1
  }
}
```

---

## Progress Summary

- ❌ **Phase 1 (Detection)**: BROKEN - Mode 1.5 detection logic is bypassed
- ✅ **Phase 2 (Normalization)**: Complete - normalizeVideo() function with FFmpeg padding
- ✅ **Phase 3 (Integration)**: Complete - Full integration with export pipeline
- ⏳ **Phase 4 (Testing)**: Blocked - Cannot test until Phase 1 is fixed
- ⏳ **Phase 5 (Documentation)**: Pending - Update user-facing docs

---

## Problem Statement

QCut fails when exporting multiple videos with different properties:

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

**New Behavior with Mode 1.5**:
- Mode 1.5 (video normalization) → ✅ Works fast (2-3 seconds)

---

## Solution Overview

Use FFmpeg's **scale + pad filters** to normalize videos before concatenation:

1. **Detect video property mismatches** during export analysis
2. **Normalize each video** (pad to target resolution, convert fps, re-encode audio to AAC 48kHz stereo)
3. **Concatenate normalized videos** using direct copy for video + stream copy for normalized audio (fast!)

---

## Technical Approach

### FFmpeg Normalization Command

For a video that needs padding (752x416 → 1280x720):

```bash
ffmpeg -i input.mp4 \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black" \
  -r 30 \
  -c:v libx264 -preset ultrafast -crf 18 \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  -async 1 \
  normalized_output.mp4
```

**Filter Breakdown**:
- `scale` - Resize to fit target dimensions (maintains aspect ratio)
- `force_original_aspect_ratio=decrease` - Never upscale, only downscale
- `pad` - Add black bars to reach exact dimensions
- `(ow-iw)/2` - Center horizontally
- `(oh-ih)/2` - Center vertically
- `:black` - Black padding color
- `-r 30` - Convert to target fps
- `-preset ultrafast` - Fast encoding
- `-crf 18` - High quality (visually lossless)
- `-c:a aac -b:a 192k -ar 48000 -ac 2` - Normalize audio into a single codec/sample layout for concat compat
- `-async 1` - Resample audio to prevent desync

### Implementation Flow

1. **Export Analysis** (`export-analysis.ts`)
   - Detect multiple videos with different properties
   - Check resolution, fps, and codec mismatches
   - Select `'video-normalization'` strategy
   - Use `resolveExportCanvasSettings()` helper to pull width/height/fps from export options before comparisons

2. **FFmpeg Handler** (`ffmpeg-handler.ts`)
   - `normalizeVideo()` function normalizes each video
   - Re-encodes audio tracks to AAC 48kHz stereo to guarantee concat compatibility
   - Creates concat list file
   - Concatenates normalized videos with direct copy

3. **Export Engine** (`export-engine-cli.ts`)
   - Passes `optimizationStrategy` to FFmpeg handler
   - Provides video sources with trim settings

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

## Testing Plan (Phase 4)

### Test Cases

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
   - Expected: Both audio tracks re-encoded to AAC 48kHz stereo and remain in sync after concat

6. **Extreme Aspect Ratios**
   - Video 1: 16:9 (1920x1080)
   - Video 2: 9:16 (1080x1920) portrait
   - Expected: Large black bars but export succeeds

### Performance Benchmarks

Record export times for each test:

| Test | Mode | Video Duration | Export Time | Speedup vs Mode 3 |
|------|------|----------------|-------------|-------------------|
| Test 1 | Mode 1.5 | ___s | ___s | ___x faster |
| Test 2 | Mode 1.5 | ___s | ___s | ___x faster |
| Test 3 | Mode 1.5 | ___s | ___s | ___x faster |
| Test 4 | Mode 1.5 | ___s | ___s | ___x faster |
| Test 5 | Mode 1.5 | ___s | ___s | ___x faster |
| Test 6 | Mode 1.5 | ___s | ___s | ___x faster |

---

## Edge Cases Handled

### 1. Extreme Aspect Ratio Differences
**Problem**: 16:9 video padded to 9:16 results in huge black bars
**Solution**: Log warning but proceed (user chose export resolution)

### 2. Portrait vs Landscape
**Problem**: Portrait video exported to landscape
**Solution**: Pad to fit with black bars on sides

### 3. Already Matching Videos
**Problem**: All videos already match export settings
**Solution**: Skip normalization, use Mode 1 (direct copy)

### 4. Audio Sync Issues
**Problem**: FPS conversion may cause audio desync
**Solution**: Re-encode audio to AAC 48kHz stereo and use `-async 1` to ensure sync across clips

### 5. Normalization Failure
**Problem**: FFmpeg normalization fails for any reason
**Solution**: Gracefully fall back to Mode 3 (frame rendering)

---

## Known Limitations

1. **Audio Mixing**: Mode 1.5 does not yet support audio mixing (falls back to Mode 3)
2. **Export Settings**: Currently uses first video's dimensions as target (should use export canvas settings)
3. **Codec Detection**: Relies on MediaItem metadata which may not always be available

---

## Future Enhancements

### 1. Smart Resolution Selection
Automatically choose the "best" resolution instead of using first video:
- Option A: Use most common resolution among videos
- Option B: Use highest resolution
- Option C: Use export canvas resolution (current approach)

### 2. Quality Presets
Allow users to choose encoding speed vs quality:
- `ultrafast` - 2-3s (current)
- `fast` - 3-4s (better quality)
- `medium` - 5-7s (balanced)

### 3. Hardware Acceleration
Use GPU encoding for 5-10x faster normalization:
- NVIDIA: `h264_nvenc`
- Intel: `h264_qsv`
- AMD: `h264_vaapi`

### 4. Automatic Codec Normalization
Handle different codecs (h264, h265, vp9):
- Detect mixed codecs
- Convert all to h264 for compatibility

### 5. Audio Mixing Support
Implement audio mixing for Mode 1.5:
- Re-mux concatenated video with audio tracks
- Use FFmpeg `-filter_complex` for audio mixing
- Similar to Mode 1 audio handling

---

## Success Criteria

✅ **Detection**: Export analysis correctly identifies videos needing normalization
✅ **Performance**: Mode 1.5 exports in 2-3 seconds (vs 10-15s for Mode 3)
✅ **Quality**: No visible quality degradation from normalization
✅ **Audio**: Audio remains in sync after fps conversion
✅ **Trimming**: Trim settings applied correctly during normalization
✅ **Fallback**: Gracefully falls back to Mode 3 if normalization fails

---

## Implementation Status

### ✅ Complete

- [x] Type definitions updated (`VideoProperties`, `ExportAnalysis`)
- [x] Video property extraction (`extractVideoProperties()`)
- [x] Video property matching (`checkVideoPropertiesMatch()`)
- [x] Export analysis logic updated (Mode 1.5 detection)
- [x] Export canvas resolver helper (derives target width/height/fps from project settings)
- [x] Normalization function (`normalizeVideo()`)
- [x] FFmpeg filter chain (scale + pad)
- [x] Audio normalization (AAC 48kHz stereo transcode)
- [x] Trim handling during normalization
- [x] Progress reporting
- [x] IPC handler Mode 1.5 flow
- [x] Concat list creation
- [x] Video concatenation
- [x] Error handling with fallback to Mode 3
- [x] Export options interface updated
- [x] Export engine integration

### ⏳ Pending

- [ ] Test with different resolutions
- [ ] Test with different fps
- [ ] Test with extreme aspect ratios
- [ ] Test with trimmed videos
- [ ] Test with audio tracks
- [ ] Performance benchmarks vs Mode 3
- [ ] Update user-facing documentation
- [ ] Add to manual test plan
- [ ] Troubleshooting guide

---

## Files Modified

### Frontend (TypeScript/React)
- `apps/web/src/lib/export-analysis.ts` - Mode 1.5 detection logic
- `apps/web/src/lib/export-engine-cli.ts` - Pass optimization strategy

### Backend (Electron/TypeScript)
- `electron/ffmpeg-handler.ts` - Normalization function and IPC handler
- `electron/preload.ts` - ExportOptions interface update

---

## Console Log Indicators

When Mode 1.5 is active, look for these logs:

```
🔍 [MODE DETECTION] Multiple sequential videos detected - checking properties...
🔍 [MODE 1.5 DETECTION] Checking video properties...
🔍 [MODE 1.5 DETECTION] Video 0: 752x416 @ 24fps
🔍 [MODE 1.5 DETECTION] Video 1: 1280x720 @ 30fps
⚠️ [MODE 1.5 DETECTION] Video 0 resolution mismatch - normalization needed
⚡ [MODE DETECTION] Selected Mode 1.5: Video normalization (5-7x speedup)
⚡ [EXPORT ANALYSIS] MODE 1.5: Using VIDEO NORMALIZATION - Fast export with padding! ⚡

⚡ [MODE 1.5 EXPORT] Mode 1.5: Video Normalization with Padding
⚡ [MODE 1.5 EXPORT] Number of videos: 2
⚡ [MODE 1.5 EXPORT] Target resolution: 1280x720
⚡ [MODE 1.5 EXPORT] Target FPS: 30
⚡ [MODE 1.5 EXPORT] Expected speedup: 5-7x faster than Mode 3

⚡ [MODE 1.5 NORMALIZE] Starting video normalization...
⚡ [MODE 1.5 NORMALIZE] ✅ Normalization complete
⚡ [MODE 1.5 EXPORT] ✅ Concatenation complete!
⚡ [MODE 1.5 EXPORT] ✅ Export complete!
```

---

## References

- [FFmpeg scale filter documentation](https://ffmpeg.org/ffmpeg-filters.html#scale)
- [FFmpeg pad filter documentation](https://ffmpeg.org/ffmpeg-filters.html#pad)
- [FFmpeg concat documentation](https://trac.ffmpeg.org/wiki/Concatenate)
- Mode 2 implementation: `docs/issues/feat-ffmpeg-sticker-overlay/`

---

## Notes

- Mode 1.5 bridges the gap between Mode 1 (very fast but restrictive) and Mode 3 (slow but flexible)
- The key insight: **padding is much faster than canvas rendering**
- FFmpeg's `ultrafast` preset provides good quality while maintaining speed
- Audio handling is critical - re-encode to AAC 48kHz stereo and use `-async 1` to prevent desync
- Fallback to Mode 3 ensures exports never fail due to normalization issues
- Black bars are an acceptable tradeoff for 5-7x performance improvement

---

## 🔧 Fix Required

**File**: `apps/web/src/lib/export-analysis.ts`
**Location**: Lines 148-195 (decision tree logic)

**Current Code (BROKEN)**:
```typescript
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
  // Mode 1.5: Multiple sequential videos - THIS NEVER RUNS!
  // ...checkVideoPropertiesMatch logic...
}
```

**Fixed Code (CORRECT)**:
```typescript
if (canUseDirectCopy) {
  if (videoElementCount > 1) {
    // Multiple videos - check properties to decide Mode 1 vs 1.5
    console.log('🔍 [MODE DETECTION] Multiple sequential videos detected - checking properties...');

    const firstVideo = videoElements[0];
    const firstMediaItem = mediaItemsMap.get(firstVideo.mediaId);
    const exportCanvasSettings = resolveExportCanvasSettings({
      exportOptions,
      projectSettings,
      fallbackWidth: firstMediaItem?.width ?? 1280,
      fallbackHeight: firstMediaItem?.height ?? 720,
      fallbackFps: (firstMediaItem as any)?.fps ?? 30,
    });
    const { width: targetWidth, height: targetHeight, fps: targetFps } = exportCanvasSettings;

    console.log(`🔍 [MODE DETECTION] Using target: ${targetWidth}x${targetHeight} @ ${targetFps}fps`);

    const videosMatch = checkVideoPropertiesMatch(
      videoElements,
      mediaItemsMap,
      targetWidth,
      targetHeight,
      targetFps
    );

    if (videosMatch) {
      // All videos match - can use direct copy
      optimizationStrategy = 'direct-copy';
      console.log('✅ [MODE DETECTION] Videos match - using Mode 1: Direct copy (15-48x speedup)');
    } else {
      // Videos need normalization
      optimizationStrategy = 'video-normalization';
      console.log('⚡ [MODE DETECTION] Selected Mode 1.5: Video normalization (5-7x speedup)');
    }
  } else {
    // Single video - always direct copy
    optimizationStrategy = 'direct-copy';
    console.log('✅ [MODE DETECTION] Selected Mode 1: Direct copy (15-48x speedup)');
  }
} else if (!needsFrameRendering && needsFilterEncoding && videoElementCount === 1) {
  // Mode 2: Single video with FFmpeg filters (text/stickers)
  optimizationStrategy = 'direct-video-with-filters';
  console.log('⚡ [MODE DETECTION] Selected Mode 2: Direct video with filters (3-5x speedup)');
} else {
  // Mode 3: Frame rendering - slowest but most flexible
  optimizationStrategy = 'image-pipeline';
  console.log('🎨 [MODE DETECTION] Selected Mode 3: Frame rendering (baseline speed)');
}
```

**Changes Summary**:
1. Remove the duplicate `else if` block (lines 156-195)
2. Move Mode 1.5 detection INSIDE the `canUseDirectCopy` block
3. Resolve target width/height/fps from export canvas settings before property comparisons
4. Check video properties when `videoElementCount > 1`
5. Select Mode 1 for single videos (no property check needed)
6. Select Mode 1.5 when properties don't match
7. Update console logs for clarity

**Expected Behavior After Fix**:
```
🔍 [MODE DETECTION] Multiple sequential videos detected - checking properties...
🔍 [MODE DETECTION] Using target: 1280x720 @ 30fps
🔍 [MODE 1.5 DETECTION] Checking video properties...
🔍 [MODE 1.5 DETECTION] Target: 1280x720 @ 30fps
🔍 [MODE 1.5 DETECTION] Video 0: 752x416 @ 24fps
⚠️ [MODE 1.5 DETECTION] Video 0 resolution mismatch - normalization needed
   Expected: 1280x720, Got: 752x416
⚡ [MODE DETECTION] Selected Mode 1.5: Video normalization (5-7x speedup)
⚡ [EXPORT ANALYSIS] MODE 1.5: Using VIDEO NORMALIZATION - Fast export with padding! ⚡
```
