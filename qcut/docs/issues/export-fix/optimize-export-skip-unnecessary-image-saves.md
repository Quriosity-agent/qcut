# Optimize Export: Skip Unnecessary Image Saves

## Issue Overview

Currently, the export engine saves all images to disk even when they are not needed for the video export process. This creates unnecessary file I/O operations and temporary files that consume disk space and slow down the export.

## Problem Statement

**Current Behavior:**
- Export engine saves every image frame to disk during processing
- Creates temporary image files that may not be used in the final video
- Increases export time due to unnecessary disk writes
- Consumes additional disk space with temporary files
- May cause issues on systems with limited disk space

**Impact:**
- Slower export times (unnecessary I/O overhead)
- Increased disk usage
- Potential memory/disk space issues on large projects
- Unnecessary file cleanup required

## Proposed Solution

Modify the export engine to intelligently determine when image saves are necessary:

### When to Save Images:
1. **Image-based scenes** - Only when the timeline contains actual image elements
2. **Frame extraction needed** - When video frames need to be processed as images
3. **Effects requiring image processing** - When effects need bitmap manipulation
4. **Sticker overlays** - When stickers need to be composited onto frames

### When to Skip Image Saves:
1. **Video-only exports** - Pure video concatenation without image processing
2. **Audio-only operations** - When only audio tracks are being modified
3. **Direct codec copy** - When no transcoding is needed
4. **Pass-through operations** - When input can be directly passed to output

## Implementation Plan

### 1. Add Detection Logic
```typescript
// Analyze timeline to determine if image processing is needed
function needsImageProcessing(timeline: Timeline): boolean {
  // Check for image elements
  const hasImageElements = timeline.tracks.some(track =>
    track.elements.some(el => el.type === 'image')
  );

  // Check for effects requiring image processing
  const hasImageEffects = timeline.tracks.some(track =>
    track.elements.some(el =>
      el.effects?.some(effect => EFFECTS_REQUIRING_IMAGES.includes(effect.type))
    )
  );

  // Check for stickers
  const hasStickers = timeline.stickers && timeline.stickers.length > 0;

  return hasImageElements || hasImageEffects || hasStickers;
}
```

### 2. Conditional Image Save Path
```typescript
// In export engine
async function processFrame(frame: VideoFrame, context: ExportContext) {
  if (context.needsImageProcessing) {
    // Save frame as image for processing
    await saveFrameAsImage(frame, context.tempDir);
    await applyImageEffects(frame, context);
  } else {
    // Direct video processing without image intermediates
    await processVideoDirectly(frame, context);
  }
}
```

### 3. Optimize FFmpeg Commands
```typescript
// Use direct stream copying when possible
function buildFFmpegCommand(options: ExportOptions): string[] {
  if (!options.needsImageProcessing) {
    // Use codec copy for faster processing
    return ['-c', 'copy', ...baseOptions];
  }

  // Full processing pipeline
  return ['-c:v', 'libx264', ...imageProcessingOptions];
}
```

## Benefits

1. **Performance Improvement**
   - Faster exports for video-only projects
   - Reduced disk I/O overhead
   - Lower CPU usage for simple concatenations

2. **Resource Efficiency**
   - Less disk space usage
   - Fewer temporary files to clean up
   - Better memory management

3. **Better UX**
   - Faster export times for users
   - More predictable performance
   - Reduced risk of disk space errors

## Testing Plan

1. **Test Cases**
   - [ ] Export video-only project (should skip image saves)
   - [ ] Export project with images (should save images)
   - [ ] Export project with stickers (should save images)
   - [ ] Export project with effects (should save based on effect type)
   - [ ] Export audio-only project (should skip image saves)
   - [ ] Export with codec copy (should skip image saves)

2. **Performance Metrics**
   - Measure export time before/after
   - Track disk I/O operations
   - Monitor temporary file count
   - Measure disk space usage

## Related Files

- `apps/web/src/lib/export-engine-factory.ts` - Export engine factory
- `apps/web/src/lib/export-engine-optimized.ts` - Optimized export engine
- `apps/web/src/lib/ffmpeg-utils.ts` - FFmpeg utilities
- `electron/ffmpeg-handler.ts` - Electron FFmpeg handler

## Priority

**Medium-High** - Significant performance impact for video-only exports

## Status

- [ ] Analysis complete
- [ ] Implementation plan approved
- [ ] Code changes implemented
- [ ] Tests passing
- [ ] Performance benchmarks complete
- [ ] Documentation updated
- [ ] Ready for merge

## Notes

- Ensure backward compatibility with existing projects
- Consider adding user setting to force image saves if needed
- Monitor for edge cases where image processing is needed but not detected
- Add telemetry to track how often optimization is applied
