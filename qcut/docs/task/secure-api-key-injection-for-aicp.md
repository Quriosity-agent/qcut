# AICP End-to-End Reliability Plan (Install, Auth, Output, Import)

**Date:** 2026-02-14  
**Source:** `docs/task/session-notes.md`

## Goal

Remove all manual setup and failure-prone steps so a user can generate AI media and see it in QCut Media with one flow:

1. QCut detects bundled AICP.
2. QCut injects API key securely.
3. Generation runs with deterministic output path handling.
4. Result is imported automatically into the project.

No local Python install, no `.env`, no manual file copy, no manual import curl.

## Problems To Solve (Mapped 1:1)

1. AICP not installed  
2. Python version incompatibility  
3. PEP 668 pip restrictions  
4. Missing `FAL_KEY` env var  
5. `--output-dir` mismatch behavior

## Strategy

Split into four workstreams and make each one testable in isolation.

- Workstream A: Binary distribution/runtime policy (solves 1, 2, 3)
- Workstream B: Secure API key injection and validation (solves 4)
- Workstream C: Output path normalization and resilient result parsing (solves 5)
- Workstream D: Automatic media import + UX hardening (removes manual user steps)

---

## Workstream A: Binary Distribution and Runtime Policy

Status: Mostly complete based on `bundle-aicp-python-binary*.md`; keep this as release gate.

### A1. Ship bundled AICP for all target platforms

Files:
- `resources/bin/manifest.json`
- `resources/bin/manifest.schema.json`
- `scripts/stage-aicp-binaries.ts`
- `scripts/verify-packaged-aicp.ts`
- `.github/workflows/build-aicp-binaries.yml`

Acceptance:
- Packaged app contains host `aicp` binary under `resources/bin/aicp/<platform>/`.
- Host binary passes `--version` in packaged validation.
- Checksum/size validation enforced per platform in staging and runtime.

### A2. Packaged runtime uses bundled binary only

Files:
- `electron/ai-pipeline-handler.ts`

Acceptance:
- In packaged mode, no Python/system fallback attempt.
- User-facing error says reinstall/repair app if bundled binary missing/corrupt.

### A3. macOS xattr hardening

Files:
- `scripts/stage-aicp-binaries.ts`

Acceptance:
- Post-download xattr cleanup (`com.apple.quarantine`/provenance) is best-effort.
- Host validation does not hang due to quarantine metadata.

---

## Workstream B: Secure API Key Injection and Validation

### B1. Centralize decrypted key access in Electron main process

Files:
- `electron/api-key-handler.ts`

Changes:
- Extract reusable `getDecryptedApiKeys()` for main-process consumers.
- Reuse same decryption path as IPC handler.

Acceptance:
- No duplicate decryption logic.
- Returns empty strings for missing keys.

### B2. Inject keys only at generation spawn time

Files:
- `electron/ai-pipeline-handler.ts`

Changes:
- Build `spawnEnv` from `process.env` plus decrypted keys.
- Inject `FAL_KEY` (and optional provider keys if needed by command).
- Do not inject keys into environment detection/version checks.

Acceptance:
- `generate-image` receives `FAL_KEY` when configured.
- `aicp --version` and environment detection remain key-independent.

### B3. Add pre-flight key validation

Files:
- `electron/ai-pipeline-handler.ts`

Changes:
- For commands that require FAL, fail fast with actionable message when key missing.
- Allow non-auth commands (`list-models`, `--help`, version checks).

Acceptance:
- Missing key error returns immediately with path: `Editor -> Settings -> API Keys`.

### B4. Stop key material leakage in logs

Files:
- `electron/api-key-handler.ts`
- `electron/ai-pipeline-handler.ts`

Changes:
- Remove key prefix/length debug logging.
- Keep only non-sensitive operational logs.

Acceptance:
- No plaintext or partial key value appears in logs.

---

## Workstream C: Output Path Determinism and Result Recovery

### C1. Make output path behavior deterministic for QCut

Files:
- `electron/ai-pipeline-handler.ts`

Changes:
- Always pass QCut-controlled output directory.
- Ensure directory exists before spawn.
- Track baseline file set before run and diff after run when CLI output path is absent.

Acceptance:
- Generated file can be resolved even if upstream ignores `--output-dir`.

### C2. Robust result extraction priority

Files:
- `electron/ai-pipeline-handler.ts`

Parsing order:
1. Structured JSON/`RESULT:` output path
2. Explicit stdout/stderr path patterns
3. Filesystem diff fallback (newest matching artifact)

Acceptance:
- `PipelineResult.outputPath` is returned for successful generations in normal and fallback modes.

### C3. Upstream compatibility guard

Files:
- `electron/ai-pipeline-handler.ts`

Changes:
- Add tolerant parsing so upstream CLI format changes degrade gracefully.
- Emit concise error when output cannot be resolved.

Acceptance:
- No silent success with missing path.

---

## Workstream D: Automatic Media Import and UX Hardening

### D1. Auto-import generated artifact into Media panel

Files:
- `electron/ai-pipeline-handler.ts`
- Existing media import integration point in main process (use project-aware import path used by current REST flow)

Changes:
- After successful generation, trigger same import pathway used by editor media imports.
- Return `mediaId` and `outputPath` to renderer.

Acceptance:
- User sees generated media in panel without manual curl or file copy.

### D2. Tight user-facing errors and recovery actions

Files:
- `electron/ai-pipeline-handler.ts`
- Renderer surface that displays pipeline errors

Acceptance:
- Errors are categorized: `missing_key`, `binary_missing`, `generation_failed`, `output_unresolved`, `import_failed`.
- Each error has one clear next action.

---

## Test Plan (Must Pass Before Release)

### Unit Tests

Files:
- `electron/__tests__/api-key-injection.test.ts` (new)
- `electron/__tests__/ai-pipeline-handler.test.ts` (extend)

Coverage:
- Key injection on spawn
- No key in detection/version checks
- Missing key pre-flight failure
- No key leakage to logs
- Output path fallback via filesystem diff
- Error classification mapping

### Integration/Packaging Tests

Commands:
- `bun run stage-aicp-binaries`
- `bun run verify:packaged-aicp`
- `bun run build`

Coverage:
- Packaged resources include host binary + manifest
- Host binary executes in packaged validation
- Pipeline returns output path and import metadata

### Manual Smoke (Packaged App)

1. Fresh machine/user profile with no Python installed.
2. Set FAL key once in Settings.
3. Run image generation from editor.
4. Confirm media appears in panel automatically.

---

## Rollout Order

1. Complete Workstream B (secure key injection + fast failures).  
2. Complete Workstream C (deterministic output resolution).  
3. Complete Workstream D (auto-import + categorized UX errors).  
4. Keep Workstream A checks as CI/release gate every build.

## Definition of Done

All five blockers from `docs/task/session-notes.md` are eliminated in shipped UX:

- No Python/pip requirement for end users.
- No `.env` requirement for API key.
- No manual command-line copy/import steps.
- Generation either succeeds with imported media or fails with one actionable message.
