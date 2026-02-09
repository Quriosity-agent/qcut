# FFmpeg Binary Not Found on Client Computer

## Problem

After installing QCut via the NSIS installer (`.exe`), the app shows a warning toast on startup:

> **Video export may not work**
> FFmpeg and FFprobe binary not found or not executable. Try reinstalling QCut.

This means video export, normalization, and probing are all broken on the client machine.

## Screenshot

![FFmpeg error toast](../../Image_20260209231923_1904_4.png)

## Root Cause Analysis

QCut depends on `ffmpeg-static` and `ffprobe-static` npm packages which bundle platform-specific binaries. In packaged Electron apps, the binary resolution chain in `electron/ffmpeg/utils.ts` is:

1. **`ffmpeg-static` npm package** — path is rewritten from `app.asar` to `app.asar.unpacked`
2. **`process.resourcesPath`** — checks `resources/ffmpeg.exe` in the installed app directory
3. If neither found, throws an error

### Why it fails

| Step | What happens | Why it fails |
|------|-------------|--------------|
| 1. `require("ffmpeg-static")` | Returns a path inside `app.asar.unpacked/node_modules/ffmpeg-static/` | The binary may not be unpacked — `electron-builder` only unpacks paths listed in `asarUnpack` |
| 2. `process.resourcesPath` | Checks `<install-dir>/resources/ffmpeg.exe` | No step in the build copies the binary there |

### Relevant config

`package.json` build section:
```json
"asarUnpack": [
  "node_modules/ffmpeg-static/**",
  "node_modules/ffprobe-static/**",
  ...
]
```

This _should_ unpack the binaries, but the issue may be:
- The `asarUnpack` glob not matching the actual binary location
- The binary platform mismatch (e.g., wrong arch bundled)
- `ffmpeg-static` resolving to a path that doesn't survive the asar packing/unpacking

## What We've Done So Far

### v0.3.57 — Diagnostics (PR #116)

Added production-visible logging to diagnose the exact failure:

1. **Enhanced toast notification** (`ffmpeg-health-notification.tsx`)
   - Shows resolved paths and specific error messages
   - Duration increased from 15s to 30s

2. **Production logging** (`electron/ffmpeg/utils.ts`)
   - Replaced dev-only `debugLog()` with `console.log()` in `getFFmpegPath()` and `getFFprobePath()`
   - Every search step now appears in electron-log on client machines

3. **Tests** — Added coverage for single and dual binary failure scenarios

### Earlier — build:exe fix

Added `copy-ffmpeg` step to `build:exe` script, but this only affects `electron-packager` builds, not the `electron-builder` NSIS installer path.

## Next Steps

1. **Install v0.3.57 on client** — the enhanced toast and electron-log will show exactly which paths were checked and why they failed
2. **Check electron-log output** — look for `[FFmpeg]` prefixed lines showing the search chain
3. **Verify `app.asar.unpacked`** — on the client, check if `<install-dir>/resources/app.asar.unpacked/node_modules/ffmpeg-static/` contains the actual binary
4. **Potential fixes depending on diagnosis**:
   - If binary missing from `app.asar.unpacked`: fix `asarUnpack` glob pattern
   - If binary present but wrong platform/arch: fix `ffmpeg-static` package config
   - If path resolution wrong: fix the `app.asar` → `app.asar.unpacked` rewrite logic
   - Nuclear option: copy `ffmpeg.exe` directly into `resources/` during build via `afterPack` hook

## Key Files

| File | Purpose |
|------|---------|
| `electron/ffmpeg/utils.ts` | `getFFmpegPath()`, `getFFprobePath()`, `verifyFFmpegBinary()` |
| `apps/web/src/components/ffmpeg-health-notification.tsx` | Toast notification shown to user |
| `electron/main.ts` | Registers `ffmpeg:check-health` IPC handler |
| `package.json` | `build.asarUnpack` config, `build:exe` script |
| `scripts/copy-ffmpeg.ts` | Copies FFmpeg binaries (used by `electron-packager` path only) |
