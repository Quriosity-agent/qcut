# Bundle AICP as Standalone Python Binary — Complete

## Status: DONE

The AICP binary pipeline is now **fully operational**. Release `v1.0.25` from the upstream `video-agent-skill` repo provides pre-built PyInstaller binaries for all 4 platforms. QCut's infrastructure (manifest, staging, packaging, runtime resolution) was already complete — the missing piece was the binaries themselves.

**Validated on 2026-02-14:**
- `bun run stage-aicp-binaries` — downloads all 4 platform binaries, checksum passes
- `aicp --version` → `aicp, version 1.0.25` (runs without Python)
- `aicp --help` → lists 15+ commands
- `aicp list-models` → lists available AI models

---

## Problem (Resolved)

Users could not use the AI Content Pipeline (`aicp`) because:

1. **macOS ships Python 3.9.6** — `aicp` requires >= 3.10
2. **`pip` not found** — only `pip3` exists on many systems
3. **No Python at all** on fresh Windows installs
4. **Dependency conflicts** — users shouldn't manage `fal-client`, `pydantic`, etc. themselves

**Solution:** Bundle standalone PyInstaller binaries — no Python required on the user's machine.

---

## What Was Done

### 1. Manifest Updated (`resources/bin/manifest.json`)

Updated from placeholder values to real release data:

| Field | Before | After |
|-------|--------|-------|
| `version` | `1.0.0` | `1.0.25` |
| `downloadUrl` | `v1.0.0/aicp-macos-x64` (404) | `v1.0.25/aicp-macos-x86_64` (correct) |
| `size` | `0` (all platforms) | Real sizes (45–49 MB each) |
| `sha256` | missing | Real checksums for all 4 platforms |

**URL naming fix:** The upstream release uses `x86_64` (not `x64`) for Intel Mac and Linux binaries. Manifest URLs updated to match.

### 2. Binaries Staged (`electron/resources/bin/aicp/`)

All 4 platform binaries downloaded, validated, and staged:

| Platform | Size | SHA256 (first 16) |
|----------|------|-------------------|
| `darwin-arm64` | 45.5 MB | `14e3729009ae0bea` |
| `darwin-x64` | 47.5 MB | `f983b4d592e6cb28` |
| `win32-x64` | 48.4 MB | `9ada69a1075b7a3c` |
| `linux-x64` | 49.5 MB | `a70c8b454dc36691` |

### 3. macOS Quarantine Issue Identified

Downloaded binaries get `com.apple.provenance` extended attribute, which causes the host validation `--version` check to hang (8s timeout). Fix: remove the xattr after download.

**Note for staging script improvement:** `stage-aicp-binaries.ts` should strip `com.apple.provenance` and `com.apple.quarantine` xattrs after writing the binary on macOS. This will prevent the timeout on first staging.

---

## Architecture — How It All Works

```
Upstream: donghaozhang/video-agent-skill
─────────────────────────────────────────────────
  GitHub Release v1.0.25
  ├── aicp-macos-arm64       (45.5 MB)
  ├── aicp-macos-x86_64      (47.5 MB)
  ├── aicp-windows-x64.exe   (48.4 MB)
  └── aicp-linux-x86_64      (49.5 MB)

QCut Build Time
─────────────────────────────────────────────────
  bun run stage-aicp-binaries
  │ ← called by every dist:* script automatically
  ├─ Reads resources/bin/manifest.json
  ├─ Downloads from GitHub Release URLs
  ├─ Validates SHA256 + size per platform
  ├─ Stages to electron/resources/bin/aicp/<platform>/
  └─ Syncs manifest into electron/resources/bin/

  electron-builder
  └─ extraResources: electron/resources/bin/ → resources/bin/

  bun run verify:packaged-aicp
  └─ Verifies binary presence + runs --version

QCut Runtime (User's Machine)
─────────────────────────────────────────────────
  ai-pipeline-handler.ts → detectEnvironment()
  │
  ├─► 1. Bundled binary (via BinaryManager)     ← NOW WORKS
  │     resources/bin/aicp/<platform>/aicp[.exe]
  │     No Python needed
  │
  ├─► 2. System "aicp" (dev only)
  └─► 3. Python module (dev only)
```

---

## Infrastructure Inventory (All Pre-existing)

| Component | File | Lines |
|-----------|------|-------|
| Binary manifest | `resources/bin/manifest.json` | 60 |
| Manifest schema | `resources/bin/manifest.schema.json` | 156 |
| Binary manager | `electron/binary-manager.ts` | 543 |
| AI pipeline handler | `electron/ai-pipeline-handler.ts` | 859 |
| Staging script | `scripts/stage-aicp-binaries.ts` | 461 |
| Verification script | `scripts/verify-packaged-aicp.ts` | 274 |
| package.json scripts | `stage-aicp-binaries`, `verify:packaged-aicp`, all `dist:*` | — |
| electron-builder config | `extraResources` includes `electron/resources/bin` | — |

---

## Remaining Work

### P1: Fix macOS xattr in Staging Script (5 min)

**File:** `scripts/stage-aicp-binaries.ts`

After `chmod(destinationPath, 0o755)`, add xattr removal on macOS:

```typescript
if (target.platform === "darwin" || process.platform === "darwin") {
  try {
    await execAsync(`xattr -cr "${destinationPath}"`, { timeout: 5000 });
  } catch {
    // xattr removal is best-effort
  }
}
```

This prevents the `--version` timeout on first staging.

### P2: Code Signing (Future)

- macOS: Sign + notarize to avoid Gatekeeper "unidentified developer" warning
- Windows: EV code signing to avoid SmartScreen false positives
- This is a packaging concern, not blocking for development

### P3: `list-models` Doesn't Support `--json` Flag

The `--json` flag is a global option on the `aicp` CLI, but `list-models` doesn't support it:
```
Error: No such option: --json
```
The global `--json` flag works on other commands (e.g., `generate-image`). This is an upstream issue in `video-agent-skill`.

### P4: Integration Tests (15 min)

**File to create:** `electron/__tests__/aicp-binary.test.ts`

Test cases:
1. Binary exists for host platform
2. `--version` returns `aicp, version X.Y.Z`
3. `--help` exits 0 with usage info
4. SHA256 matches manifest

---

## Key Learnings

1. **QCut-side infrastructure was 100% complete** — only the upstream binaries were missing
2. **URL naming matters** — upstream uses `x86_64`, manifest originally used `x64`
3. **macOS `com.apple.provenance` xattr** causes downloaded binaries to hang on execution — must be stripped
4. **Binary sizes are reasonable** — 45–49 MB per platform (~190 MB total), well within acceptable limits for a desktop app that already bundles FFmpeg
