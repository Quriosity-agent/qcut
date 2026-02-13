# Bundle AICP as Standalone Python Binary — Implementation Plan

## Problem

Users cannot reliably use the AI Content Pipeline (`aicp`) because:

1. **macOS ships Python 3.9.6** — `aicp` requires >= 3.10
2. **`pip` not found** — only `pip3` exists on many systems
3. **No Python at all** on fresh Windows installs
4. **Dependency conflicts** — users shouldn't manage `fal-client`, `pydantic`, etc. themselves
5. **Version drift** — user-installed `aicp` may not match QCut's expected version

Expecting end users to install Python and pip-install a package is a non-starter for a desktop app. QCut already bundles FFmpeg — `aicp` should follow the same pattern.

## Current State

QCut already has the infrastructure — just not the binaries:

| Component | Status |
|-----------|--------|
| `resources/bin/manifest.json` | Has `aicp` entry with platform definitions |
| `electron/binary-manager.ts` | Loads manifest, validates checksums, checks versions |
| `electron/ai-pipeline-handler.ts` | 3-tier fallback: bundled binary → system aicp → python module |
| `scripts/stage-ffmpeg-binaries.ts` | Reference script for staging platform binaries |
| Actual `aicp` binaries | **Missing — this is what we need to build** |

The fallback chain in `ai-pipeline-handler.ts` already prefers a bundled binary first. Once we produce and stage the binaries, everything else just works.

## Solution: PyInstaller Standalone Binary

Use **PyInstaller** to compile `aicp` + all Python dependencies into a single standalone executable per platform. No Python runtime required on the user's machine.

### Why PyInstaller

| Tool | Verdict |
|------|---------|
| **PyInstaller** | Best fit — mature, cross-platform, single-file mode, widely used for CLI tools |
| Nuitka | Compiles to C — faster runtime but complex build, overkill for a CLI wrapper |
| cx_Freeze | Less maintained, weaker single-file support |
| PyOxidizer | Rust-based, powerful but complex setup for a Python CLI |
| Embedded Python | Ships entire Python runtime (~50MB+), unnecessary bloat |

PyInstaller produces a single `aicp` / `aicp.exe` binary (typically 30–60MB) that includes:
- Python 3.12 interpreter (embedded)
- `ai_content_pipeline` package and all dependencies
- Required shared libraries

---

## Implementation Subtasks

### Task 1: Create PyInstaller Build Spec (20 min)

**Files to create:**
- `build/aicp/aicp.spec` — PyInstaller spec file
- `build/aicp/build.sh` — Build script (macOS/Linux)
- `build/aicp/build.ps1` — Build script (Windows)

**`aicp.spec`:**
```python
# PyInstaller spec for aicp CLI
import platform

a = Analysis(
    ['entry.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        'ai_content_pipeline',
        'fal_client',
        'pydantic',
        'httpx',
        'certifi',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        # Exclude heavy optional deps not needed for core generation
        'whisper',
        'torch',
        'numpy',
        'modal',
        'boto3',
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='aicp',
    debug=False,
    strip=True,     # Strip debug symbols
    upx=True,       # Compress with UPX
    console=True,   # CLI tool, needs console
    target_arch=None,  # Native arch
)
```

**`entry.py`** — thin wrapper:
```python
"""PyInstaller entry point for aicp CLI."""
from ai_content_pipeline.cli import main

if __name__ == "__main__":
    main()
```

**`build.sh`:**
```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
DIST_DIR="$SCRIPT_DIR/dist"

# Create isolated venv with Python 3.12
python3.12 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

# Install aicp + pyinstaller
pip install git+https://github.com/donghaozhang/video-agent-skill.git
pip install pyinstaller

# Build standalone binary
pyinstaller "$SCRIPT_DIR/aicp.spec" \
    --distpath "$DIST_DIR" \
    --workpath "$SCRIPT_DIR/build-temp" \
    --clean

# Verify binary works
"$DIST_DIR/aicp" --version

PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
# Normalize: x86_64 → x64, arm64 stays arm64
[ "$ARCH" = "x86_64" ] && ARCH="x64"
[ "$PLATFORM" = "linux" ] && PLATFORM="linux"
[ "$PLATFORM" = "darwin" ] && PLATFORM="darwin"

echo "Built: $DIST_DIR/aicp for $PLATFORM-$ARCH"
echo "Size: $(du -h "$DIST_DIR/aicp" | cut -f1)"
```

