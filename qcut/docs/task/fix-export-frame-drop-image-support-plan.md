# Fix Export Frame Drop - Implementation Plan (v2)

## Problem Summary

Exported video has ~4 FPS effective rate instead of 30 FPS when timeline contains mixed image+video elements.

## Root Cause

The CLI export engine (Electron FFmpeg) **explicitly rejects image elements** in `export-analysis.ts:712`. When images are present, export falls back to the browser `MediaRecorder` path, which can't keep up with real-time rendering, causing massive frame drops.

```text
Timeline has images → CLIExportEngine throws ExportUnsupportedError("image-elements")
→ Falls back to Standard ExportEngine (MediaRecorder)
→ MediaRecorder records real-time but rendering takes >33ms/frame
→ Result: 4 FPS choppy output
```

## Fix Strategy

**Add image support to the CLI export engine.** FFmpeg natively handles images as video inputs via `-loop 1 -t <duration> -i image.png`. This is the same technique already used for sticker overlays - we just need to extend it to timeline image elements.

No new recorder classes or FFmpeg WASM changes needed. The existing CLI architecture handles everything.

---

## Subtask 1: Remove image rejection from export validation

**What**: Remove the `ExportUnsupportedError("image-elements")` check and update the analysis to route image timelines through a new strategy.

**Files**:
- `apps/web/src/lib/export-analysis.ts` (lines 692-717, 394-396, 412-419)
- `apps/web/src/lib/export-errors.ts` (keep type for backward compat, remove from validation)

**Changes**:
1. In `validateTimelineForExport()`: Remove the `hasImageElements` check that throws
2. In `analyzeTimelineForExport()`: Add new optimization strategy `"image-video-composite"` for mixed image+video timelines
3. Update `ExportAnalysis.optimizationStrategy` union type to include `"image-video-composite"`
4. Keep `needsFrameRendering` flag set when images present (for logging), but don't block export

**Tests**: `apps/web/src/lib/__tests__/export-analysis.test.ts`
- Test that mixed image+video timeline no longer throws
- Test that strategy is `"image-video-composite"` when images present
- Test that pure video timelines still use existing strategies unchanged

---

## Subtask 2: Extract image sources from timeline

**What**: Create an image source extractor (similar to existing `extractVideoSources`) that identifies image elements and resolves their file paths for FFmpeg.

**Files**:
- `apps/web/src/lib/export-cli/sources/image-sources.ts` (new ~80 lines)
- `apps/web/src/lib/export-cli/types.ts` (add `ImageSourceInput` type)

**ImageSourceInput type**:
```typescript
export interface ImageSourceInput {
  path: string;          // Local file path for FFmpeg
  startTime: number;     // When image appears on timeline
  duration: number;      // How long image is visible
  width?: number;        // Original image width
  height?: number;       // Original image height
  trimStart: number;     // Trim start (usually 0 for images)
  trimEnd: number;       // Trim end (usually 0 for images)
  elementId: string;     // For debugging
}
```

**Implementation**:
- Iterate timeline tracks, find media elements where `mediaItem.type === "image"`
- Resolve `localPath` from mediaItem (same as video source extraction)
- If no `localPath`, download image to temp dir via IPC (same pattern as sticker sources)
- Calculate effective `startTime` and `duration` from element properties

**Tests**: `apps/web/src/lib/__tests__/export-cli-image-sources.test.ts`
- Test extraction from timeline with images
- Test localPath resolution
- Test mixed image+video timeline extraction

---

## Subtask 3: Build FFmpeg filter graph for image compositing

**What**: Generate FFmpeg `-filter_complex` chains that composite images onto the video timeline at the correct positions and durations.

**Files**:
- `apps/web/src/lib/export-cli/filters/image-overlay.ts` (new ~100 lines)

**FFmpeg approach**: Each image becomes an input with `-loop 1 -t <duration> -i <path>`, then overlaid using:
```text
[img]scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2:black,
     setpts=PTS+<startTime>/TB[img_timed];
[base][img_timed]overlay=0:0:enable='between(t,<start>,<end>)'[out]
```

**Key design decisions**:
- Reuse the same overlay pattern already proven for stickers
- Scale images to fit export resolution (maintain aspect ratio, pad with black)
- Support element `x`, `y` positioning if set, otherwise center
- Chain multiple image overlays sequentially (same as sticker overlay chaining)
- Handle timing via `enable='between(t,start,end)'` filter option

**Tests**: `apps/web/src/lib/__tests__/export-cli-image-overlay.test.ts`
- Test single image overlay filter generation
- Test multiple image overlay chaining
- Test image scaling/positioning in filter string

---

## Subtask 4: Integrate image sources into CLIExportEngine

**What**: Wire the image extraction and filter building into the CLI export flow, alongside existing video/text/sticker handling.

**Files**:
- `apps/web/src/lib/export-engine-cli.ts` (modify `exportWithCLI` method, lines 451-849)

**Changes**:
1. Add `extractImageSourcesWrapper()` method (same pattern as video/sticker wrappers)
2. In `exportWithCLI()`:
   - After sticker extraction, extract image sources
   - Build image overlay filter chain
   - Pass `imageSources` and `imageFilterChain` to FFmpeg export options
3. Handle the `"image-video-composite"` strategy in the mode selection logic

