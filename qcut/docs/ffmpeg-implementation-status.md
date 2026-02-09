# FFmpeg Implementation Status

> Last updated: 2026-02-09

## Overview

QCut uses **two separate FFmpeg implementations** that serve different purposes:

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Browser (renderer process) | `@ffmpeg/ffmpeg` WebAssembly | Thumbnails, previews, lightweight processing |
| Electron (main process) | FFmpeg CLI binary via `child_process.spawn()` | Video export, encoding, concat, filters |

Both must be present and functional for a full QCut experience.

## Status (Windows Client Issue)

**Yes, the Windows client issue is solved for the NSIS release path.**

The previous `FFmpeg and FFprobe binary not found or not executable` startup
problem has been fixed by:
- Packaging `ffmpeg-static` and `ffprobe-static` into
  `win-unpacked/resources/node_modules/...` via `build.extraResources`
- Adding packaged-runtime fallback resolution in `electron/ffmpeg/utils.ts`
- Adding a build gate (`verify:packaged-ffmpeg`) that runs after
  `dist:win:unsigned` and `dist:win:release`

Latest local validation (2026-02-09):
- `bun run dist:win:unsigned` passed
- Gate confirmed both binaries exist and `-version` executes successfully
- Verified paths:
  - `resources/node_modules/ffmpeg-static/ffmpeg.exe`
  - `resources/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe`

---

## Will FFmpeg Work After Installation?

**Windows NSIS installer: Yes (verified).**

For macOS/Linux, packaging still includes `ffmpeg-static`/`ffprobe-static`, but the new
automated packaged-binary execution gate currently validates Windows release flow.

---

## Architecture Details

### WASM Layer (All Platforms)

**Dependencies** (from `package.json`):
- `@ffmpeg/ffmpeg@0.12.15` — JavaScript API
- `@ffmpeg/core@0.12.10` — WebAssembly core
- `@ffmpeg/util@0.12.2` — Utilities

**Setup pipeline:**
1. `bun install` triggers `postinstall` → runs `scripts/setup-ffmpeg.ts`
2. Script copies `ffmpeg-core.js` + `ffmpeg-core.wasm` from `node_modules/@ffmpeg/core/dist/esm/` to:
   - `apps/web/public/ffmpeg/` (for dev server)
   - `electron/resources/ffmpeg/` (for Electron packaging)
3. `package.json` `asarUnpack` ensures `**/node_modules/@ffmpeg/**/*` and `**/electron/resources/**/*` are accessible at runtime

**Key files:**
- `apps/web/src/lib/ffmpeg-loader.ts` — Lazy-loads WASM module
- `apps/web/src/lib/ffmpeg-utils.ts` — WASM-based processing utilities
- `apps/web/src/hooks/use-async-ffmpeg.ts` — React hook

### CLI Layer (via `ffmpeg-static`)

**Dependencies** (from `package.json`):
- `ffmpeg-static@^5.3.0` — Statically linked FFmpeg binary (FFmpeg 6.1.1)
- `ffprobe-static@^3.1.0` — FFprobe binary for video probing (FFprobe 4.0.2)

**How it works:**
1. `bun install` downloads the platform-specific static binary into `node_modules/`
2. `electron-builder` includes packages in build `files` and `asarUnpack`
3. `electron-builder` also copies both packages into `resources/node_modules/` via `extraResources`
4. At runtime, QCut resolves binaries from `ffmpeg-static` and packaged fallbacks
5. Windows release build runs `verify:packaged-ffmpeg` and fails fast if binaries are missing or non-executable

**Path resolution** (`electron/ffmpeg/utils.ts`):

| Priority | Source | Environment |
|----------|--------|-------------|
| 1 | `ffmpeg-static` npm package | Dev + Packaged |
| 2 | `resources/node_modules/ffmpeg-static` / `ffprobe-static` | Packaged |
| 3 | `electron/resources/ffmpeg(.exe)` | Legacy fallback |
| 4 | System paths (WinGet, Homebrew, apt, etc.) | Dev only |
| 5 | System PATH | Dev only |

**Key files:**
- `electron/ffmpeg-handler.ts` — IPC handlers for all export modes
- `electron/ffmpeg/utils.ts` — Path resolution, progress parsing
- `electron/ffmpeg/types.ts` — TypeScript interfaces

### Build Configuration (`package.json`)

The `ffmpeg-static` and `ffprobe-static` binaries are included in packaged apps via:

```json
"files": [
  "node_modules/ffmpeg-static/**/*",
  "node_modules/ffprobe-static/**/*"
]
```

And unpacked from ASAR for execution:

```json
"asarUnpack": [
  "**/node_modules/ffmpeg-static/**/*",
  "**/node_modules/ffprobe-static/**/*"
]
```

And explicitly copied for packaged fallback resolution:

```json
"extraResources": [
  { "from": "node_modules/ffmpeg-static", "to": "node_modules/ffmpeg-static" },
  { "from": "node_modules/ffprobe-static", "to": "node_modules/ffprobe-static" }
]
```

Release gate:

```json
"dist:win:unsigned": "... && bun run verify:packaged-ffmpeg",
"dist:win:release": "... && bun run verify:packaged-ffmpeg",
"verify:packaged-ffmpeg": "bun scripts/verify-packaged-ffmpeg.ts"
```

---

## Current State of `electron/resources/`

| File | In Git | Purpose |
|------|--------|---------|
| `README.md` | Yes | Documents the ffmpeg-static setup |
| `ffmpeg/ffmpeg-core.js` | No (gitignored) | WASM — auto-copied by `setup-ffmpeg` |
| `ffmpeg/ffmpeg-core.wasm` | No (gitignored) | WASM — auto-copied by `setup-ffmpeg` |

DLL files have been removed. `ffmpeg-static` provides statically linked binaries
that don't require separate shared libraries.

---

## Summary

| Platform | WASM (Previews) | CLI (Export) | End-User Experience |
|----------|-----------------|-------------|---------------------|
| Windows .exe | Works | Works (verified + gated) | Full functionality |
| macOS .dmg | Works | Expected to work | Full functionality (expected) |
| Linux .AppImage/.deb | Works | Expected to work | Full functionality (expected) |
| Dev mode (any OS) | Works | Works (via `ffmpeg-static` or system fallback) | Full functionality |
