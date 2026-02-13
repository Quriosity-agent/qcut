# Bundle AICP Python Binary — Execution Plan

**Status:** Planned (ready to implement)
**Date:** 2026-02-13
**Source Task:** `docs/task/bundle-aicp-python-binary.md`

## Goal

Ship `aicp` as a bundled, platform-specific standalone executable so end users do not need local Python or pip, while keeping a contributor-friendly fallback in development.

## Scope

In scope:
- Build and stage `aicp` binaries for `darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64`
- Resolve bundled binary paths correctly in packaged and dev modes
- Add integrity metadata/checksums and validation
- Include binaries in packaged Electron app
- Add CI workflow for binary production and publishing
- Add automated tests for binary resolution and fallback behavior

Out of scope:
- Replacing FFmpeg packaging flow
- Runtime model/API behavior changes in `ai_content_pipeline`
- Full auto-update implementation for binaries

## Current Gaps (Verified in Repo)

1. `resources/bin/manifest.json` contains `aicp` platform entries, but no staged `aicp` files exist.
2. `electron/binary-manager.ts` currently resolves binaries as `path.join(this.binDir, platformInfo.filename)`, which does not support per-binary platform subdirectories.
3. `resources/bin/manifest.schema.json` only supports a top-level checksum per binary entry, not per-platform binary checksums.
4. Packaging scripts in `package.json` stage FFmpeg but do not stage `aicp`.
5. `electron/ai-pipeline-handler.ts` still exposes end-user messages that suggest installing Python.

## Implementation Plan (Subtasks)

### 1) Add build assets for standalone `aicp` binary (15 min)

Files:
- `build/aicp/aicp.spec` (new)
- `build/aicp/entry.py` (new)
- `build/aicp/build.sh` (new)
- `build/aicp/build.ps1` (new)

Deliverables:
- PyInstaller spec and entrypoint checked in
- Build scripts pinned to Python 3.12 and pinned `video-agent-skill` ref/tag
- Local validation command in scripts (`aicp --version`)

Acceptance:
- Running platform script produces executable in `build/aicp/dist/`

### 2) Add AICP staging script mirroring FFmpeg flow (20 min)

Files:
- `scripts/stage-aicp-binaries.ts` (new)

Design:
- Mirror `scripts/stage-ffmpeg-binaries.ts` structure
- Support env vars:
  - `AICP_STAGE_TARGETS`
  - `AICP_BINARY_RELEASE`
  - `AICP_BINARY_BASE_URL`
  - `AICP_STAGE_FORCE`
- Stage to:
  - `electron/resources/bin/aicp/<platform>-<arch>/aicp[.exe]`

Acceptance:
- Script stages all requested targets
- Host target executes `--version`
- Non-host targets validated by size/presence only

### 3) Extend manifest schema for per-platform checksums (20 min)

Files:
- `resources/bin/manifest.schema.json` (modify)
- `resources/bin/manifest.json` (modify)

Design:
- Move checksum and size validation to platform entry level:
  - `platforms.<key>.sha256`
  - `platforms.<key>.size`
- Keep backward compatibility by treating top-level `checksum` as optional legacy

Acceptance:
- Updated schema validates updated manifest
- Manifest includes real per-platform checksum + size values

### 4) Fix binary manager path resolution and checksum logic (20 min)

Files:
- `electron/binary-manager.ts` (modify)

Design:
- Resolve `aicp` path as:
  - `process.resourcesPath/bin/aicp/<platform>-<arch>/<filename>` in packaged mode
  - `<repo>/electron/resources/bin/aicp/<platform>-<arch>/<filename>` in dev mode
- Update checksum verification to use per-platform `sha256`
- Preserve checksum cache and compatibility checks
- Keep defensive `try/catch` around file IO and parsing

Acceptance:
- `getBinaryStatus("aicp")` returns available path when staged
- Returns unavailable if file missing or checksum mismatch

### 5) Wire packaging and build scripts to stage AICP (15 min)

Files:
- `package.json` (modify)

Changes:
- Add scripts:
  - `stage-aicp-binaries`
  - `verify:packaged-aicp` (if implemented)
