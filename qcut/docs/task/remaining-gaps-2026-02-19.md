# Remaining Gaps: Python → TypeScript Parity

> **Date:** 2026-02-19
> **Based on:** [Gap Implementation Plan](gap-implementation-plan.md)
> **Python source:** `packages/video-agent-skill/`
> **TypeScript target:** `electron/native-pipeline/`
> **Status:** ALL GAPS IMPLEMENTED (2026-02-19)

---

## Summary

| Category | Gap Count | Status |
|----------|:---------:|:------:|
| Integration (Phase 8) | 3 items | DONE |
| Missing CLI Commands | 4 commands | DONE |
| CLI Security & Feature Parity | 4 items | DONE |
| ViMax Agent Option Gaps | 3 agents | DONE |
| Test Coverage | 1 command | DONE |
| **Total** | **15 items** | **ALL DONE** |

---

## 1. Integration Gaps (Phase 8) — Blocks IPC/Electron Usage

### 1.1 Manager Routing for ViMax Commands

**File:** `electron/native-pipeline/manager.ts`
**Status:** DONE

`GenerateOptions.command` union type only includes 6 commands:

```ts
command:
  | "generate-image"
  | "create-video"
  | "generate-avatar"
  | "list-models"
  | "estimate-cost"
  | "run-pipeline";
```

Missing all 10 vimax subcommands (`vimax:idea2video`, `vimax:script2video`, `vimax:novel2movie`, `vimax:generate-portraits`, `vimax:generate-storyboard`, etc.). The `execute()` switch has no vimax cases.

**Impact:** ViMax pipelines work via CLI only, not through Electron IPC. The renderer process cannot invoke vimax features.

**Fix:** Add vimax commands to `GenerateOptions.command` union, add switch cases in `execute()`, update `PipelineStatus.features` with `vimaxPipelines: true`.

### 1.2 Vimax Barrel Exports

**File:** `electron/native-pipeline/index.ts`
**Status:** DONE

No `export * from "./vimax/index.js"`. The vimax module is invisible to anything importing from `native-pipeline`.

**Fix:** Add vimax re-export to `index.ts`.

### 1.3 IPC End-to-End Verification

**File:** `electron/ai-pipeline-ipc.ts`
**Status:** DONE

Once manager routing is added, verify IPC works from renderer → main → vimax pipeline → result.

---

## 2. Missing CLI Commands

### 2.1 `delete-key`

**Python source:** `commands/keys.py` — `delete_key()` function
**TypeScript:** No equivalent

Deletes a stored API key from config. Python validates key name against `KNOWN_KEYS`.

### 2.2 `init-project`

**Python source:** `commands/project.py` — `init_project()` function
**TypeScript:** No equivalent

Creates a new project directory structure with standard folders (input/, output/, config/).

### 2.3 `organize-project`

**Python source:** `commands/project.py` — `organize_project()` function
**TypeScript:** No equivalent

Scans and reorganizes media files into categorized folders.

### 2.4 `structure-info`

**Python source:** `commands/project.py` — `structure_info()` function
**TypeScript:** No equivalent

Displays project directory structure and file counts per category.

---

## 3. CLI Security & Feature Parity

### 3.1 `set-key` Security

**Python:** Reads key value via hidden interactive prompt or `--stdin`. Never appears in shell history.
**TypeScript:** Accepts `--value` flag in plaintext. Key value exposed in shell history.

**Fix:** Use Node.js `readline` with hidden input, add `--stdin` support, remove `--value` flag or make it warn.

### 3.2 `get-key` Missing `--reveal` Flag

**Python:** `--reveal` flag shows full key value.
**TypeScript:** Only shows masked version, no way to reveal.

**Fix:** Add `--reveal` option to `get-key` handler.

### 3.3 `run-pipeline` Feature Gaps vs Python `run-chain`

| Feature | Python | TypeScript |
|---------|:------:|:----------:|
| Interactive confirmation prompt | Yes | No |
| `--no-confirm` flag | Yes | No |
| Cost preview before execution | Yes | No |
| `--prompt-file` option | Yes | No |
| `--stream` JSONL event propagation | Yes | Wired in parser but not in handler |
| CI environment detection | Yes (`is_interactive()`) | No |

**Python source:** `interactive.py` — `is_interactive()` checks `CI`, `GITHUB_ACTIONS`, `JENKINS_URL`, `GITLAB_CI`, `CIRCLECI`, `TRAVIS`, `BUILDKITE`, `TF_BUILD`, `CODEBUILD_BUILD_ID` env vars.

### 3.4 Interactive Mode (`is_interactive` / `confirm`)

**Python source:** `interactive.py`
**TypeScript:** No equivalent anywhere

Used by `run-chain` to prompt "Proceed with execution?" before running pipelines. CI-safe (auto-skips in CI environments).

---

## 4. ViMax Agent CLI Option Gaps

### 4.1 `vimax:generate-portraits` Missing Options

| Option | Python | TypeScript |
|--------|:------:|:----------:|
| `--views` (comma-separated: front,side,back,three_quarter) | Yes | No |
| `--max-characters` | Yes | No |
| `--save-registry` / `--no-registry` | Yes | No (always saves separately) |

### 4.2 `vimax:generate-storyboard` Missing Options

| Option | Python | TypeScript |
|--------|:------:|:----------:|
| `--style` (prompt prefix) | Yes | No |
| `--portraits` (registry JSON path) | Yes | No |
| `--reference-model` | Yes | No |
| `--reference-strength` | Yes | No |

### 4.3 `vimax:script2video` Missing Option

| Option | Python | TypeScript |
|--------|:------:|:----------:|
| `--portraits` (registry JSON path) | Yes | No |

---

## 5. Test Coverage Gap

### 5.1 `transfer-motion` Command Tests

**Python:** Two dedicated test files — `test_motion_transfer_cli.py`, `test_kling_motion_control.py`
**TypeScript:** Zero tests for `handleTransferMotion` in any test file

**Fix:** Add transfer-motion test cases to `electron/__tests__/cli-pipeline.test.ts`.

---

## 6. Model Registry (No Gap)

- **Python:** 73 models in `registry_data.py`
- **TypeScript:** 77 models (33 in `registry-data.ts` + 44 in `registry-data-2.ts`)
- **Result:** All Python models present in TS. TS has 4 extra models (runway_gen4, heygen_avatar, did_studio, synthesia_avatar).

---

## Recommended Priority Order

1. **Phase 8.1 + 8.3** (1.1d) — Unblocks Electron IPC for vimax
2. **`run-pipeline` feature parity** (0.75d) — Confirmation prompt, cost preview, stream propagation
3. **`set-key` security** (0.25d) — Remove plaintext `--value`, add hidden prompt
4. **ViMax agent option gaps** (1d) — Add missing `--views`, `--portraits`, `--style` options
5. **Missing commands** (1.5d) — `delete-key`, `init-project`, `organize-project`, `structure-info`
6. **Test coverage** (0.25d) — `transfer-motion` tests
7. **`get-key --reveal`** (0.1d) — Minor feature addition
