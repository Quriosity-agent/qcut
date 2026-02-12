# Fix Export Frame Drop - Implementation Plan

## Problem Summary

Exported video has ~4 FPS effective rate instead of 30 FPS. Root cause: `MediaRecorder` records in real-time but canvas rendering can't keep up, causing massive frame drops.

## Architecture Context

The export system has **3 engine types**:

| Engine | Path | Status |
|--------|------|--------|
| `CLIExportEngine` | Electron FFmpeg CLI | Working (bypasses canvas) |
| `ExportEngine` (Standard) | Browser MediaRecorder | **Broken** (frame drops) |
| `OptimizedExportEngine` | Browser MediaRecorder + caching | **Broken** (same issue) |

The CLI engine works well in Electron. The Standard/Optimized engines share the same fundamental flaw: `MediaRecorder` requires real-time frame delivery.

## Strategy

**Phase 1**: Frame-by-frame export for browser path (Option A - reliable fix)
**Phase 2**: Optimize rendering bottlenecks (Option B - performance gains)

---

## Phase 1: Frame-by-Frame Browser Export

### Subtask 1.1: Create `FrameByFrameRecorder` class

**What**: Replace `MediaRecorder` with a recorder that captures each frame as a PNG blob, stores them in memory, then encodes to video via FFmpeg WASM.

**Why**: The existing `FFmpegVideoRecorder` was disabled due to timeout issues, but the approach is correct. We need a fresh, simpler implementation that avoids the pitfalls.

**Files**:
- `apps/web/src/lib/export-frame-recorder.ts` (new - ~120 lines)

**Implementation**:
```typescript
export class FrameByFrameRecorder {
  private frames: Uint8Array[] = [];
  private canvas: HTMLCanvasElement;
  private settings: ExportSettings;
  private fps: number;

  // Capture current canvas state as PNG bytes
  async captureFrame(): Promise<void>;

  // Encode all captured frames into video blob using FFmpeg WASM
  async encode(): Promise<Blob>;

  // Cleanup memory
  dispose(): void;
}
```

**Key design decisions**:
- Use `canvas.toBlob("image/png")` instead of `toDataURL` to avoid base64 overhead
- Store raw `Uint8Array` frames to minimize memory copies
- Encode in a single FFmpeg WASM call at the end (not per-frame)
- Memory budget: ~2MB per 1080p PNG frame x 2000 frames = ~4GB max. For longer videos, flush frames to IndexedDB in batches

**Tests**: `apps/web/src/lib/__tests__/export-frame-recorder.test.ts`
- Test frame capture accumulates correct count
- Test encode produces a valid blob
- Test dispose clears memory

---

### Subtask 1.2: Re-enable and fix FFmpeg WASM encoding

**What**: The existing `ffmpeg-video-recorder.ts` has FFmpeg WASM encoding but it's disabled. Fix the timeout issues and create a focused encoding utility.

**Why**: We need FFmpeg WASM to assemble PNG frames into a video in the browser (no Electron dependency).

**Files**:
- `apps/web/src/lib/ffmpeg-video-recorder.ts` (modify)
- `apps/web/src/lib/ffmpeg-utils-encode.ts` (existing - review/modify)

**Implementation**:
- Fix `isFFmpegExportEnabled()` to return `true` when FFmpeg WASM is available
- Add timeout handling per-frame write (not global timeout)
- Add progress callback during encoding phase
- Guard with feature detection: if FFmpeg WASM fails to load, fall back to MediaRecorder with a warning

**Tests**: `apps/web/src/lib/__tests__/ffmpeg-video-recorder.test.ts`
- Test encoding with mock frames
- Test timeout handling
- Test fallback behavior

---

### Subtask 1.3: Integrate frame-by-frame recorder into export loop

**What**: Modify the export loop in `ExportEngine.export()` to use `FrameByFrameRecorder` instead of `MediaRecorder` when available.

**Why**: The frame loop already renders each frame correctly - we just need to swap the capture mechanism.

**Files**:
- `apps/web/src/lib/export-engine.ts` (modify lines 287-410)
- `apps/web/src/lib/export-engine-recorder.ts` (modify)

**Current flow** (broken):
```
render frame → videoTrack.requestFrame() → wait 50ms → next frame
```

**New flow** (fixed):
```
render frame → canvas.toBlob() → store bytes → next frame (no wait needed)
after all frames → FFmpeg WASM encode → return blob
```

