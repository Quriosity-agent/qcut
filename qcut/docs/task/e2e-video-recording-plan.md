# E2E Video Recording Plan

**Date:** 2026-02-21  
**Owner:** QA / Platform

## Goal

Record video artifacts for every Playwright E2E execution and keep generated video files out of git.

## Context From `e2e-test-plan.md`

- E2E framework is Playwright + Electron.
- Test root is `apps/web/src/test/e2e/`.
- Current main command is `bun run test:e2e`.
- Current config is `video: "retain-on-failure"` in `playwright.config.ts`.
- Latest run summary in `docs/task/e2e-test-plan.md` is stable, so this change should not alter test logic, only artifact behavior.

## Scope

This implementation covers all files matching `apps/web/src/test/e2e/**/*.e2e.ts`, including workflow, overlays, AI, terminal, remotion, sync, and debug E2E files documented in `docs/task/e2e-test-plan.md`.

## Detailed Implementation

### 1) Always record video for all E2E tests

**File:** `playwright.config.ts`

- Update Playwright `use.video` from:
  - `"retain-on-failure"`
- To:
  - `"on"`

Keep these unchanged:
- `workers: 1`
- `fullyParallel: false`
- `trace: "on-first-retry"`
- `screenshot: "only-on-failure"`
- `testDir`, `testMatch`, and `testIgnore`

This keeps behavior stable while only changing recording policy.

### 2) Route videos to a dedicated folder

Playwright stores videos in the artifact output tree (`outputDir`). To satisfy the dedicated folder requirement, add a post-run collector.

**New file:** `scripts/collect-e2e-videos.ts`

Implementation details:
- Recursively scan `docs/completed/test-results-raw/` for `*.webm`.
- Create destination `docs/completed/e2e-videos/<run-timestamp>/`.
- Move or copy videos preserving unique test-based names.
- Wrap filesystem operations in `try-catch`.
- Exit with non-zero status only on true collector failure.

### 3) Keep existing default command behavior, add video-focused command

**File:** `package.json`

Recommended scripts:
- Keep `test:e2e` as `playwright test` for compatibility.
- Add:
  - `test:e2e:record`: runs Playwright and then runs the collector script.

Example flow:
1. `playwright test` writes raw artifacts.
2. `scripts/collect-e2e-videos.ts` moves/copies `.webm` into `docs/completed/e2e-videos/<timestamp>/`.

### 4) Ignore video folder in git

**File:** `.gitignore`

Add:
- `docs/completed/e2e-videos/`

`docs/completed/test-results-raw/` is already ignored, but this explicit rule ensures the dedicated video path is always excluded.

### 5) Update testing documentation

**File:** `docs/technical/testing/e2e.md`

Update:
- Config snippet to show `video: "on"`.
- Add command section for `bun run test:e2e:record`.
- Add artifact notes for `docs/completed/e2e-videos/`.

## Subtasks

### Subtask 1: Playwright config update

- Edit `playwright.config.ts`.
- Confirm no non-video setting changes.

### Subtask 2: Video collector script

- Add `scripts/collect-e2e-videos.ts` with robust `try-catch` error handling.
- Validate path creation and recursive scan logic.

### Subtask 3: Script wiring

- Add `test:e2e:record` to `package.json`.
- Keep existing scripts untouched unless explicitly requested.

### Subtask 4: Git ignore and docs update

- Add ignore rule in `.gitignore`.
- Update `docs/technical/testing/e2e.md`.

### Subtask 5: Verification

Run:
- `bun run test:e2e -- apps/web/src/test/e2e/simple-navigation.e2e.ts`
- `playwright test apps/web/src/test/e2e/simple-navigation.e2e.ts && bun run scripts/collect-e2e-videos.ts`

Validate:
- Raw artifacts exist in `docs/completed/test-results-raw/`.
- Videos exist in `docs/completed/e2e-videos/<timestamp>/`.
- `git status` does not list files from `docs/completed/e2e-videos/`.
- E2E pass/fail behavior is unchanged.

## Acceptance Criteria

- All E2E tests record video, not only failed tests.
- A dedicated `docs/completed/e2e-videos/` folder is produced by the record flow.
- `docs/completed/e2e-videos/` is ignored by git.
- Existing E2E test stability and outcomes remain unchanged.

## Risks and Mitigation

- Risk: Increased runtime and disk usage.
  - Mitigation: Keep `test:e2e` as-is and use `test:e2e:record` when full video artifacts are needed.
- Risk: Collector script fails after successful tests.
  - Mitigation: Strict `try-catch` with clear error logs and deterministic exit status.
- Risk: CI artifact bloat.
  - Mitigation: Add retention/cleanup in CI workflow if enabled there.

## Implementation Status (2026-02-21)

Implemented changes:
- `playwright.config.ts`: set `use.video` to `on` for all E2E tests.
- `scripts/collect-e2e-videos.ts`: added artifact collector to copy `.webm` files from `docs/completed/test-results-raw/` into timestamped runs under `docs/completed/e2e-videos/`.
- `scripts/run-e2e-record.ts`: added orchestrator script that runs Playwright tests and then runs the collector.
- `package.json`: added `test:e2e:record` script.
- `.gitignore`: added `docs/completed/e2e-videos/`.
- `docs/technical/testing/e2e.md`: updated commands, config snippet, artifact behavior, and paths.

Validation run:
- `bunx tsc --noEmit -p scripts/tsconfig.json`
- `bun scripts/collect-e2e-videos.ts`
- `bun run test:e2e:record -- --list`
