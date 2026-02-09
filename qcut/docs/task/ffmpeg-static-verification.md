# FFmpeg-Static Runtime Verification for Production Release

## Problem Statement

QCut bundles `ffmpeg-static` (v5.3.0) and `ffprobe-static` (v3.1.0) as npm packages for video export. The current codebase has unit tests for path resolution and packaging config, but there is **no runtime verification** that the bundled binaries are actually executable in packaged builds. Failures only surface when users attempt their first export — potentially after 30 minutes of editing.

## Current State

### What exists today

| Layer | File | What it verifies |
|-------|------|-----------------|
| Path resolution | `electron/ffmpeg/utils.ts:83-134` | `getFFmpegPath()` — 5-step fallback chain: ffmpeg-static → legacy resources → dev bundled → system paths → PATH |
| Path resolution | `electron/ffmpeg/utils.ts:268-296` | `getFFprobePath()` — ffprobe-static → same dir as ffmpeg → system PATH |
| Unit tests | `apps/web/src/test/lib-tests/ffmpeg-path-resolution.test.ts` | Binary exists on disk, `asarUnpack` config correct, `files` config correct, legacy DLL cleanup, production + trusted dependencies |
| Copy script | `scripts/copy-ffmpeg.ts` | Validates binary existence for electron-packager builds, exits code 1 if missing |
| Error capture | `electron/ffmpeg-handler.ts` | Every `spawn()` captures stderr/stdout/exit code and returns to renderer |
| Debug logging | `electron/ffmpeg/utils.ts:40-62` | `debugLog/debugWarn/debugError` — dev-only (`NODE_ENV !== "production"`) |

### What's missing

- **No startup health check** — failures only surface when user tries to export
- **No binary execution test** — `existsSync()` doesn't catch permission issues or corrupted binaries
- **No version logging in production** — `debugLog` is gated behind `NODE_ENV !== "production"`, so packaged builds have zero FFmpeg diagnostics
- **Inconsistent ffprobe resolution** — `main.ts:1145-1151` manually derives ffprobe path from `getFFmpegPath()` instead of using `getFFprobePath()`, which could resolve to a different location in packaged builds

### Known risk: `validate-audio-file` handler inconsistency

In `electron/main.ts:1138-1242`, the `"validate-audio-file"` IPC handler derives the ffprobe path by:
```
getFFmpegPath() → dirname → join("ffprobe.exe")
```
This assumes ffprobe is in the **same directory** as ffmpeg. But `ffprobe-static` is a separate npm package with its own `node_modules/` path. In packaged builds with `asarUnpack`, ffmpeg-static and ffprobe-static unpack to **different** directories. This handler should use `getFFprobePath()` from `electron/ffmpeg/utils.ts:268` instead.

---

## Implementation Plan

**Estimated Total Time**: 25-30 minutes

---

### Subtask 1: Add `verifyFFmpegBinary()` Health Check Function (10 min)

**Objective**: Verify FFmpeg and FFprobe are executable by spawning `ffmpeg -version`, cache result for the app lifetime.

**File to modify**: `electron/ffmpeg/utils.ts`

**Where to add**: After `getFFprobePath()` (after line 296), before the `parseProgress()` section.

**New type** (add to `electron/ffmpeg/types.ts`):
```typescript
export interface FFmpegHealthResult {
  ffmpegOk: boolean;
  ffprobeOk: boolean;
  ffmpegVersion: string;
  ffprobeVersion: string;
  ffmpegPath: string;
  ffprobePath: string;
  errors: string[];
}
```

**New function `verifyFFmpegBinary()`**:
- Call `getFFmpegPath()` and `getFFprobePath()` to resolve paths
- Spawn `ffmpeg -version` with a 5-second timeout via `setTimeout` + `kill()` (same pattern used in `probeVideoFile()` at line 359-362)
- Parse first line of stdout for version string (format: `ffmpeg version N.N.N ...`)
- Repeat for `ffprobe -version`
- Return `FFmpegHealthResult` with both statuses, versions, resolved paths, and any error messages
- Use `console.log` (not `debugLog`) so output appears in production builds
- Log with `[FFmpeg Health]` prefix for easy filtering in DevTools

**Why at this location**: Keeps all FFmpeg utility functions together. The function uses `getFFmpegPath()` and `getFFprobePath()` which are defined immediately above, and follows the same spawn + timeout pattern as `probeVideoFile()` at line 338.

---

### Subtask 2: Wire Health Check into Startup + IPC (10 min)

**Objective**: Run verification at app launch (async, non-blocking), expose result to renderer via IPC.

**Files to modify**:

**`electron/ffmpeg-handler.ts`** (inside `setupFFmpegIPC()`, after the `"ffmpeg-path"` handler at line 72):
- Add module-level `let healthResult: FFmpegHealthResult | null = null`
- Add new IPC handler `"ffmpeg-health"`:
  - If `healthResult` is cached, return it immediately
  - Otherwise run `verifyFFmpegBinary()`, cache, and return
- Add `initFFmpegHealthCheck()` export that runs `verifyFFmpegBinary()` and caches the result