**Acceptance criteria:**
- `build.sh` produces a working `aicp` binary on macOS arm64
- Binary runs `aicp --version` without Python installed
- Binary size < 80MB

---

### Task 2: Create Staging Script (30 min)

**Files to create:**
- `scripts/stage-aicp-binary.ts` — mirrors `scripts/stage-ffmpeg-binaries.ts` pattern

**Behavior:**
1. Check if binaries already staged (skip if present + valid checksum)
2. Download pre-built binaries from GitHub Releases (or build locally)
3. Stage to `electron/resources/bin/aicp/<platform>-<arch>/aicp[.exe]`
4. Set executable permissions on Unix
5. Validate with `--version` check

**Directory structure:**
```
electron/resources/bin/
└── aicp/
    ├── darwin-arm64/
    │   └── aicp
    ├── darwin-x64/
    │   └── aicp
    ├── win32-x64/
    │   └── aicp.exe
    └── linux-x64/
        └── aicp
```

**Environment variables:**
```bash
AICP_STAGE_TARGETS=darwin-arm64,darwin-x64,win32-x64,linux-x64
AICP_BINARY_VERSION=1.0.0
AICP_DOWNLOAD_URL=https://github.com/donghaozhang/video-agent-skill/releases/download
AICP_STAGE_FORCE=0
```

**Relevant file:**
- `scripts/stage-ffmpeg-binaries.ts` — reference implementation to follow

**Acceptance criteria:**
- `bun run scripts/stage-aicp-binary.ts` downloads/stages binaries
- Skips already-staged binaries unless `AICP_STAGE_FORCE=1`
- Validates binary with version check on host platform

---

### Task 3: Update Binary Manager for AICP Resolution (15 min)

**Files to modify:**
- `electron/binary-manager.ts`

**Changes:**
- Ensure `getBinaryPath("aicp")` resolves to:
  - **Packaged app:** `process.resourcesPath/bin/aicp/<platform>-<arch>/aicp[.exe]`
  - **Development:** `electron/resources/bin/aicp/<platform>-<arch>/aicp[.exe]`
