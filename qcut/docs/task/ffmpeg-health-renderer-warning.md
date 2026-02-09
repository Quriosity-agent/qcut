# FFmpeg Health Check — Renderer-Side Warning

## Problem Statement

The backend FFmpeg health check (`verifyFFmpegBinary()`) runs at startup and detects if binaries are broken, but **nothing in the renderer consumes the result**. If FFmpeg is missing or non-executable, the user has no indication until they attempt an export — potentially after 30 minutes of editing.

## Current State

### What exists today (backend — complete)
- `electron/ffmpeg/utils.ts` — `verifyFFmpegBinary()` spawns `ffmpeg -version` + `ffprobe -version` at startup
- `electron/ffmpeg-handler.ts` — `"ffmpeg-health"` IPC handler returns cached `FFmpegHealthResult`
- `electron/preload.ts:1035` — `checkHealth()` bridge exposed to renderer
- `apps/web/src/types/electron.d.ts:325` — Type declaration for `checkHealth()`

### What's missing (renderer — not implemented)
- No component calls `window.electronAPI.ffmpeg.checkHealth()`
- No toast or banner shown when health check fails
- User discovers the problem only at export time

### Existing patterns to follow
- **`UpdateNotification`** (`apps/web/src/components/update-notification.tsx`) — mounts in `__root.tsx`, runs once on startup via `useEffect`, calls `window.electronAPI?.updates`, shows `toast.warning()` or persistent banner
- **Toast library** — `sonner` (`import { toast } from "sonner"`), supports `toast.warning()`, `toast.error()`, `toast.info()` with `description` and `duration` options
- **Root layout** (`apps/web/src/routes/__root.tsx:39`) — `<UpdateNotification />` renders alongside `<Toaster />` after `<Outlet />`

---

## Implementation Plan

**Estimated Total Time**: 15 minutes

---

### Subtask 1: Create `FFmpegHealthNotification` Component (10 min)

**Objective**: A root-level component that checks FFmpeg health once at startup and shows a warning toast if binaries are broken.

**File to create**: `apps/web/src/components/ffmpeg-health-notification.tsx`

**Pattern**: Follow `update-notification.tsx` exactly — mount in root, `useEffect` with empty deps, call IPC, show toast on failure.

**Behavior**:
1. On mount, check `window.electronAPI?.ffmpeg?.checkHealth`  — if not available (browser dev mode), return early silently
2. Call `checkHealth()` — returns `FFmpegHealthResult`
3. If `ffmpegOk && ffprobeOk` — do nothing (happy path, no UI)
4. If either is `false` — show `toast.warning()` with:
   - Title: `"Video export may not work"`
   - Description: specific message based on what failed (FFmpeg, FFprobe, or both)
   - Duration: `15_000` (15 seconds — long enough to read, auto-dismisses)
5. Component renders `null` — no persistent banner needed since this is a one-time startup check, not an ongoing state

**Why toast instead of persistent banner**: FFmpeg failure is a rare edge case (antivirus, corrupted install). A toast is non-intrusive — users who don't plan to export shouldn't be blocked by a permanent banner. The `UpdateNotification` uses a persistent banner because updates are actionable (restart button), but FFmpeg failure requires reinstalling the app, which is better communicated in the export error dialog.

**Relevant files for context**:
- `apps/web/src/components/update-notification.tsx` — same component pattern
- `apps/web/src/types/electron.d.ts:325` — `checkHealth()` type
- `electron/ffmpeg/types.ts:242-258` — `FFmpegHealthResult` interface

---

### Subtask 2: Mount Component in Root Layout (2 min)

**Objective**: Add `<FFmpegHealthNotification />` to the root layout so it runs once on app startup.

**File to modify**: `apps/web/src/routes/__root.tsx`

**Where**: After `<UpdateNotification />` (line 39) — both are startup-only background components.

**Changes**:
1. Add import: `import { FFmpegHealthNotification } from "@/components/ffmpeg-health-notification"`
2. Add `<FFmpegHealthNotification />` after `<UpdateNotification />` at line 39

**Why at root level instead of editor level**: The health check should run regardless of which route the user is on. If they navigate to the editor later, the check has already completed and the warning (if any) was already shown. Matches the `UpdateNotification` placement pattern.

---

### Subtask 3: Add Unit Test (3 min)

**Objective**: Test that the component handles the happy path (no warning) and failure path (shows toast).

**File to create**: `apps/web/src/test/lib-tests/ffmpeg-health-notification.test.ts`

**Test cases**:

| # | Test | What it verifies |
|---|------|-----------------|
| 1 | `does not show toast when both binaries are OK` | Mock `checkHealth()` returning `ffmpegOk: true, ffprobeOk: true` → no `toast.warning` call |
| 2 | `shows warning toast when FFmpeg is not OK` | Mock `checkHealth()` returning `ffmpegOk: false` → `toast.warning` called with "FFmpeg" in message |
| 3 | `does nothing when electronAPI is not available` | No `window.electronAPI` → no errors, no toast |

**Relevant files for context**:
- `apps/web/src/test/lib-tests/ffmpeg-health-check.test.ts` — existing test patterns
- `apps/web/src/components/ffmpeg-health-notification.tsx` — the component under test

---

## File Reference Summary

| File | Change | Lines |
|------|--------|-------|
| `apps/web/src/components/ffmpeg-health-notification.tsx` | New component — calls `checkHealth()` on mount, shows `toast.warning()` on failure | New file |
| `apps/web/src/routes/__root.tsx` | Import + mount `<FFmpegHealthNotification />` after `<UpdateNotification />` | Lines 7, 39 |
| `apps/web/src/test/lib-tests/ffmpeg-health-notification.test.ts` | Unit tests — 3 test cases | New file |
