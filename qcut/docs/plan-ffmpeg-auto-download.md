# Plan: Automated FFmpeg via `ffmpeg-static` npm Package

> Created: 2026-02-08 | Branch: `long-term-support`
> Priority: Long-term maintainability > scalability > performance > short-term gains

## Problem Statement

QCut's video export requires the FFmpeg CLI binary (`ffmpeg.exe` / `ffmpeg` / `ffprobe`), but:

1. `ffmpeg.exe` is **gitignored** and must be manually downloaded before building
2. **macOS and Linux have no binaries at all** in the repo — packaged builds crash on export
3. The CI release workflow (`release.yml`) has **no FFmpeg download step**, so every automated release ships a broken export
4. 7 Windows DLLs (~50MB+) are committed to git, bloating the repo

**Goal**: Automatically provide the correct FFmpeg binary for each platform during install/build, so every packaged app (Windows .exe, macOS .dmg, Linux .AppImage/.deb) ships with a working FFmpeg — with zero manual steps.

---

## Chosen Approach: `ffmpeg-static` + `ffprobe-static` npm Packages

| Approach | Pros | Cons |
|----------|------|------|
| **`ffmpeg-static` npm pkg** | **Zero-config, auto per-platform download on `npm install`, well-maintained (537 dependents), covers Win/Mac/Linux/ARM, FFmpeg 6.1.1 statically linked (no DLLs needed)** | **Must clear node_modules when cross-building; ~80MB download per platform** |
| Custom download script (BtbN) | Full control, CI-cacheable | Must maintain URLs, macOS not available from BtbN, more code to maintain |
| `ffmpeg-static-electron` | electron-builder macros | Less maintained, smaller community |

