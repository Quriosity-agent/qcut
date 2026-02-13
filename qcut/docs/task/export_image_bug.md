# Export Image + Video Bug (Long-Term Fix)

## Problem

Image+video exports were unstable in the CLI pipeline:

1. `buildFFmpegArgs()` used a long positional signature that drifted over time.
2. Mode 2 video-input calls were accidentally interpreted as image-only mode.
3. Mixed image+video timelines could render with a black base instead of the real video.
4. Image processing failures were silently ignored (`continue without images`), causing hidden export corruption.

## Long-Term Direction

Build export arguments from a typed config object and keep composition logic in one place (Electron FFmpeg args builder), so input indexing and filter ordering stay correct across:

1. video-only + filters
2. mixed video + images + stickers + text
3. image-only timelines
4. Windows + macOS path handling

## Implemented

1. Refactored `electron/ffmpeg-args-builder.ts` to object-based API (`BuildFFmpegArgsOptions`).
2. Reworked composite-mode arg building to preserve video as base when available.
3. Kept image-only support with generated lavfi color base.
4. Added unified filter graph construction for video/image/sticker/text + audio mapping.
5. Normalized concat list paths for Windows (`\` -> `/`) for direct-copy concat files.
6. Updated `electron/ffmpeg-export-handler.ts` to use the object API and strengthened direct-copy guards when image overlays are present.
7. Updated `apps/web/src/lib/export-engine-cli.ts`:
   - Use video input for `image-video-composite` when exactly one visible video exists.
   - Fail fast when image source extraction fails.
   - Avoid silent “continue without images” behavior.
8. Replaced stale args-builder tests with coverage for mixed image+video and image-only modes.

## Validation

1. `apps/web/node_modules/.bin/vitest run electron/__tests__/ffmpeg-args-builder.test.ts`
2. `apps/web/node_modules/.bin/vitest run apps/web/src/lib/__tests__/export-analysis.test.ts electron/__tests__/ffmpeg-args-builder.test.ts`
3. `node_modules/.bin/tsc --noEmit -p electron/tsconfig.json`
4. `apps/web/node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json`
