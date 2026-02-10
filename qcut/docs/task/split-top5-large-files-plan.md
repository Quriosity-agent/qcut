# Implementation Plan: Split Top 5 Largest Files (Reviewed)

**Reviewed:** 2026-02-10
**Goal:** Reduce file size and coupling with no behavior changes.

## Current Top Files (TS/TSX/JS/JSX)

| # | File | Lines | Target | Subtask |
|---|------|------:|--------|---------|
| 1 | `apps/web/src/stores/timeline-store.ts` | 1886 | ~900 + ~986 | [split-1-timeline-store.md](./split-1-timeline-store.md) |
| 2 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | 1876 | ~1050 + ~826 | [split-2-use-ai-generation.md](./split-2-use-ai-generation.md) |
| 3 | `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts` | 1865 | ~200 + ~1665 | [split-3-model-handlers.md](./split-3-model-handlers.md) |
| 4 | `electron/preload.ts` | 1630 | ~790 + ~300 + ~540 | [split-4-preload.md](./split-4-preload.md) |
| 5 | `electron/main.ts` | 1601 | ~600 + ~1001 | [split-5-electron-main.md](./split-5-electron-main.md) |
| 6 | `apps/web/src/components/editor/timeline/index.tsx` | 1584 | Follow-up phase | — |

---

## Execution Order

Execute in this order to minimize risk and maximize independent verification:

| Phase | Subtask | Why This Order |
|-------|---------|---------------|
| **Phase 1** | **#3 model-handlers** | Lowest risk — pure functions, clear boundary, no state |
| **Phase 2** | **#2 use-ai-generation** | Depends on #3 being stable (imports from model-handlers) |
| **Phase 3** | **#1 timeline-store** | Independent of #2/#3; core store needs careful testing |
| **Phase 4** | **#5 electron/main** | IPC handlers independent of frontend splits |
| **Phase 5** | **#4 electron/preload** | Highest risk — must verify every API group at runtime |

Each phase is one commit. Do not start the next phase until verification passes.

---

## Corrections From Previous Plan

1. Replace `timeline/index.tsx` in top-5 with `electron/main.ts`.
2. Do not split `handleGenerate` in `use-ai-generation.ts` into "first half/second half" across files — instead extract pure helpers.
3. In `model-handlers.ts`, keep model families accurate: `handleWAN26T2V` is text-to-video, not image-to-video.
4. In `preload.ts`, avoid A↔B type/runtime cycles by extracting shared types first.

---

## New Files Created (Summary)

| Subtask | New File(s) |
|---------|-------------|
| #1 | `apps/web/src/stores/timeline-store-operations.ts` |
| #2 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation-helpers.ts` |
| #3 | `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handler-implementations.ts` |
| #4 | `electron/preload-types.ts`, `electron/preload-integrations.ts` |
| #5 | `electron/main-ipc.ts` |

---

## Verification Checklist (Per Phase)

1. Create new file(s), move code, keep exports and channel names stable.
2. Run `bun run check-types`.
3. Run focused tests for touched area:
   - `bun x vitest run apps/web/src/stores/__tests__/timeline-store.test.ts`
   - `bun x vitest run electron/__tests__/release-notes-handler.test.ts`
4. Run `bun lint:clean`.
5. Smoke test app boot: `bun run electron:dev`.

## Risk Checklist

| Risk | Mitigation |
|------|------------|
| Circular imports | Shared types in dedicated files; one-directional imports only |
| Store behavior regression | Preserve store API shape; use dependency-injected operations module |
| IPC contract breakage | Keep channel strings unchanged; only move registration location |
| Preload API drift | Keep `ElectronAPI` source of truth centralized in `preload-types.ts` |

## Follow-Up (Phase 2 — Not in Scope)

### `timeline/index.tsx` (1584 lines)

- Move `TimelineToolbar` + `TrackIcon` to `timeline-toolbar.tsx`.
- This remains a good follow-up task, just not top-5 anymore.
