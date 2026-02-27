# Native CLI Skill Test Failure Analysis

**Session**: `8717bd6b` | **Date**: 2026-02-27 17:07 | **CWD**: `~/Documents/QCut Projects/fea526ea-...`
**Final Outcome**: FAILED at Step 4 of 8. User interrupted.

## What Was Tested

An 8-step end-to-end workflow using the native-cli skill:

1. Find project
2. Enter editor
3. Start recording
4. Generate images (nano_banana_2_edit, sci-fi theme, reference image)
5. Move images into timeline
6. Play timeline
7. Finish recording
8. Verify recording

## Step Results

| Step | Command | Result |
|------|---------|--------|
| 1. Find project | `editor:navigator:projects` | PASS |
| 2. Enter editor | `editor:navigator:open --project-id ...` | PASS |
| 3. Start recording | `editor:screen-recording:start` | **FAIL** (4 attempts) |
| 4. Generate images | `generate-image -m nano_banana_2_edit` | **PARTIAL** (1/2 images, user killed 2nd) |
| 5-8 | Never reached | SKIPPED |

## Bug 1: Screen Recording Stop is a No-Op (Critical)

**Severity**: Critical
**Component**: `electron/screen-recording-handler.ts` (IPC)

### Symptoms

- A stale recording was active from a previous session (`7887ec1c`)
- `editor:screen-recording:stop` returns `{ success: true }` but does NOT actually stop
- `editor:screen-recording:stop --discard` also returns success but recording continues
- Status check immediately after stop shows same session still recording with growing `bytesWritten`

### Reproduction

```bash
# Start a recording, then try to stop it from a different session
bun run pipeline editor:screen-recording:stop
# Returns: { success: true, filePath: null, bytesWritten: 0, durationMs: 0 }

bun run pipeline editor:screen-recording:status
# Returns: recording STILL active, bytesWritten increasing
```

### Root Cause (Likely)

The stop handler may be:
1. Checking a different internal state than the actual MediaRecorder/desktopCapturer session
2. Creating a "new" recording context on each IPC call, so `stop` stops a phantom empty recording (hence `filePath: null, bytesWritten: 0`) while the real one keeps running
3. Not properly referencing the singleton recording state across IPC boundaries

### Fix Required

- Screen recording must be a true singleton: one active recording at a time across the entire app
- `stop` must kill the actual running MediaRecorder, not just clear local state
- If a recording is "orphaned" (started by a different session/caller), `stop` should still terminate it
- Return an error if stop fails, not `{ success: true }`

## Bug 2: No CLI Command for Timeline Playback (Gap)

**Severity**: Medium
**Component**: `electron/native-pipeline/cli/cli-handlers-editor.ts`

### Symptoms

The assistant searched extensively for play/transport/playback CLI commands and found none. There is no `editor:timeline:play` or `editor:transport:toggle` command.

### Impact

Step 6 ("play it in the timeline") cannot be completed via CLI. The workaround was to use AppleScript to simulate spacebar - fragile and platform-dependent.

### Fix Required

Add `editor:timeline:play`, `editor:timeline:pause`, `editor:timeline:seek` commands that dispatch to the timeline store's `setPlaying(true/false)` and `seekTo(time)`.

## Bug 3: No Force-Stop / Cleanup for Stale Recordings (Robustness)

**Severity**: Medium

### Symptoms

When a recording was started by a previous Claude session (or manually), the new session had no way to forcefully terminate it. The 4-attempt retry loop with sleep was futile.

### Fix Required

- Add `editor:screen-recording:force-stop` that kills any active recording regardless of origin
- Or make the normal `stop` command work properly (Bug 1 fix)
- Add `editor:screen-recording:start --force` that stops any existing recording first

## Recommendations to Make Industry-Level Robust

### 1. Screen Recording Singleton (Priority: P0)

```typescript
// screen-recording-handler.ts
class ScreenRecordingManager {
  private static instance: ScreenRecordingManager;
  private activeRecorder: MediaRecorder | null = null;
  private sessionId: string | null = null;

  stop(): { success: boolean; filePath: string | null } {
    if (!this.activeRecorder) {
      return { success: false, error: "No active recording" };
    }
    this.activeRecorder.stop(); // Actually stop the real recorder
    // ... flush, save, cleanup
  }
}
```

### 2. Add Missing Timeline Transport Commands (Priority: P1)

```typescript
// cli-handlers-editor.ts
"editor:timeline:play": async () => { /* setPlaying(true) */ },
"editor:timeline:pause": async () => { /* setPlaying(false) */ },
"editor:timeline:toggle-play": async () => { /* toggle */ },
"editor:timeline:seek": async ({ time }) => { /* seekTo(time) */ },
```

### 3. Idempotent Start/Stop (Priority: P1)

- `start` when already recording: return current session info (or stop + restart with `--force`)
- `stop` when not recording: return `{ success: true, wasRecording: false }` (not an error)
- `stop` must ALWAYS actually stop: verify the recorder is dead before returning success

### 4. Health Check for Stale State (Priority: P2)

```bash
bun run pipeline editor:screen-recording:status --heal
# If recording session is stale (no bytesWritten growth), force cleanup
```

### 5. CLI Workflow Integration Test (Priority: P2)

Add an automated test that runs the full 8-step workflow:

```bash
bun run pipeline test:cli-workflow \
  --steps "find-project,open-editor,start-recording,generate-image,add-to-timeline,play,stop-recording,verify"
```

This would catch regressions in the end-to-end CLI skill flow.

## Files to Investigate

| File | Why |
|------|-----|
| `electron/screen-recording-handler.ts` | Bug 1: stop not actually stopping |
| `electron/native-pipeline/cli/cli-handlers-editor.ts` | Bug 2: missing play/seek commands |
| `apps/web/src/stores/timeline-store.ts` | Timeline play/pause state for new commands |
| `electron/preload.ts` | IPC bridge for screen recording |
