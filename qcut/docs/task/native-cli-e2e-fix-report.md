# Native CLI E2E Fix Report

Date: 2026-02-27

## Context

Ran the full 8-step native CLI workflow end-to-end:

1. Find project
2. Enter editor
3. Start screen recording
4. Generate 2 sci-fi images (nano_banana_pro + character reference)
5. Import media and add to timeline
6. Play timeline
7. Stop recording
8. Verify recording file

Three failures were discovered and fixed across two sessions.

---

## Bug 1: Images Not Appearing in Timeline

**Symptom**: `editor:timeline:add-element` CLI command returns `success: true` with an `elementId`, but images never appear in the visual timeline.

**Root Cause**: Field name mismatch between CLI and renderer.

The CLI sends elements with `mediaId` (the media library ID returned by `editor:media:import`):
```json
{"type": "image", "mediaId": "media_b3V0cHV0XzE3NzIx...", "startTime": 0, "duration": 5}
```

But the renderer's `findMediaItemForElement()` only checks `sourceName` and `sourceId` — it never looks at `mediaId`. When media resolution fails, the element is silently dropped with a debug warning.

Additionally, the HTTP route uses fire-and-forget `webContents.send()`, so the CLI always reports success regardless of whether the renderer actually added the element.

**Fix**:

1. **`apps/web/src/lib/claude-bridge/claude-timeline-bridge-helpers.ts`** — Added `mediaId` as the first lookup in `findMediaItemForElement()`:
   ```typescript
   if (element.mediaId) {
       const mediaByMediaId = mediaItems.find(item => item.id === element.mediaId);
       if (mediaByMediaId) return mediaByMediaId;
   }
   ```

2. **Same file** — Updated the guard in `addClaudeMediaElement()` to also check `mediaId`:
   ```typescript
   if (!mediaItem && !element.sourceId && !element.mediaId) { ... return; }
   ```

3. **Same file** — Updated fallback resolved ID:
   ```typescript
   const resolvedId = mediaItem?.id ?? element.mediaId ?? element.sourceId!;
   ```

4. **`electron/types/claude-api.ts`** — Added `mediaId?: string` to `ClaudeElement` interface.

---

## Bug 2: Timeline Playback Commands Missing

**Symptom**: `editor:timeline:play` returns 404 — no HTTP route, no preload listener, no renderer handler.

**Root Cause**: The Codex agent that added CLI handlers for play/pause/seek only added the CLI-side dispatch code (`editor-handlers-timeline.ts`), but missed:
- The HTTP route in the server
- The preload IPC listener
- The renderer-side bridge handler that calls the playback store

**Fix** (4 files, full pipeline):

1. **`electron/claude/http/claude-http-shared-routes.ts`** — Added POST `/api/claude/timeline/:projectId/playback` route that sends `claude:timeline:playback` to renderer via `webContents.send()`.

2. **`electron/preload-integrations.ts`** — Added `onPlayback` listener + cleanup in `removeListeners()`.

3. **`apps/web/src/lib/claude-bridge/claude-timeline-bridge.ts`** — Added renderer handler that calls `usePlaybackStore.getState().play/pause/toggle/seek()`.

4. **Type definitions** — Added `onPlayback` to both `apps/web/src/types/electron/api-claude.ts` and `electron/preload-types/electron-api.ts`.

---

## Bug 3: Stop Recording Timeout

**Symptom**: `editor:screen-recording:stop` hangs for 60+ seconds then returns `"Main process request timed out"`. Recording file exists on disk with data but can't be cleanly stopped.

**Root Cause** (3 layers):

### Layer 1: Renderer `waitForRecorderStop()` has no timeout
In `screen-recording-controller.ts`, the stop flow calls `waitForRecorderStop()` which creates a promise that resolves on the MediaRecorder `stop` event. For long recordings, this event never fires, so the promise hangs forever.

```typescript
// BEFORE: No timeout — hangs if MediaRecorder.stop() event never fires
await new Promise<void>((resolve, reject) => {
    mediaRecorder.addEventListener("stop", handleStop);
    mediaRecorder.stop();
});
```

### Layer 2: Main process waits 60s for renderer, no fallback
In `claude-screen-recording-handler.ts`, `requestStopRecordingFromRenderer()` sends an IPC message to the renderer and waits 60s. When the renderer hangs (Layer 1), the entire stop fails after a full minute with no recovery.