- Verify SHA256 checksums match manifest on first load
- Cache validation result (don't re-check every call)

**Relevant file:**
- `electron/ffmpeg/utils.ts` — reference for platform-specific path resolution

**Acceptance criteria:**
- `getBinaryPath("aicp")` returns correct path for current platform
- Returns `null` if binary missing (triggers fallback in handler)
- Checksum validation works

---

### Task 4: Update Manifest with Real Checksums (10 min)

**Files to modify:**
- `resources/bin/manifest.json`

**Changes:**
- Update `aicp.version` to match built binary version
- Fill in SHA256 checksums for each platform binary
- Update `downloadUrl` to point to actual release URL
- Set `minQCutVersion` to current QCut version

```json
{
  "binaries": {
    "aicp": {
      "version": "1.0.0",
      "minQCutVersion": "0.3.50",
      "platforms": {
        "darwin-arm64": {
          "filename": "aicp",
          "sha256": "<computed-after-build>",
          "size": 0,
          "downloadUrl": "https://github.com/donghaozhang/video-agent-skill/releases/download/v1.0.0/aicp-darwin-arm64"
        }
      }
    }
  }
}
```

**Acceptance criteria:**
- Checksums match actual built binaries
- Manifest validates against `manifest.schema.json`

---

### Task 5: Update electron-builder Config (15 min)

**Files to modify:**
- `package.json` or `electron-builder.yml` — wherever electron-builder config lives

**Changes:**
- Add `electron/resources/bin/` to `extraResources` so `aicp` binaries get copied into packaged app:

```json
{
  "build": {
    "extraResources": [
      {
        "from": "electron/resources/ffmpeg/${platform}-${arch}/",
        "to": "ffmpeg/${platform}-${arch}/"
      },
      {
        "from": "electron/resources/bin/aicp/${platform}-${arch}/",
        "to": "bin/aicp/${platform}-${arch}/"
      }
    ]
  }
}
```

**Acceptance criteria:**
- `bun run electron` (packaged mode) includes `aicp` binary in `resources/`
- `ai-pipeline-handler.ts` finds the binary via `process.resourcesPath`

---

### Task 6: CI/CD — Build Binaries per Platform (30 min)

**Files to create:**
- `.github/workflows/build-aicp-binaries.yml`

**Workflow:**
- Trigger: manual dispatch + on `aicp` version tag (`aicp-v*`)
- Matrix: `[macos-14 (arm64), macos-13 (x64), windows-latest, ubuntu-latest]`
- Steps per platform:
  1. Install Python 3.12
  2. Clone `video-agent-skill` repo
  3. Install deps + PyInstaller
  4. Run `pyinstaller aicp.spec`
  5. Compute SHA256 checksum
  6. Upload binary as release artifact
  7. (Optional) Upload to GitHub Release

**Relevant file:**
- `.github/workflows/` — check existing CI patterns

**Acceptance criteria:**
- Workflow produces 4 platform binaries
- Binaries are attached to GitHub Release
- SHA256 checksums included in release notes

---

### Task 7: Add `bun run stage:aicp` Script (5 min)

**Files to modify:**
- `package.json`

**Changes:**
```json
{
  "scripts": {
    "stage:aicp": "bun run scripts/stage-aicp-binary.ts",
    "stage:ffmpeg": "bun run scripts/stage-ffmpeg-binaries.ts",
    "stage:all": "bun run stage:ffmpeg && bun run stage:aicp"
  }
}
```

**Acceptance criteria:**
- `bun run stage:aicp` stages binaries for development
- `bun run stage:all` stages both FFmpeg and aicp

---

### Task 8: Update ai-pipeline-handler.ts Fallback Messaging (10 min)

**Files to modify:**
- `electron/ai-pipeline-handler.ts`

**Changes:**
- When bundled binary not found AND Python fallback also fails, return a clear user-facing error:
  ```
  AI Content Pipeline is not available.
  The bundled binary was not found — this may indicate a corrupted installation.
  Please reinstall QCut or contact support.
  ```
- Remove suggestion to "install Python" from user-facing errors — users shouldn't need to
- Keep Python fallback for development mode only (useful for contributors)

**Acceptance criteria:**
- Production error messages never mention Python installation
- Dev mode still falls back to `python -m ai_content_pipeline`

---

### Task 9: Binary Size Optimization (15 min)

**Files to modify:**
- `build/aicp/aicp.spec`

**Optimizations:**
1. **Exclude unused modules** — `whisper`, `torch`, `numpy`, `modal`, `boto3` (heavy, only needed for transcription which runs server-side)
2. **Strip debug symbols** — `strip=True` in spec
3. **UPX compression** — `upx=True` in spec
4. **Exclude test files** — `--exclude-module pytest`

**Target sizes:**
| Platform | Target | Notes |
|----------|--------|-------|
| macOS arm64 | < 50MB | Core API client + CLI |
| macOS x64 | < 55MB | Slightly larger due to arch |
| Windows x64 | < 60MB | Includes MSVC runtime |
| Linux x64 | < 45MB | Smallest, static linking |

**Acceptance criteria:**
- Total binary size across all 4 platforms < 220MB
- `aicp generate-image --help` works (core feature)
- `aicp list-models` works
- `aicp estimate-cost` works

---

### Task 10: Integration Tests (20 min)

**Files to create:**
- `electron/__tests__/aicp-binary.test.ts`

**Test cases:**
1. **Binary exists** — staged binary present for current platform
2. **Version check** — `aicp --version` returns valid semver
3. **List models** — `aicp list-models --json` returns valid JSON array
4. **Help output** — `aicp --help` exits 0
5. **Invalid command** — `aicp nonexistent` exits non-zero with error message
6. **Manifest match** — binary SHA256 matches `manifest.json` entry
7. **No Python required** — unset `PYTHONPATH`/`PYTHONHOME`, binary still works

**Acceptance criteria:**
- All tests pass with `bun run test`
- Tests skip gracefully if binary not staged (CI without build step)

---

## Estimated Total Time: ~3 hours

| Task | Time |
|------|------|
| 1. PyInstaller Build Spec | 20 min |
| 2. Staging Script | 30 min |
| 3. Binary Manager Update | 15 min |
| 4. Manifest Checksums | 10 min |
| 5. electron-builder Config | 15 min |
| 6. CI/CD Workflow | 30 min |
| 7. Package.json Scripts | 5 min |
| 8. Error Message Cleanup | 10 min |
| 9. Binary Size Optimization | 15 min |
| 10. Integration Tests | 20 min |

## File Impact Summary

| File | Action |
|------|--------|
| `build/aicp/aicp.spec` | **Create** — PyInstaller spec |
| `build/aicp/entry.py` | **Create** — CLI entry point |
| `build/aicp/build.sh` | **Create** — Build script (macOS/Linux) |
| `build/aicp/build.ps1` | **Create** — Build script (Windows) |
| `scripts/stage-aicp-binary.ts` | **Create** — Binary staging script |
| `electron/binary-manager.ts` | Modify — AICP path resolution |
| `resources/bin/manifest.json` | Modify — real checksums + download URLs |
| `package.json` | Modify — add `stage:aicp` script |
| electron-builder config | Modify — add `bin/aicp/` to `extraResources` |
| `.github/workflows/build-aicp-binaries.yml` | **Create** — CI build workflow |
| `electron/ai-pipeline-handler.ts` | Modify — error messages |
| `electron/__tests__/aicp-binary.test.ts` | **Create** — Integration tests |

## Architecture Diagram

```
Build Time (CI/CD)
─────────────────────────────────────────────────
  Python 3.12 + PyInstaller
       │
       ▼
  ┌──────────────────────┐
  │  aicp standalone     │  × 4 platforms
  │  (Python embedded)   │  darwin-arm64, darwin-x64
  │  ~40-60MB each       │  win32-x64, linux-x64
  └──────────┬───────────┘
             │
             ▼  GitHub Release artifacts
  ┌──────────────────────┐
  │  stage-aicp-binary   │  downloads to
  │  (bun script)        │  electron/resources/bin/aicp/
  └──────────┬───────────┘
             │
             ▼
Distribution (electron-builder)
─────────────────────────────────────────────────
  QCut.app / QCut.exe
  └── resources/
      ├── ffmpeg/<platform>/    (existing)
      └── bin/aicp/<platform>/  (new)
          └── aicp[.exe]

Runtime (User's Machine)
─────────────────────────────────────────────────
  ai-pipeline-handler.ts
       │
       ├─► 1. Bundled binary ✅ (always works)
       ├─► 2. System `aicp`     (bonus if installed)
       └─► 3. Python module     (dev only)
```

## Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Binary too large (>100MB per platform) | Bloats installer | Exclude torch/whisper/numpy — core generation only needs HTTP clients |
| PyInstaller misses hidden imports | Runtime `ModuleNotFoundError` | Test all commands after build; add to `hiddenimports` in spec |
| Code signing on macOS | Gatekeeper blocks unsigned binary | Sign with Apple Developer cert in CI; or notarize with `codesign` |
| Windows Defender false positive | Users see malware warning | Sign with EV code signing cert; submit to Microsoft for whitelisting |
| Upstream `video-agent-skill` breaks | Build fails | Pin to specific commit/tag, not `main` branch |
| Cross-compilation limitations | Can't build macOS binary on Linux | Use native runners in CI matrix (macos-14, macos-13, windows-latest, ubuntu-latest) |