**Integration point** (after line 678 in current code):
```typescript
// Extract image sources
let imageFilterChain: string | undefined;
let imageSources: ImageSourceInput[] = [];
if (this.exportAnalysis?.hasImageElements) {
  imageSources = await this.extractImageSourcesWrapper();
  if (imageSources.length > 0) {
    imageFilterChain = buildImageOverlayFilters(imageSources, this.canvas.width, this.canvas.height);
  }
}
```

---

## Subtask 5: Extend Electron FFmpeg handler for image inputs

**What**: Update the FFmpeg args builder and export handler to accept image sources and include them in the FFmpeg command.

**Files**:
- `electron/ffmpeg-args-builder.ts` (extend `buildFFmpegArgs`)
- `electron/ffmpeg-export-handler.ts` (pass new options through)
- `electron/ffmpeg/types.ts` (add `ImageSource` type)

**Changes to `buildFFmpegArgs`**:
1. Accept new params: `imageSources?: ImageSource[]`, `imageFilterChain?: string`
2. Add image inputs before sticker inputs: `-loop 1 -t <duration> -i <image_path>`
3. Include `imageFilterChain` in the filter chain assembly
4. Adjust input stream indices to account for image inputs (images come after video, before stickers and audio)

**Input ordering**:
```text
[0] video input
[1..N] image inputs (-loop 1 -t duration -i path)
[N+1..M] sticker inputs (-loop 1 -i path)
[M+1..K] audio inputs (-i path)
```

**Tests**: `electron/__tests__/ffmpeg-args-builder.test.ts`
- Test FFmpeg args include image inputs with `-loop 1 -t`
- Test filter chain includes image overlay filters
- Test stream index calculation with mixed inputs

---

## Subtask 6: Handle image-only timelines (no video)

**What**: Support exporting timelines that contain only images (no video elements). Currently blocked by `ExportUnsupportedError("no-video-elements")`.

**Files**:
- `apps/web/src/lib/export-analysis.ts` (modify `validateTimelineForExport`)
- `electron/ffmpeg-args-builder.ts` (handle no base video input)

**Changes**:
- Update validation: allow export when `videoElementCount === 0` but `hasImageElements === true`
- For image-only timelines, use the first image as the base input instead of a video
- Generate a black background video with `color=c=black:s=WxH:d=<duration>` as the base, then overlay images on top

**FFmpeg base for image-only**:
```bash
ffmpeg -f lavfi -i color=c=black:s=1920x1080:d=10:r=30 \
  -loop 1 -t 5 -i image1.png \
  -filter_complex "[1:v]scale=...[img];[0:v][img]overlay=..." \
  output.mp4
```

**Tests**: `apps/web/src/lib/__tests__/export-analysis.test.ts`
- Test image-only timeline passes validation
- Test base video generation for image-only export

---

## Implementation Order

```text
1. Remove image rejection          ──┐
2. Extract image sources           ──┤
3. Build image overlay filters     ──┼── 4. Integrate into CLIExportEngine ── 5. Extend Electron handler
                                     │
                                     └── 6. Image-only timelines (can be parallel with 4-5)
```

Subtasks 1-3 are independent and can be done in parallel.
Subtask 4 depends on 1-3.
Subtask 5 depends on 4.
Subtask 6 is independent but requires changes from 1.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Images without `localPath` | Download to temp dir via IPC (same as sticker pattern) |
| Complex filter graphs with many images | FFmpeg handles 10+ overlay chains; test with 5+ images |
| Input stream index miscalculation | Clear ordering convention: video → images → stickers → audio |
| Image scaling distortion | Use `force_original_aspect_ratio=decrease` + `pad` (proven pattern) |
| Browser fallback still broken | Separate issue; this plan fixes the primary Electron path |

## Success Criteria

- Mixed image+video timeline exports at 30 FPS via CLI engine
- Image-only timeline exports at 30 FPS via CLI engine
- Images correctly positioned, scaled, and timed in output
- Pure video timelines unaffected (same Mode 1/1.5/2 behavior)
- No regression in text/sticker overlay exports
- Verified via ffprobe: consistent frame timing, correct duration

## Files Summary

| File | Action |
|------|--------|
| `apps/web/src/lib/export-analysis.ts` | Modify (remove image rejection, add strategy) |
| `apps/web/src/lib/export-errors.ts` | Keep (backward compat) |
| `apps/web/src/lib/export-engine-cli.ts` | Modify (add image extraction + filter wiring) |
| `apps/web/src/lib/export-cli/types.ts` | Modify (add `ImageSourceInput`) |
| `apps/web/src/lib/export-cli/sources/image-sources.ts` | **New** (~80 lines) |
| `apps/web/src/lib/export-cli/filters/image-overlay.ts` | **New** (~100 lines) |
| `electron/ffmpeg-args-builder.ts` | Modify (add image inputs + filters) |
| `electron/ffmpeg-export-handler.ts` | Modify (pass image options) |
| `electron/ffmpeg/types.ts` | Modify (add `ImageSource` type) |
| `apps/web/src/lib/__tests__/export-analysis.test.ts` | **New/Modify** |
| `apps/web/src/lib/__tests__/export-cli-image-sources.test.ts` | **New** |
| `apps/web/src/lib/__tests__/export-cli-image-overlay.test.ts` | **New** |
| `electron/__tests__/ffmpeg-args-builder.test.ts` | **New/Modify** |
