# Implementation Plan: Split Top 5 Large Files — Round 4

**Created:** 2026-02-15
**Goal:** Reduce the 5 largest files (1228-1420 lines) to <800 lines each with zero behavior changes.
**Predecessor:** [split-v3-overview.md](./split-v3-overview.md) (all 5 phases complete)

## Pre-Work: Cleanup

- [ ] Delete `apps/web/src/lib/export-engine.backup.ts` (1088 lines) — leftover from v3 Phase 4, flagged for removal since 2026-02-12.

## Current Top 5 Files

| # | File | Lines | Phase | Est. Time |
|---|------|------:|-------|-----------|
| 1 | `electron/ai-pipeline-handler.ts` | 1420 | [Phase 1](./split-v4-phase1-ai-pipeline-handler.md) | ~30 min |
| 2 | `apps/web/src/components/editor/timeline/timeline-track.tsx` | 1324 | [Phase 2](./split-v4-phase2-timeline-track.md) | ~40 min |
| 3 | `apps/web/src/lib/export-engine-cli.ts` | 1292 | [Phase 3](./split-v4-phase3-export-engine-cli.md) | ~30 min |
| 4 | `apps/web/src/lib/ai-video/generators/image-to-video.ts` | 1259 | [Phase 4](./split-v4-phase4-image-to-video.md) | ~20 min |
| 5 | `apps/web/src/components/editor/preview-panel.tsx` | 1228 | [Phase 5](./split-v4-phase5-preview-panel.md) | ~35 min |

### Selection Rationale

These are the **5 largest files** in the codebase. Unlike v4-draft which deferred complex files, this round tackles them head-on because:
- `ai-pipeline-handler.ts` grew +594 lines since last report — largest file, needs immediate attention
- `export-engine-cli.ts` grew +371 lines — rapidly expanding, split prevents further bloat
- `timeline-track.tsx` and `preview-panel.tsx` are the largest UI components — extracting sub-components and hooks reduces cognitive load
- `image-to-video.ts` has 12 independent generator functions — cleanest split of the batch

---

## Execution Order

| Phase | File | Why This Order | Risk |
|-------|------|---------------|------|
| **Phase 1** | `ai-pipeline-handler.ts` | Electron-side, no UI risk. Clear extraction boundaries (output parsing, IPC registration). | Low |
| **Phase 2** | `timeline-track.tsx` | Extract drop handlers (self-contained). Drag effect stays in main file. | Medium |
| **Phase 3** | `export-engine-cli.ts` | Extract audio pipeline + electron bridge. Class stays intact. | Low-Medium |
| **Phase 4** | `image-to-video.ts` | 12 independent generators grouped by model family. Lowest risk of the batch. | Low |
| **Phase 5** | `preview-panel.tsx` | Extract hooks and render helpers. Most complex due to 6 store dependencies. | Medium-High |

Each phase is one commit. Do not start the next phase until verification passes.

---

## New Files Created (Summary)

| Phase | New File(s) | Lines Moved |
|-------|-------------|-------------|
| Pre | (delete `export-engine.backup.ts`) | -1088 |
| #1 | `electron/ai-pipeline-output.ts`, `electron/ai-pipeline-ipc.ts` | ~420 |
| #2 | `timeline/timeline-track-drop-handlers.ts`, `timeline/timeline-track-utils.ts` | ~560 |
| #3 | `lib/export-engine-cli-audio.ts`, `lib/export-engine-cli-utils.ts` | ~420 |
| #4 | `generators/kling-generators.ts`, `wan-generators.ts`, `vidu-generators.ts`, `misc-generators.ts` | ~960 |
| #5 | `preview-panel/use-preview-sizing.ts`, `preview-panel/use-preview-media.ts`, `preview-panel/preview-element-renderer.tsx` | ~580 |

**Total new files:** 12 (+ 1 deletion)

---

## Expected Results

| File | Before | After | Target |
|------|-------:|------:|-------:|
| `ai-pipeline-handler.ts` | 1420 | ~750 | <800 |
| `timeline-track.tsx` | 1324 | ~720 | <800 |
| `export-engine-cli.ts` | 1292 | ~780 | <800 |
| `image-to-video.ts` | 1259 | ~300 | <800 |
| `preview-panel.tsx` | 1228 | ~650 | <800 |

---

## Verification Checklist (Per Phase)

1. Create new file(s), move code, keep exports stable.
2. Run `bun check-types` — must pass with zero errors.
3. Run `bun lint:clean` — must pass.
4. Run `bun run test` — no regressions.
5. Smoke test: `bun run electron:dev` — verify affected features work.

## Risk Checklist

| Risk | Mitigation |
|------|------------|
| Circular imports | One-directional: new files import shared utils, parent re-exports |
| Barrel re-export perf | Keep barrels thin — only re-export public API |
| Electron IPC breakage | IPC handler names are strings, not refactored — safe to move |
| UI rendering changes | Extract render helpers, not state — visual output unchanged |
| Store hook coupling | Hooks stay in main component, only pure logic extracted |
| Drop handler coupling | Pass required state as parameters, not closures |

---

## Remaining Deferred Files (Candidates for v5)

After v4, these files still exceed 800 lines:

| File | Lines | Why Deferred |
|------|------:|-------------|
| `electron.d.ts` | 1341 | Type-only file, low impact |
| `timeline-store-operations.ts` | 1171 | Medium complexity, dependency injection pattern |
| `media-store.ts` | 1157 | Cross-store deps, circular import risk |
| `drawing-canvas.tsx` | 1132 | forwardRef + imperative handle coupling |
| `use-ai-generation.ts` | 1082 | 166 destructured props, tightly coupled hooks |
| `timeline-store.ts` | 1048 | Core store, auto-save timers, history management |
| `ffmpeg/utils.ts` | 1003 | Platform-specific path resolution |
| `component-loader.ts` | 983 | IndexedDB + Electron IPC |
| `ai/index.tsx` | 979 | Already split in v3, diminishing returns |