**Key changes**:
- Remove the `captureStream(0)` + `requestFrame()` path
- Remove the arbitrary `setTimeout(resolve, 50)` delay between frames
- Add two-phase progress: "Rendering frames (1/2000)" then "Encoding video..."
- Keep MediaRecorder as ultimate fallback if FFmpeg WASM unavailable

**Tests**: `apps/web/src/lib/__tests__/export-engine.test.ts`
- Test that export uses frame-by-frame when FFmpeg WASM available
- Test fallback to MediaRecorder when unavailable

---

### Subtask 1.4: Update export factory and UI

**What**: Update the engine factory to prefer frame-by-frame for browser exports. Update progress UI to show two-phase export.

**Files**:
- `apps/web/src/lib/export-engine-factory.ts` (modify engine recommendation)
- `apps/web/src/components/export-dialog.tsx` (modify progress display)

**Changes**:
- Factory: Browser recommendation should note "frame-by-frame" in reason text
- UI: Show "Rendering frame X of Y..." during capture phase, "Encoding video..." during FFmpeg phase
- Add estimated time remaining based on average frame render time

---

## Phase 2: Optimize Rendering Bottlenecks

### Subtask 2.1: Eliminate video seek delays

**What**: The biggest rendering bottleneck is video seeking. Each frame waits 150ms after seek + up to 2000ms timeout. This alone accounts for most of the slowness.

**Files**:
- `apps/web/src/lib/export-engine-renderer.ts` (modify `renderVideo`, lines 215-389)

**Optimizations**:
- **Pre-decode video frames**: Before export, decode all needed video frames into an `ImageBitmap` cache using `createImageBitmap()` from video element
- **Sequential seek optimization**: When frames are sequential (most common), skip the seek entirely - the video is already at the right position
- **Reduce post-seek delay**: 150ms is excessive for sequential playback; use 16ms (one vsync) for sequential frames, keep 150ms only for large seeks
- **Use `requestVideoFrameCallback`** where supported for precise frame timing

**Tests**: `apps/web/src/lib/__tests__/export-engine-renderer.test.ts`
- Test sequential frame optimization skips seek
- Test pre-decode cache hit rate

---

### Subtask 2.2: Optimize image loading

**What**: Images are loaded with `new Image()` on every frame, even if the same image was used in the previous frame.

**Files**:
- `apps/web/src/lib/export-engine-renderer.ts` (modify `renderImage`, lines 123-212)

**Optimizations**:
- Pre-load all images before export starts (already done in `OptimizedExportEngine.preloadAssets()`)
- Port the preloading logic to the base `ExportEngine`
- Use `createImageBitmap()` for faster canvas drawing (avoids decode-on-draw)

---

### Subtask 2.3: Batch frame validation

**What**: Frame validation (`getImageData` + pixel sampling) runs every 10th frame. `getImageData` forces a GPU→CPU readback which stalls the pipeline.

**Files**:
- `apps/web/src/lib/export-engine.ts` (modify validation logic, lines 331-357)

**Optimizations**:
- Only validate first frame and last frame (not every 10th)
- Or validate asynchronously after export completes by decoding the output video
- Remove `getImageData` from the hot path entirely

---

## Implementation Order

```
1.1 Create FrameByFrameRecorder  ──┐
                                    ├── 1.3 Integrate into export loop ── 1.4 Update factory/UI
1.2 Fix FFmpeg WASM encoding    ──┘

2.1 Eliminate video seek delays (independent)
2.2 Optimize image loading (independent)
2.3 Batch frame validation (independent)
```

Phase 1 subtasks (1.1-1.4) are sequential. Phase 2 subtasks (2.1-2.3) are independent and can be done in any order after Phase 1.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| FFmpeg WASM memory limits (4GB for long videos) | Flush frames to IndexedDB/OPFS in batches of 300 |
| FFmpeg WASM load failure in some browsers | Fall back to MediaRecorder with user warning |
| `canvas.toBlob()` slower than expected | Use `OffscreenCanvas.convertToBlob()` where available |
| Phase 2 seek optimization breaks edge cases | Keep retry mechanism, only optimize the common path |

## Success Criteria

- Exported video has consistent 30 FPS (verified via ffprobe)
- All frames rendered (frame count = duration x fps)
- No visible stutter or frame drops
- Export works in both Electron and browser
- Existing CLI export path unaffected