**`electron/main.ts`** (after `setupFFmpegIPC()` at line 505):
- Import and call `initFFmpegHealthCheck()` with `.catch()` — fire-and-forget, non-blocking
- This ensures the health check runs early but doesn't delay window creation

**`electron/preload.ts`** (inside the `ffmpeg` object, after `getPath` at line 1034):
- Add `checkHealth: (): Promise<FFmpegHealthResult> => ipcRenderer.invoke("ffmpeg-health")`

**`apps/web/src/types/electron.d.ts`** (inside the `ffmpeg` type, after `getPath` at line 323):
- Add `checkHealth: () => Promise<FFmpegHealthResult>` type declaration

**Also fix**: Update `main.ts:1145-1151` to use `getFFprobePath()` instead of manually deriving the path from `getFFmpegPath()`. Import it from `"./ffmpeg-handler.js"` (it's already re-exported there at line 1258).

---

### Subtask 3: Add Unit Tests for Health Check (5-10 min)

**Objective**: Test the verification function runs correctly in the dev environment.

**File to create**: `apps/web/src/test/lib-tests/ffmpeg-health-check.test.ts`

**Follow the existing pattern** from `ffmpeg-path-resolution.test.ts`:
- Uses `vitest` (`describe`, `it`, `expect`)
- Uses `require("ffmpeg-static")` for path resolution
- Uses `existsSync` for file checks

**Test cases**:

| # | Test | What it verifies |
|---|------|-----------------|
| 1 | `ffmpeg -version returns exit code 0` | Spawn ffmpeg binary, check exit code is 0 |
| 2 | `ffmpeg version string is parseable` | stdout first line matches `ffmpeg version \d+\.\d+` |
| 3 | `ffprobe -version returns exit code 0` | Spawn ffprobe binary, check exit code is 0 |
| 4 | `ffprobe version string is parseable` | stdout first line matches `ffprobe version \d+\.\d+` |
| 5 | `spawn completes within 5 seconds` | Timeout test — the spawn + parse should finish quickly |

**Why these tests matter**: They run in CI (`bun run test`) and verify the actual binaries are functional, not just present on disk. This catches corrupted downloads from `ffmpeg-static` postinstall.

---

## Manual Pre-Release Checklist

Run these checks on the packaged EXE before shipping:

| # | Check | How to Verify |
|---|-------|---------------|
| 1 | Binary in build | `app.asar.unpacked/node_modules/ffmpeg-static/` contains `ffmpeg.exe` (~100MB) |
| 2 | Health check log | Launch app → DevTools Console → look for `[FFmpeg Health]` with version string |
| 3 | Mode 1 export | Import 2 clips → export → valid MP4 produced |
| 4 | Mode 1.5 export | Import clips with different resolutions → export → normalized + concat |
| 5 | Mode 2 export | Add text overlay → export → text visible in output |
| 6 | Clean machine | Test on machine with no system FFmpeg installed |
| 7 | Path with spaces | Run from `C:\Users\Test User\Desktop\QCut\` |
| 8 | Antivirus | Verify Windows Defender doesn't quarantine the binary |

---

## Architecture Decision

**Why startup verification over lazy verification?**

- **Early failure detection**: Users see a warning immediately, not after 30 minutes of editing
- **Non-blocking**: `initFFmpegHealthCheck()` runs async after `setupFFmpegIPC()`, doesn't delay window creation
- **Cached result**: IPC handler returns cached result instantly after first check
- **Extensible pattern**: Same approach applies to future binary dependencies (yt-dlp, etc.)
- **Production visibility**: Uses `console.log` directly (not `debugLog`) so logs appear in packaged builds via `electron-log`

**Why no E2E test?**

- E2E tests run against `electron:dev` (dev mode), which loads binaries from `node_modules/` directly — same environment as unit tests
- E2E can't run in GitHub CI (no Electron display)
- The actual risk (ASAR unpack, permissions, antivirus) can only be caught by the startup health check running on the user's machine or the manual checklist on the packaged EXE
- Two automated layers (unit tests in CI + runtime health check in production) plus the manual checklist provides sufficient coverage

---

## File Reference Summary

| File | Change | Lines |
|------|--------|-------|
| `electron/ffmpeg/types.ts` | Add `FFmpegHealthResult` interface | After line 241 |
| `electron/ffmpeg/utils.ts` | Add `verifyFFmpegBinary()` function | After line 296 |
| `electron/ffmpeg-handler.ts` | Add `"ffmpeg-health"` IPC handler + `initFFmpegHealthCheck()` export | After line 72, export at line 1258 |
| `electron/main.ts` | Call `initFFmpegHealthCheck()` at startup; fix ffprobe resolution in `validate-audio-file` | Line 505, lines 1145-1151 |
| `electron/preload.ts` | Add `checkHealth` to ffmpeg bridge | After line 1034 |
| `apps/web/src/types/electron.d.ts` | Add `checkHealth` type | After line 323 |
| `apps/web/src/test/lib-tests/ffmpeg-health-check.test.ts` | New test file — 5 test cases | New file |
