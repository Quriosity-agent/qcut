# Fix Export Frame Drop Issue

## Problem

Exported video (`export_2026-02-12_00-43.webm`) has severe quality issues - video appears choppy and stuttery.

## FFprobe Analysis

| Metric | Actual | Expected |
|--------|--------|----------|
| Frames | 274 | ~2000 (at 30fps for 66.7s) |
| Duration | 66.75s | - |
| Effective FPS | 4.10 | 30 |
| Avg frame gap | 244.5ms | 33.3ms |
| Min frame gap | 43.0ms | ~33ms |
| Max frame gap | 895.0ms | ~33ms |
| Gap std deviation | 289.7ms | ~0ms |
| Large gaps (>100ms) | 123 / 273 | 0 |
| Audio stream | None | Present |
| Codec | VP9 | - |
| Resolution | 1920x1080 | 1920x1080 |
| Encoder | Chrome (MediaRecorder) | - |

## Key Observations

1. **Effective FPS is 4.1 instead of 30** - only 274 frames were captured across 66.7 seconds
2. **Wildly inconsistent frame timing** - gaps range from 43ms to 895ms with high variance
3. **123 out of 273 frame gaps exceed 100ms** - nearly half the frames have visible stutter
4. **No audio stream** - export produced video-only output
5. **Encoder is Chrome's MediaRecorder** - this is the canvas-based browser export path

## Frame Timing Sample (worst section)

```text
Frame 151->152: 313ms (at 9.157s)
Frame 152->153: 249ms (at 9.470s)
Frame 164->165: 856ms (at 12.206s)  <- nearly 1 second gap
Frame 165->166: 866ms (at 13.062s)  <- nearly 1 second gap
```

## Root Cause

The canvas-based `MediaRecorder` export records in **real-time**, but the rendering pipeline cannot keep up with the 30 FPS target. When canvas rendering takes longer than 33.3ms per frame, `MediaRecorder` drops frames, resulting in:

- Choppy playback at ~4 FPS effective rate
- Variable frame timing (no constant frame rate)
- Long freeze frames where rendering stalled (850ms+ gaps)

## Potential Fixes

### Option A: Frame-by-frame export (non-realtime)

Instead of real-time `MediaRecorder`, render each frame to canvas sequentially and encode offline:
- Capture each frame as a blob/image
- Assemble frames into video using FFmpeg WASM or Electron FFmpeg
- Guarantees every frame is captured regardless of render speed

### Option B: Optimize render pipeline

Reduce per-frame render cost to consistently hit <33ms:
- Profile which elements are slow (video decode, effects, text rendering)
- Use offscreen canvas / WebGL for compositing
- Pre-decode video frames into an image cache

### Option C: Adaptive frame rate in MediaRecorder

- Detect when rendering falls behind
- Lower the target FPS dynamically
- At minimum, warn the user about expected quality

### Recommended Approach

**Option A** is the most reliable fix. The current `MediaRecorder` approach is fundamentally limited by real-time constraints. A frame-by-frame pipeline (already partially implemented via the FFmpeg export path) would guarantee consistent output quality regardless of timeline complexity.

## Files to Investigate

- `apps/web/src/lib/export-engine.ts` - Main export engine
- `apps/web/src/lib/export-engine-optimized.ts` - Optimized export variant
- `apps/web/src/lib/export-engine-renderer.ts` - Frame rendering logic
- `apps/web/src/lib/export-engine-utils.ts` - Export utilities
- `apps/web/src/lib/ffmpeg-video-recorder.ts` - FFmpeg-based recorder (alternative path)
