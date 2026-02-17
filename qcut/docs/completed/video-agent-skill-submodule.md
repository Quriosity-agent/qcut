# Video Agent Skill — Git Submodule Integration Plan

**Date**: 2026-02-17
**Repo**: https://github.com/donghaozhang/video-agent-skill
**Goal**: Add `video-agent-skill` as a git submodule so QCut can leverage its 73 AI models, YAML pipelines, and `aicp` CLI directly from the monorepo.
**Status**: **Completed** (2026-02-17)

---

## Context

QCut **already integrates** with the AI Content Pipeline via `electron/ai-pipeline-handler.ts`, which spawns the bundled `aicp` binary. Currently the binary is fetched at build/runtime by `electron/binary-manager.ts`. Adding the source repo as a submodule provides:

- **Editable source** — iterate on models/pipelines without publishing a new binary
- **Shared development** — contributors work on both repos in one workspace
- **Tighter CI** — run `video-agent-skill` tests alongside QCut tests
- **Skill authoring** — expose YAML pipeline templates via QCut's skill system

---

## Task 1 — Add the Git Submodule [DONE]

- [x] Submodule added at `packages/video-agent-skill/` (commit `54f94db`)
- [x] `.gitmodules` created with correct URL, path, and `branch = main`
- [x] `packages/video-agent-skill` listed in CLAUDE.md project structure

---

## Task 2 — Configure Submodule for Development [DONE]

- [x] **2a.** `.gitmodules` pinned to `branch = main`
- [x] **2b.** Convenience scripts in root `package.json`: `aicp:install`, `aicp:test`, `aicp:list-models`, `submodule:init`, `submodule:update`
- [x] **2c.** Turborepo `aicp:test` pipeline entry in `turbo.json`

---

## Task 5 — CI/CD Updates [DONE]

- [x] **5a.** All workflows use `submodules: recursive` (`bun-ci.yml`, `release.yml`, `build-aicp-binaries.yml`)
- [x] **5b.** Python environment setup in CI for `aicp` tests
- [x] **5c.** Binary build coordination via `build-aicp-binaries.yml`

---

## Task 6 — Documentation & Onboarding [DONE]

- [x] **6a.** CLAUDE.md updated with `packages/video-agent-skill/` in project structure
- [x] **6c.** API key mapping documented in CLAUDE.md environment variables section

---

## Task 7 — Unit Tests [DONE]

- [x] **7c.** `scripts/check-submodule.sh` health check script exists

---

## Fix Log

| Date | Issue | Fix |
|------|-------|-----|
| 2026-02-17 | `.gitmodules` was missing — submodule tracked as commit but no URL config for fresh clones | Created `.gitmodules` with correct `path`, `url`, and `branch = main` |
