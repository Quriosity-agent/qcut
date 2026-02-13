# Console Audio Bug (Export Uses Video Only)

## Problem

On timelines with both video and audio tracks, exports could end up with video only.

Main cause: audio preparation relied heavily on `fetch(mediaItem.url)`, which is brittle for some timeline media states. If that fetch path failed, audio sources were dropped before FFmpeg export.

## Long-Term Fix Implemented

1. Added a dedicated audio source resolver:
   - `apps/web/src/lib/export-cli/sources/audio-sources.ts`
2. Audio input resolution now uses stable fallback order:
   1. `mediaItem.localPath` (if file exists)
   2. `mediaItem.file` bytes (save temp)
   3. `mediaItem.url` fetch fallback
3. Updated CLI export audio preparation to use this resolver:
   - `apps/web/src/lib/export-engine-cli.ts`
4. Kept request-scoped `includeAudio` behavior and existing FFmpeg validation/mixing flow.
5. Added focused tests:
   - `apps/web/src/lib/export-cli/sources/__tests__/audio-sources.test.ts`

## Validation

1. `apps/web/node_modules/.bin/vitest run apps/web/src/lib/export-cli/sources/__tests__/audio-sources.test.ts apps/web/src/lib/export-cli/sources/__tests__/audio-detection.test.ts`
2. `apps/web/node_modules/.bin/vitest run electron/__tests__/ffmpeg-args-builder.test.ts apps/web/src/lib/__tests__/export-analysis.test.ts`
3. `apps/web/node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json`
4. `node_modules/.bin/tsc --noEmit -p electron/tsconfig.json`