### Layer 3: Force-stop hangs on `fileStream.end()` and `writeQueue`
The force-stop function (`forceStopActiveScreenRecordingSession`) was designed as a fallback, but it also hung because:
- `discardActiveSession()` calls `await sessionData.writeQueue` — hangs because the renderer keeps sending chunks
- `closeStream()` calls `fileStream.end()` — hangs because `.end()` waits for pending writes to flush

**Fix**:

### Layer 1: Add 30s timeout to `waitForRecorderStop()`
**File**: `apps/web/src/lib/project/screen-recording-controller.ts`

```typescript
const timer = setTimeout(() => {
    cleanup();
    console.warn("[ScreenRecording] MediaRecorder stop timed out, forcing inactive");
    resolve();
}, RECORDER_STOP_TIMEOUT_MS); // 30_000
```

### Layer 2: Auto-fallback to force-stop in main process
**File**: `electron/claude/handlers/claude-screen-recording-handler.ts`

Changed `requestStopRecordingFromRenderer()` to try the renderer-based stop for 15s, then automatically fall back to `forceStopActiveScreenRecordingSession()`:

```typescript
try {
    return await rendererStopPromise; // 15s timeout
} catch {
    // Renderer didn't respond — force-stop from main process
    const result = await forceStopActiveScreenRecordingSession();
    return { success: result.success, filePath: result.filePath ?? null, ... };
}
```

### Layer 3: Force-stop uses `destroy()` instead of `end()`
**File**: `electron/screen-recording-handler/ipc.ts`

- Clears the active session immediately (rejects incoming chunks)
- Uses `fileStream.destroy()` instead of `fileStream.end()` (no pending-write wait)
- Attempts `finalizeRecordingOutput()` to transcode whatever was written
- Falls back to cleanup if finalization fails

```typescript
setActiveSession(null);              // Reject new chunks immediately
sessionToStop.fileStream.destroy();  // Don't wait for pending writes
await finalizeRecordingOutput(...);  // Transcode what we have
```

---

## Files Modified

| File | Changes |
|------|---------|
| `apps/web/src/lib/claude-bridge/claude-timeline-bridge-helpers.ts` | Added `mediaId` lookup to media resolution |
| `electron/types/claude-api.ts` | Added `mediaId?` to `ClaudeElement` |
| `electron/claude/http/claude-http-shared-routes.ts` | Added playback HTTP route |
| `electron/preload-integrations.ts` | Added `onPlayback` listener + cleanup |
| `apps/web/src/lib/claude-bridge/claude-timeline-bridge.ts` | Added playback handler calling store |
| `apps/web/src/types/electron/api-claude.ts` | Added `onPlayback` type |
| `electron/preload-types/electron-api.ts` | Added `onPlayback` type |
| `apps/web/src/lib/project/screen-recording-controller.ts` | 30s timeout on `waitForRecorderStop()` |
| `electron/claude/handlers/claude-screen-recording-handler.ts` | 15s renderer timeout + force-stop fallback |
| `electron/screen-recording-handler/ipc.ts` | Force-stop uses `destroy()`, skips writeQueue |
| `electron/utility/utility-http-server.ts` | Reduced force-stop HTTP timeout to 15s |
| `electron/native-pipeline/cli/cli-handlers-editor.ts` | Reverted CLI-level fallback (now handled in main process) |

## Verification

All 8 steps pass after fixes:

| Step | Command | Result |
|------|---------|--------|
| 1 | `editor:navigator:projects` | PASS |
| 2 | `editor:navigator:open` | PASS |
| 3 | `editor:screen-recording:start` | PASS |
| 4 | `generate-image` x2 (nano_banana_pro) | PASS |
| 5 | `editor:media:import` + `editor:timeline:add-element` | PASS (images visible in timeline) |
| 6 | `editor:timeline:seek` + `editor:timeline:play` | PASS |
| 7 | `editor:screen-recording:stop` | PASS (2.4MB, ~15s, force-stop fallback) |
| 8 | File verification | PASS |

Build: clean. TypeScript: 0 errors. Tests: 3602/3605 pass (3 pre-existing failures in `media-store-helpers.test.ts`).