- Update pre-package scripts (`dist*`) to run FFmpeg + AICP staging
- Update `prebuild` only if build must enforce local AICP staging (prefer optional in dev)

Acceptance:
- `bun run stage-aicp-binaries` works standalone
- `bun run dist:dir` includes staged AICP resources

### 6) Include AICP resources in electron-builder output (10 min)

Files:
- `package.json` (modify `build.extraResources`)

Changes:
- Add mapping:
  - from: `electron/resources/bin`
  - to: `bin`

Acceptance:
- Packaged app contains:
  - `resources/bin/manifest.json`
  - `resources/bin/aicp/<platform>-<arch>/aicp[.exe]`

### 7) Tighten runtime fallback policy and user-facing errors (15 min)

Files:
- `electron/ai-pipeline-handler.ts` (modify)

Design:
- Packaged mode:
  - prefer bundled `aicp` only
  - do not advise Python installation
- Dev mode:
  - allow fallback to system `aicp` and Python module
- Return actionable packaged error:
  - corrupted installation / reinstall guidance

Acceptance:
- Production status/error messages do not mention installing Python
- Development keeps contributor fallback behavior

### 8) Add CI workflow to produce and publish binaries (20 min)

Files:
- `.github/workflows/build-aicp-binaries.yml` (new)

Design:
- Matrix runners:
  - `macos-14` (arm64)
  - `macos-13` (x64)
  - `windows-latest`
  - `ubuntu-latest`
- Steps:
  - Python 3.12 setup
  - Build with PyInstaller
  - checksum generation
  - artifact upload
  - optional release upload on tag

Acceptance:
- Workflow outputs 4 binaries + checksums
- Artifacts downloadable per target

### 9) Add focused tests for long-term stability (20 min)

Files:
- `electron/__tests__/binary-manager.test.ts` (new)
- `electron/__tests__/ai-pipeline-handler.test.ts` (new)
- `electron/__tests__/manifest-schema.test.ts` (new)

Coverage:
- Binary path resolution for packaged/dev modes
- Per-platform checksum success/failure
- Missing binary behavior
- Fallback policy differences between packaged/dev
- Manifest schema contract for per-platform checksum entries

Acceptance:
- Tests pass in CI with deterministic mocks

### 10) Add script-level smoke validation (15 min)

Files:
- `scripts/verify-packaged-aicp.ts` (new)

Coverage:
- Find latest packaged app resources dir
- Validate `aicp` binary presence for expected targets
- Execute `--version` for host target

Acceptance:
- Script exits non-zero on missing/invalid packaged binary

## Implementation Order

1. Build assets (`build/aicp/*`)
2. Staging script (`scripts/stage-aicp-binaries.ts`)
3. Manifest/schema changes
4. `binary-manager` path + checksum updates
5. Packaging script updates in `package.json`
6. Runtime fallback message updates in `electron/ai-pipeline-handler.ts`
7. CI workflow
8. Tests + smoke verifier

## Test Plan

Primary checks:
- `bun x vitest run electron/__tests__/binary-manager.test.ts`
- `bun x vitest run electron/__tests__/ai-pipeline-handler.test.ts`
- `bun x vitest run electron/__tests__/manifest-schema.test.ts`

Build/package checks:
- `bun run stage-aicp-binaries`
- `bun run dist:dir`
- `bun run verify:packaged-aicp`

Functional smoke:
- In packaged resources, host binary runs:
  - `aicp --version`
  - `aicp --help`

## Rollback Plan

If bundled `aicp` fails post-merge:
1. Disable AICP staging in `dist*` scripts in `package.json`
2. Revert manifest `aicp` entry to unavailable state
3. Keep dev fallback operational in `electron/ai-pipeline-handler.ts`
4. Ship hotfix with clear “AI pipeline temporarily unavailable” message

## Definition of Done

- `aicp` binaries are staged and packaged for all target platforms
- `BinaryManager` resolves and validates platform-specific `aicp` binaries
- Packaged app uses bundled `aicp` without requiring user Python setup
- CI produces reproducible binaries with checksums
- New electron-side tests cover binary resolution, integrity, and fallback behavior
