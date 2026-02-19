# Screen Recording E2E Failure: `write after end` on stop

## Date
- 2026-02-19

## Scope
- Test: `apps/web/src/test/e2e/screen-recording-repro.e2e.ts`
- Flow: start recording -> wait ~2.2s -> stop recording

## Reproduction
1. Run:
   - `PLAYWRIGHT_HTML_OPEN=never bun run test:e2e -- apps/web/src/test/e2e/screen-recording-repro.e2e.ts --reporter=line`
2. Before fix: deterministic failure (reproduced twice).

## Observed Failure (Before Fix)
- Error at stop:
  - `Failed to stop screen recording ... Error invoking remote method 'screen:appendChunk': Error: Failed to append recording chunk: write after end`

## Root Cause
- Renderer queued chunk writes only after awaiting `event.data.arrayBuffer()`, so stop could proceed before the final chunk was actually chained.
- Main process closed the output stream on stop without waiting for all in-flight append writes to fully drain.
- Combined race produced `write after end`.

## Implemented Fix
1. Renderer queue hardening in `apps/web/src/lib/screen-recording-controller.ts`:
   - Changed chunk append path to register queue work synchronously.
   - Kept queue chain alive after errors, storing `chunkWriteError` for stop-time handling.
2. Main-process write serialization in `electron/screen-recording-handler.ts`:
   - Added `writeQueue` to active session state.
   - Appends now serialize through `appendChunkToSession(...)`.
   - Stop now waits for `writeQueue` before closing stream.

## Validation
1. Rebuilt distributables used by E2E:
   - `bun run build`
2. Re-ran repro test:
   - `PLAYWRIGHT_HTML_OPEN=never bun run test:e2e -- apps/web/src/test/e2e/screen-recording-repro.e2e.ts --reporter=line`
3. Result:
   - `1 passed (5.6s)`

## Outcome
- The `write after end` failure is resolved for the repro E2E path.

## Follow-up: MP4 Default Output
- User request: make recordings open in QuickTime by default.
- Implemented in `electron/screen-recording-handler.ts`:
  - Default output file extension is now `.mp4`.
  - Capture still streams into temporary `.webm` chunks.
  - On stop, capture is transcoded to H.264 MP4 via bundled FFmpeg.
  - If MP4 transcode fails, output falls back to `.webm` to avoid data loss.
- Updated E2E expectation in `apps/web/src/test/e2e/screen-recording-repro.e2e.ts`:
  - default `startResult.filePath` now expects `.mp4`.

## Follow-up Validation
1. Rebuilt app:
   - `bun run build`
2. Re-ran repro test:
   - `PLAYWRIGHT_HTML_OPEN=never bun run test:e2e -- apps/web/src/test/e2e/screen-recording-repro.e2e.ts --reporter=line`
3. Result:
   - `1 passed (5.7s)`
4. Verified output artifact:
   - `~/Movies/QCut Recordings/qcut-screen-recording-20260219-174332.mp4`
   - container: `mov,mp4,...`
   - codec: `h264`
