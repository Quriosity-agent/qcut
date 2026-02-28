# Operation Notification Bridge Real Test Guide

This guide explains how to run a real/manual test for the QCut -> Claude terminal notification bridge.

## Goal

Verify that meaningful user operations in QCut are forwarded as terminal context lines, and are not executed as commands.

## Scope

In scope:
- Bridge enable/disable/status/history APIs
- Notification delivery to PTY output
- Event filtering (meaningful events only)

Out of scope:
- Unit/integration tests (covered separately)
- Performance benchmarking

## Prerequisites

1. Repo is up to date and dependencies are installed.
2. QCut can be launched locally.
3. `curl` is available in terminal.

## Start QCut

```bash
cd /Users/peter/Desktop/code/qcut/qcut
bun run build
bun run electron
```

Confirm health:

```bash
curl -s http://127.0.0.1:8765/api/claude/health | jq
```

Expected: `success: true` and `data.status: "ok"`.

## Get a PTY Session ID (real session target)

Open QCut DevTools console and run:

```js
window.electronAPI.pty.spawn({ command: "bash -l" }).then((result) => {
  console.log("PTY spawn result:", result);
  window.__notificationSessionId = result.sessionId;
});
```

Then confirm:

```js
window.__notificationSessionId
```

Expected: non-empty value like `pty-...`.

Optional: watch PTY output in DevTools:

```js
window.electronAPI.pty.onData((data) => console.log("PTY_DATA:", data));
```

## Enable Bridge

From terminal:

```bash
SESSION_ID="<paste-session-id>"
curl -s -X POST http://127.0.0.1:8765/api/claude/notifications/enable \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\"}" | jq
```

Expected:
- `success: true`
- `data.enabled: true`
- `data.sessionId == SESSION_ID`

Verify status:

```bash
curl -s http://127.0.0.1:8765/api/claude/notifications/status | jq
```

## Real Action Tests (GUI + export path)

Perform each action in QCut UI and verify one matching `[QCut] ...` line appears in PTY output.

### Test A: Media Import
1. Import any media file.
2. Expected output contains: `User imported media file`.

### Test B: Timeline Add
1. Add a text element to timeline.
2. Expected output contains: `User added text element` or `User added ... element to timeline`.

### Test C: Timeline Update
1. Move or edit an existing timeline element.
2. Expected output contains: `User updated ... element on timeline`.

### Test D: Timeline Remove
1. Delete an element from timeline.
2. Expected output contains: `User removed ... element from timeline`.

### Test E: Project Settings Change
1. Change canvas/project settings (for example resolution/background/fps).
2. Expected output contains: `User changed project settings` or `User updated project settings`.

### Test F: Export Start/Complete
1. Start an export and let it finish.
2. Expected output contains both:
   - `User started export`
   - `Export completed` (or output path variant)

### Test G: Export Fail (optional but recommended)
1. Trigger a failing export (invalid output target or forced failure condition).
2. Expected output contains: `Export failed`.

## Filter/Noise Check

Perform high-frequency UI actions:
- scrub playhead
- change selection repeatedly

Expected:
- No noisy stream of playhead/selection notifications in PTY output.

## API Behavior Checks

### History endpoint

```bash
curl -s "http://127.0.0.1:8765/api/claude/notifications/history?limit=20" | jq
```

Expected:
- array of recent formatted notification strings
- recent entries from tests above are present

### Validation check (missing sessionId)

```bash
curl -s -X POST http://127.0.0.1:8765/api/claude/notifications/enable \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

Expected:
- HTTP 400
- error mentions missing `sessionId`

### Toggle endpoint check

```bash
curl -s -X POST http://127.0.0.1:8765/api/claude/notifications/toggle \
  -H "Content-Type: application/json" \
  -d "{\"enabled\":true,\"sessionId\":\"$SESSION_ID\"}" | jq

curl -s -X POST http://127.0.0.1:8765/api/claude/notifications/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}' | jq
```

Expected:
- first call enables
- second call disables

## Disable and Confirm Stop

```bash
curl -s -X POST http://127.0.0.1:8765/api/claude/notifications/disable | jq
curl -s http://127.0.0.1:8765/api/claude/notifications/status | jq
```

After disable, perform one more timeline/media action.

Expected:
- no new `[QCut]` line appears in PTY output.

## Pass Criteria

Pass if all are true:
1. Bridge can be enabled/disabled and status reflects it.
2. Whitelisted operations appear as single-line `[QCut]` notifications.
3. Non-whitelisted noisy events do not appear.
4. Notifications are visible as output/context only (not executed commands).
5. History endpoint returns recent entries.

## Evidence to Capture

- Screenshot or terminal capture of:
  - enable response
  - sample `[QCut]` lines for import/timeline/export
  - disable response + no-notification after disable
- Copy of `history` response JSON.
