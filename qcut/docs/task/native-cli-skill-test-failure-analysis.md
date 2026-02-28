# Native CLI Skill Test Failure Analysis (Revalidation)

**Original session**: `8717bd6b` (2026-02-27)  
**Revalidated on codebase**: 2026-02-28  
**Method**: direct code inspection + targeted tests

## Original Workflow (Historical)

1. Find project
2. Enter editor
3. Start recording
4. Generate images
5. Move images into timeline
6. Play timeline
7. Finish recording
8. Verify recording

## Status of Original Findings

| Original Finding | Current Status | Notes |
|---|---|---|
| Bug 1: screen recording stop can be a no-op | **Partially fixed; residual risk remains** | Singleton state + force-stop path now exist, but a stale renderer-state edge case can still report success without clearing main-process session |
| Bug 2: no CLI timeline playback commands | **Fixed** | `play/pause/toggle-play/seek` are implemented end-to-end |
| Bug 3: no force-stop/cleanup for stale recordings | **Mostly fixed** | `/force-stop` route exists and CLI `editor:screen-recording:start --force` performs pre-cleanup |

## Evidence: What Is Now Implemented

### 1) Timeline playback CLI is implemented

- Command registration includes:
  - `editor:timeline:play`
  - `editor:timeline:pause`
  - `editor:timeline:toggle-play`
  - `editor:timeline:seek`
  - File: `electron/native-pipeline/cli/cli.ts`
- Timeline handler dispatches these actions:
  - File: `electron/native-pipeline/editor/editor-handlers-timeline.ts`
- HTTP route exists:
  - `POST /api/claude/timeline/:projectId/playback`
  - File: `electron/claude/http/claude-http-shared-routes.ts`
- Renderer bridge applies actions to playback store (`play/pause/toggle/seek`):
  - File: `apps/web/src/lib/claude-bridge/claude-timeline-bridge.ts`

### 2) Screen recording lifecycle is now centralized

- Main process maintains a singleton active session:
  - `getActiveSession()/setActiveSession()`
  - File: `electron/screen-recording-handler/session.ts`
- Start/append/stop IPC handlers use shared active session:
  - File: `electron/screen-recording-handler/ipc.ts`
- Explicit force-stop exists:
  - `forceStopActiveScreenRecordingSession()`
  - File: `electron/screen-recording-handler/ipc.ts`
- Utility HTTP exposes force-stop:
  - `POST /api/claude/screen-recording/force-stop`
  - File: `electron/utility/utility-http-server.ts`
- CLI uses pre-cleanup on start:
  - `editor:screen-recording:start --force`
  - File: `electron/native-pipeline/cli/cli-handlers-editor.ts`

## Residual Risk (Important)

This is an inferred risk from current control flow:

- Renderer-side `stopScreenRecording()` returns success when local `activeRecording` is null:
  - File: `apps/web/src/lib/project/screen-recording-controller.ts`
- Main-process stop request handler only force-stops on timeout/error, not on this “success with no active local recorder” case:
  - File: `electron/claude/handlers/claude-screen-recording-handler.ts`

Implication:

- If renderer local runtime state is lost while main-process session is still active, stop can return success but leave the main session alive (the same symptom family as the original failure).

## Test Verification Performed

Executed:

```bash
bunx vitest run \
  electron/__tests__/cli-timeline-playback-args.test.ts \
  electron/__tests__/editor-handlers-timeline-playback.test.ts
```

Result:

- 2 test files passed
- 8 tests passed
- Confirms playback command parsing and handler routing

## Remaining Gaps

1. No direct CLI command `editor:screen-recording:force-stop` (only API route + `start --force` pre-cleanup path).
2. No automated regression test for stale/orphan recording state across renderer desync/reload.

## Recommended Next Fixes

### P0

When renderer `stopScreenRecording()` has no local `activeRecording`, query main-process status and force-stop if status is still recording.

### P1

Add explicit CLI command:

- `editor:screen-recording:force-stop`

### P1

After `editor:screen-recording:stop`, verify with `status` that recording is false before returning final success in CLI flow.

### P2

Add end-to-end regression test that simulates stale-session conditions and validates recovery with stop/force-stop.

## File Map (Current)

| File | Why |
|---|---|
| `electron/screen-recording-handler/ipc.ts` | Main singleton session + stop/force-stop lifecycle |
| `electron/screen-recording-handler/session.ts` | Active session source of truth |
| `apps/web/src/lib/project/screen-recording-controller.ts` | Renderer runtime state and stop behavior |
| `electron/claude/handlers/claude-screen-recording-handler.ts` | Stop timeout fallback logic |
| `electron/native-pipeline/cli/cli.ts` | Playback and recording command surface |
| `electron/native-pipeline/editor/editor-handlers-timeline.ts` | Playback command dispatch |
| `electron/claude/http/claude-http-shared-routes.ts` | Playback HTTP endpoint |
| `apps/web/src/lib/claude-bridge/claude-timeline-bridge.ts` | Renderer playback action application |