**Decision**: Use [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static) (v5.3.0, FFmpeg 6.1.1) and [`ffprobe-static`](https://www.npmjs.com/package/ffprobe-static) as npm dependencies.

**Why this is the long-term choice**:

1. **Statically linked** — single binary per platform, **no DLLs/dylibs/SOs needed**. This eliminates the 7 committed DLLs entirely.
2. **Auto-download on install** — `bun install` fetches the correct platform binary. No manual steps, no custom scripts.
3. **All platforms covered** — Windows x64/x86, macOS Intel + Apple Silicon, Linux x64/ARM64/ARMv7.
4. **Community maintained** — 537 npm dependents, active repo, binaries sourced from trusted builders (Gyan for Windows, John Van Sickle for Linux, osxexperts for macOS).
5. **Electron-compatible** — well-documented `asarUnpack` pattern, widely used in Electron apps.
6. **CI-friendly** — Each CI runner (windows-latest, macos-latest, ubuntu-latest) gets the correct binary automatically via `bun install`.

---

## Subtasks

### Subtask 1: Install `ffmpeg-static` and `ffprobe-static`

**Estimated time**: ~5 min
**Relevant files**:
- `package.json:1-15` (dependencies section)

**Commands**:
```bash
bun add ffmpeg-static ffprobe-static
```

This adds both as production dependencies. On install, each package downloads the platform-specific static binary into its own `node_modules` directory.

**After install, verify**:
```bash
node -e "console.log(require('ffmpeg-static'))"
# → C:\Users\...\node_modules\ffmpeg-static\ffmpeg.exe

node -e "console.log(require('ffprobe-static').path)"
# → C:\Users\...\node_modules\ffprobe-static\bin\win32\x64\ffprobe.exe
```

---

### Subtask 2: Update `electron-builder` Config (`asarUnpack`)

**Estimated time**: ~10 min
**Relevant files**:
- `package.json:173-182` (build.asarUnpack section)
- `package.json:145-156` (build.extraResources section)

**Problem**: Electron packages `node_modules` into an ASAR archive. Binaries inside ASAR can't be executed by `child_process.spawn()`. We must unpack `ffmpeg-static` and `ffprobe-static` so the binaries live on disk.

**Changes to `asarUnpack`**:
```jsonc
"asarUnpack": [
  "**/node_modules/sharp/**/*",
  "**/node_modules/@ffmpeg/**/*",           // existing — WASM layer
  "**/node_modules/ffmpeg-static/**/*",     // NEW — CLI binary
  "**/node_modules/ffprobe-static/**/*",    // NEW — probe binary
  "**/node_modules/electron-updater/**/*",
  "**/node_modules/electron-log/**/*",
  "**/node_modules/@google/generative-ai/**/*",
  "**/node_modules/node-pty/**/*",
  "**/electron/resources/**/*"
]
```

**Changes to `extraResources`** — Remove the FFmpeg binary filter since binaries now come from node_modules, not `electron/resources/`:
```jsonc
"extraResources": [
  {
    "from": "electron/resources/",
    "to": "./",
    "filter": [
      "!**/ffmpeg/**",
      "!**/*.exe",
      "!**/*.dll"
    ]
  },
  // ... keep default-skills, generative-ai, node-pty entries unchanged
]
```

**Runtime path**: In the packaged app, the binary will be at:
```
<app>/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe  (Windows)
<app>/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg      (macOS/Linux)
```

---

### Subtask 3: Rewrite `electron/ffmpeg/utils.ts` Path Resolution

**Estimated time**: ~15 min
**Relevant files**:
- `electron/ffmpeg/utils.ts:83-135` (`getFFmpegPath()`)
- `electron/ffmpeg/utils.ts:265-276` (`getFFprobePath()`)

**Current behavior**: Looks for binary in `electron/resources/` (dev) or `process.resourcesPath` (packaged), with system PATH fallback.

**New behavior**: Use `require('ffmpeg-static')` as the primary source, with `app.asar` → `app.asar.unpacked` replacement for packaged apps.

**New `getFFmpegPath()` implementation**:

```typescript
import { app } from "electron";
import path from "path";
import fs from "fs";

export function getFFmpegPath(): string {
  // 1. Try ffmpeg-static package (primary — works dev & packaged)
  try {
    // require('ffmpeg-static') returns the absolute path to the binary
    let ffmpegPath: string = require("ffmpeg-static");

    // In packaged Electron apps, the path points inside app.asar
    // which can't be executed. Replace with the unpacked path.
    if (app.isPackaged) {
      ffmpegPath = ffmpegPath.replace("app.asar", "app.asar.unpacked");
    }

    if (fs.existsSync(ffmpegPath)) {
      debugLog("Found ffmpeg-static:", ffmpegPath);
      return ffmpegPath;
    }
  } catch {
    debugLog("ffmpeg-static package not found, falling back");
  }

  // 2. Fallback: legacy electron/resources/ path (backwards compat)
  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  if (app.isPackaged) {
    const resourcePath = path.join(process.resourcesPath, binaryName);
    if (fs.existsSync(resourcePath)) {
      return resourcePath;
    }
    throw new Error(
      `FFmpeg not found. Install ffmpeg-static: bun add ffmpeg-static`
    );
  }

  // 3. Development fallback: bundled resources → system paths → PATH
  const devPath = path.join(__dirname, "..", "resources", binaryName);
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  const systemPaths = getSystemFFmpegPaths(process.platform, binaryName);
  for (const searchPath of systemPaths) {
    if (fs.existsSync(searchPath)) {
      return searchPath;
    }
  }

  // Last resort: system PATH
  return binaryName;
}
```

**New `getFFprobePath()` implementation**:

```typescript
export function getFFprobePath(): string {
  // 1. Try ffprobe-static package
  try {
    let ffprobePath: string = require("ffprobe-static").path;

    if (app.isPackaged) {
      ffprobePath = ffprobePath.replace("app.asar", "app.asar.unpacked");
    }

    if (fs.existsSync(ffprobePath)) {
      return ffprobePath;
    }
  } catch {
    debugLog("ffprobe-static package not found, falling back");
  }

  // 2. Fallback: same directory as ffmpeg
  const ffmpegPath = getFFmpegPath();
  const ffmpegDir = path.dirname(ffmpegPath);
  const ffprobeExe = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";

  if (ffmpegPath === "ffmpeg" || ffmpegPath === "ffmpeg.exe") {
    return "ffprobe";
  }

  return path.join(ffmpegDir, ffprobeExe);
}
```

**Key**: The `getSystemFFmpegPaths()` helper and all existing platform-specific search logic is preserved as a fallback for development mode.

---

### Subtask 4: Remove Committed DLLs and Legacy Binary References

**Estimated time**: ~5 min
**Relevant files**:
- `electron/resources/*.dll` (7 files to remove from git tracking)
- `.gitignore:99-102` (update patterns)

**Why**: `ffmpeg-static` is **statically linked** — all codec libraries are compiled into the single binary. The 7 separate DLLs (avcodec, avformat, avfilter, avutil, avdevice, swresample, swscale) are no longer needed.

**Steps**:

1. Remove DLLs from git tracking:
```bash
git rm --cached electron/resources/avcodec-62.dll
git rm --cached electron/resources/avdevice-62.dll
git rm --cached electron/resources/avfilter-11.dll
git rm --cached electron/resources/avformat-62.dll
git rm --cached electron/resources/avutil-60.dll
git rm --cached electron/resources/swresample-6.dll
git rm --cached electron/resources/swscale-9.dll
```

2. Update `.gitignore`:
```gitignore
# FFmpeg binaries (provided by ffmpeg-static/ffprobe-static npm packages)
/electron/resources/ffmpeg
/electron/resources/ffmpeg.exe
/electron/resources/ffprobe
/electron/resources/ffprobe.exe
/electron/resources/*.dll
/electron/resources/*.dylib
/electron/resources/*.so*
```

---

### Subtask 5: Simplify Build Scripts

**Estimated time**: ~10 min
**Relevant files**:
- `package.json:45-70` (scripts section)
- `scripts/copy-ffmpeg.ts` (can be removed or simplified)

**Changes**:

Since `ffmpeg-static` downloads the binary during `bun install`, and `electron-builder` bundles it via `asarUnpack`, the manual copy scripts become unnecessary.

```jsonc
{
  "scripts": {
    // REMOVE or deprecate:
    // "copy-ffmpeg": "bun scripts/copy-ffmpeg.ts"    ← no longer needed

    // KEEP unchanged:
    "postinstall": "bun run setup-ffmpeg && bun scripts/patch-node-pty.ts",
    "setup-ffmpeg": "bun scripts/setup-ffmpeg.ts",   // still needed for WASM layer
    "predev": "bun run setup-ffmpeg",

    // SIMPLIFIED (no download-ffmpeg step needed):
    "prebuild": "bun run setup-ffmpeg && bun run sync-skills",

    // package:win no longer needs copy-ffmpeg step
    "package:win": "electron-packager . QCut --platform=win32 --arch=x64 --out=dist-packager-new --overwrite --ignore=\"dist-packager.*\" --ignore=\"dist-electron.*\""
  }
}
```

**`scripts/copy-ffmpeg.ts`**: Delete or keep as legacy with a deprecation notice. The `electron-builder` flow no longer needs it. The `electron-packager` flow (if still used) would need an updated version — see Subtask 5b below.

**Subtask 5b** (only if `electron-packager` is still used alongside `electron-builder`):

Update `scripts/copy-ffmpeg.ts` to copy from `node_modules/ffmpeg-static/` instead of `electron/resources/`:

```typescript
const ffmpegSource = require.resolve("ffmpeg-static");
const ffprobeSource = require("ffprobe-static").path;
// Copy these two files to the packager output directory
```

---

### Subtask 6: Update CI Release Workflow

**Estimated time**: ~5 min
**Relevant files**:
- `.github/workflows/release.yml:44-170` (build jobs)

**The key advantage**: No changes needed for the basic flow. `bun install` already downloads the correct FFmpeg binary for each CI runner's platform. Each runner (windows-latest, macos-latest, ubuntu-latest) automatically gets the right binary.

**Optional optimization** — cache the `ffmpeg-static` binary to avoid re-downloading:

```yaml
# Add to each build job, after checkout and before bun install:
- name: Cache ffmpeg-static binary
  uses: actions/cache@v4
  with:
    path: |
      node_modules/ffmpeg-static/ffmpeg*
      node_modules/ffprobe-static/bin
    key: ffmpeg-static-${{ runner.os }}-${{ hashFiles('bun.lock') }}
```

**No other changes required** to the Windows, macOS, or Linux build jobs. The existing `bun install` → `bun run build` → `electron-builder` pipeline now works because:
1. `bun install` downloads `ffmpeg-static` binary for the runner's platform
2. `electron-builder` sees `asarUnpack` config and puts the binary outside ASAR
3. `getFFmpegPath()` resolves it at runtime via `require('ffmpeg-static')` + `.replace('app.asar', 'app.asar.unpacked')`

---

### Subtask 7: Write Unit Tests

**Estimated time**: ~15 min
**Relevant files**:
- `apps/web/src/test/lib-tests/ffmpeg-path-resolution.test.ts` (new)

**Test cases**:

```typescript
// ffmpeg-path-resolution.test.ts
import { describe, it, expect, vi } from "vitest";

describe("FFmpeg path resolution", () => {
  describe("getFFmpegPath", () => {
    it("returns ffmpeg-static path in development mode", () => {
      // Mock app.isPackaged = false
      // Verify require('ffmpeg-static') path is returned
    });

    it("replaces app.asar with app.asar.unpacked in packaged mode", () => {
      // Mock app.isPackaged = true
      // Mock require('ffmpeg-static') → '/path/to/app.asar/node_modules/ffmpeg-static/ffmpeg'
      // Verify output contains 'app.asar.unpacked'
    });

    it("falls back to system paths when ffmpeg-static not installed", () => {
      // Mock require('ffmpeg-static') to throw
      // Verify system path search runs
    });

    it("falls back to system PATH as last resort", () => {
      // Mock all paths as non-existent
      // Verify returns 'ffmpeg' or 'ffmpeg.exe'
    });
  });

  describe("getFFprobePath", () => {
    it("returns ffprobe-static path in development mode", () => {
      // Mock require('ffprobe-static').path
    });

    it("replaces app.asar with app.asar.unpacked in packaged mode", () => {
      // Same asar replacement logic as ffmpeg
    });

    it("falls back to same directory as ffmpeg", () => {
      // When ffprobe-static not installed, derive from ffmpeg path
    });
  });

  describe("asarUnpack integration", () => {
    it("ffmpeg-static is listed in asarUnpack config", () => {
      // Read package.json, verify asarUnpack includes ffmpeg-static
      const pkg = require("../../../../../../package.json");
      expect(pkg.build.asarUnpack).toContain(
        "**/node_modules/ffmpeg-static/**/*"
      );
    });

    it("ffprobe-static is listed in asarUnpack config", () => {
      const pkg = require("../../../../../../package.json");
      expect(pkg.build.asarUnpack).toContain(
        "**/node_modules/ffprobe-static/**/*"
      );
    });
  });
});
```

---

### Subtask 8: Update Documentation

**Estimated time**: ~5 min
**Relevant files**:
- `electron/resources/README.md` (simplify — manual download no longer needed)
- `docs/ffmpeg-implementation-status.md` (update status to reflect all platforms working)
- `CLAUDE.md` (no new commands needed — `bun install` handles everything)

**Changes**:

1. **`electron/resources/README.md`** — Replace with:
```markdown
# FFmpeg Resources

## CLI Binary
FFmpeg CLI binaries are provided by the `ffmpeg-static` and `ffprobe-static`
npm packages. They are downloaded automatically during `bun install`.

Manual download is no longer required.

## WebAssembly Files
WASM files (`ffmpeg-core.js`, `ffmpeg-core.wasm`) are copied from
`@ffmpeg/core` by `scripts/setup-ffmpeg.ts` during postinstall.

## Legacy
The DLL files previously committed here have been removed. `ffmpeg-static`
provides statically linked binaries that don't require separate shared libraries.
```

2. **`docs/ffmpeg-implementation-status.md`** — Update Summary table:

| Platform | WASM (Previews) | CLI (Export) | End-User Experience |
|----------|-----------------|-------------|---------------------|
| Windows .exe | Works | Works (via `ffmpeg-static`) | Full functionality |
| macOS .dmg | Works | Works (via `ffmpeg-static`) | Full functionality |
| Linux .AppImage/.deb | Works | Works (via `ffmpeg-static`) | Full functionality |
| Dev mode (any OS) | Works | Works (via `ffmpeg-static` or system fallback) | Full functionality |

---

## Implementation Order & Dependencies

```
Subtask 1 (install packages)
    ↓
Subtask 2 (asarUnpack config)     ← depends on Subtask 1
    ↓
Subtask 3 (rewrite path resolution) ← depends on Subtask 1
    ↓
Subtask 4 (remove DLLs from git)  ← independent, but do after Subtask 3 confirmed working
    ↓
Subtask 5 (simplify build scripts) ← depends on Subtasks 2 + 3
    ↓
Subtask 6 (CI workflow caching)   ← depends on Subtask 1
    ↓
Subtask 7 (unit tests)            ← depends on Subtask 3
    ↓
Subtask 8 (documentation)         ← last, after everything works
```

**Total estimated time**: ~70 minutes

---

## Verification Checklist

After implementation, verify:

- [ ] `bun install` downloads `ffmpeg-static` binary for current platform
- [ ] `node -e "console.log(require('ffmpeg-static'))"` prints a valid path
- [ ] `node -e "console.log(require('ffprobe-static').path)"` prints a valid path
- [ ] `bun run electron:dev` — video export works (dev mode, uses `ffmpeg-static` path)
- [ ] `bun run dist:win` — produces a working installer
- [ ] Installed .exe can export video (packaged mode, `app.asar.unpacked` path works)
- [ ] `bun run test` — all new unit tests pass
- [ ] No DLLs remain tracked in git after Subtask 4
- [ ] Dev mode still falls back to system FFmpeg if `ffmpeg-static` is missing
- [ ] `electron/resources/` directory no longer contains any `.dll` files
- [ ] CI release builds for all 3 platforms succeed

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| `ffmpeg-static` binary download fails in CI | Cache binaries; `FFMPEG_BINARIES_URL` env var allows mirror |
| `ffmpeg-static` version ships an FFmpeg version with regressions | Pin exact version in `package.json` (`"ffmpeg-static": "5.3.0"`) |
| Cross-platform build (e.g., building macOS from Windows) | CI runs each platform on its native runner — no cross-building needed |
| `app.asar.unpacked` path doesn't exist | `asarUnpack` config ensures it; validation test in Subtask 7 |
| `ffmpeg-static` FFmpeg 6.1.1 vs current DLLs (FFmpeg 7.x) | Static build is self-contained — no DLL version mismatch possible |

---

## What Changes for Developers

| Before (manual) | After (`ffmpeg-static`) |
|-----------------|------------------------|
| Download `ffmpeg.exe` manually from ffmpeg.org | `bun install` handles it automatically |
| Place binary in `electron/resources/` | Binary lives in `node_modules/ffmpeg-static/` |
| 7 DLLs committed to git (~50MB) | Zero binaries in git — statically linked |
| macOS/Linux builds broken | All platforms work out of the box |
| CI releases ship without FFmpeg | CI releases automatically include FFmpeg |
| Must remember to re-download after FFmpeg updates | `bun update ffmpeg-static` updates the binary |

---

## Sources

- [ffmpeg-static npm package](https://www.npmjs.com/package/ffmpeg-static) — Primary dependency (FFmpeg 6.1.1, all platforms)
- [ffmpeg-static GitHub README](https://github.com/eugeneware/ffmpeg-static/blob/master/packages/ffmpeg-static/README.md) — API and Electron usage
- [ffprobe-static npm package](https://www.npmjs.com/package/ffprobe-static) — Companion for video probing
- [Electron ASAR Archives docs](https://www.electronjs.org/docs/latest/tutorial/asar-archives) — Understanding asarUnpack
- [electron-builder Common Configuration](https://www.electron.build/configuration.html) — extraResources and asarUnpack reference
