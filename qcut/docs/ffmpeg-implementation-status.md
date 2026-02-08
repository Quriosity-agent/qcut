# FFmpeg Implementation Status

> Last updated: 2026-02-08

## Overview

QCut uses **two separate FFmpeg implementations** that serve different purposes:

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Browser (renderer process) | `@ffmpeg/ffmpeg` WebAssembly | Thumbnails, previews, lightweight processing |
| Electron (main process) | FFmpeg CLI binary via `child_process.spawn()` | Video export, encoding, concat, filters |

Both must be present and functional for a full QCut experience.

---

## Will FFmpeg Work After Installation?

### Windows (.exe installer) — Partially

| Component | Status | Notes |
|-----------|--------|-------|
| WASM (`@ffmpeg/ffmpeg`) | Works | Bundled via `asarUnpack` and `setup-ffmpeg` script |
| CLI binary (`ffmpeg.exe`) | **May not work** | Must be manually placed before build (see below) |
| FFmpeg DLLs | Works | `avcodec-62.dll`, `avformat-62.dll`, etc. are committed to git and copied via `extraResources` |

**The critical issue:** `ffmpeg.exe` is **gitignored** and is NOT included in the repository. The developer building the installer must manually download it into `electron/resources/ffmpeg.exe` before running the build. If they forget, the packaged app will **throw an error** when attempting any video export:

```
Error: FFmpeg not found at: C:\...\resources\ffmpeg.exe
```

The DLL dependencies (avcodec, avformat, avfilter, avutil, swresample, swscale) **are** committed and will be bundled correctly.

### macOS (.dmg) — Likely Broken

| Component | Status | Notes |
|-----------|--------|-------|
| WASM (`@ffmpeg/ffmpeg`) | Works | Same bundling as Windows |
| CLI binary (`ffmpeg`) | **Not bundled** | No macOS binary in repo, no `.dylib` files present |

The `extraResources` filter only copies `*.exe`, `*.dll`, `*.dylib`, and `*.so` files from `electron/resources/`. Currently there are **no macOS binaries** (no `ffmpeg` binary, no `.dylib` files) in that directory. The packaged macOS app will fail the same way:

```
Error: FFmpeg not found at: /Applications/QCut.app/Contents/Resources/ffmpeg
```

In development mode, macOS users get a fallback to system-installed FFmpeg (Homebrew, MacPorts), but this fallback is **intentionally disabled** in packaged builds — the code throws immediately if the binary isn't found.

### Linux (.AppImage / .deb) — Likely Broken

Same situation as macOS. No Linux `ffmpeg` binary or `.so` files are present in `electron/resources/`. Packaged Linux builds will fail for CLI-based exports.

---

## Architecture Details

### WASM Layer (Works on All Platforms)

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

### CLI Layer (Requires Manual Setup)

**Path resolution** (`electron/ffmpeg/utils.ts:83-135`):

```
if (app.isPackaged) {
  // Production: ONLY looks at process.resourcesPath + "/ffmpeg.exe"
  // Throws error if not found — NO fallback to system FFmpeg
} else {
  // Development fallback chain:
  // 1. electron/resources/ffmpeg.exe (bundled dev binary)
  // 2. System paths (WinGet, Chocolatey, Scoop, Homebrew, apt, etc.)
  // 3. System PATH environment variable
}
```

**System path search** (dev mode only):

| Platform | Paths Searched |
|----------|---------------|
| Windows | WinGet packages, `C:\ProgramData\chocolatey\bin\ffmpeg.exe`, `~/scoop/shims/ffmpeg.exe` |
| macOS | `/opt/homebrew/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, `/opt/local/bin/ffmpeg` |
| Linux | `/usr/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, `/snap/bin/ffmpeg`, `~/.local/bin/ffmpeg` |

**Key files:**
- `electron/ffmpeg-handler.ts` (1262 lines) — IPC handlers for all export modes
- `electron/ffmpeg/utils.ts` (712 lines) — Path resolution, progress parsing
- `electron/ffmpeg/types.ts` — TypeScript interfaces

### Build Configuration (`package.json`)

```json
"extraResources": [
  {
    "from": "electron/resources/",
    "to": "./",
    "filter": ["**/*.exe", "**/*.dll", "**/*.dylib", "**/*.so", "!**/ffmpeg/**"]
  }
]
```

Note: the `!**/ffmpeg/**` exclusion prevents the WASM subdirectory (`electron/resources/ffmpeg/`) from being copied as an extra resource — WASM is handled separately via `asarUnpack`.

---

## Current State of `electron/resources/`

| File | In Git | Purpose |
|------|--------|---------|
| `README.md` | Yes | Download instructions for ffmpeg.exe |
| `avcodec-62.dll` | Yes | FFmpeg shared library |
| `avdevice-62.dll` | Yes | FFmpeg shared library |
| `avfilter-11.dll` | Yes | FFmpeg shared library |
| `avformat-62.dll` | Yes | FFmpeg shared library |
| `avutil-60.dll` | Yes | FFmpeg shared library |
| `swresample-6.dll` | Yes | FFmpeg shared library |
| `swscale-9.dll` | Yes | FFmpeg shared library |
| `ffmpeg.exe` | **No** (gitignored) | CLI binary — must be downloaded manually |
| `ffmpeg/ffmpeg-core.js` | **No** (gitignored) | WASM — auto-copied by `setup-ffmpeg` |
| `ffmpeg/ffmpeg-core.wasm` | **No** (gitignored) | WASM — auto-copied by `setup-ffmpeg` |

---

## Recommendations

### Short-Term (Make Builds Work)

1. **Document the manual step clearly**: Before building, developers must download `ffmpeg.exe` (and `ffprobe.exe`) from https://ffmpeg.org/download.html and place them in `electron/resources/`.
2. **Add a pre-build validation script** that checks for `ffmpeg.exe` and fails early with a clear message instead of producing a broken installer.
3. **For macOS builds**: Download the macOS FFmpeg binary and place it in `electron/resources/` before building on macOS.

### Long-Term (Automate)

1. **Auto-download script**: Create a `scripts/download-ffmpeg.ts` that fetches the correct platform binary (like `ffmpeg-static` or BtbN builds) as a build step.
2. **Platform-aware `extraResources`**: Use electron-builder's per-platform `extraResources` config so Windows builds only include `.exe`/`.dll` and macOS builds only include the macOS binary.
3. **CI/CD integration**: Add the FFmpeg download step to the CI workflow so automated builds always include the binary.
4. **Consider `ffmpeg-static` npm package**: This provides pre-built FFmpeg binaries for all platforms as an npm dependency, removing the manual download step entirely.

---

## Summary

> **Updated 2026-02-08**: Migrated to `ffmpeg-static` + `ffprobe-static` npm packages.
> All platforms now ship with FFmpeg automatically via `bun install` + `asarUnpack`.

| Platform | WASM (Previews) | CLI (Export) | End-User Experience |
|----------|-----------------|-------------|---------------------|
| Windows .exe | Works | Works (via `ffmpeg-static`) | Full functionality |
| macOS .dmg | Works | Works (via `ffmpeg-static`) | Full functionality |
| Linux .AppImage/.deb | Works | Works (via `ffmpeg-static`) | Full functionality |
| Dev mode (any OS) | Works | Works (via `ffmpeg-static` or system fallback) | Full functionality |
