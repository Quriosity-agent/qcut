# Split Top 5 Large Files — Round 3: Overview

**Created:** 2026-02-11
**Goal:** Reduce all remaining >800-line files to <800 lines with zero behavior changes.
**Predecessor:** [split-top5-large-files-plan-v2.md](./split-top5-large-files-plan-v2.md)

## Task Files

Each phase has its own implementation task file:

| Phase | Task File | Target File | Lines | Est. Time |
|-------|-----------|-------------|------:|-----------|
| 1 | [split-v3-phase1-image-edit-client.md](./split-v3-phase1-image-edit-client.md) | `image-edit-client.ts` | 1325 | ~25 min |
| 2 | [split-v3-phase2-ai-image-tab.md](./split-v3-phase2-ai-image-tab.md) | `ai-image-tab.tsx` | 1283 | ~35 min |
| 3 | [split-v3-phase3-ai-index.md](./split-v3-phase3-ai-index.md) | `ai/index.tsx` | 1281 | ~30 min |
| 4 | [split-v3-phase4-export-engine.md](./split-v3-phase4-export-engine.md) | `export-engine.ts` | 1404 | ~40 min |
| 5 | [split-v3-phase5-ffmpeg-handler.md](./split-v3-phase5-ffmpeg-handler.md) | `ffmpeg-handler.ts` | 1310 | ~45 min |

## Execution Rules

1. **Sequential execution** — complete Phase N before starting Phase N+1.
2. **One commit per phase** — each phase is atomic and independently verifiable.
3. **No behavior changes** — pure refactor, all public APIs stay identical.
4. **Verification per phase:**
   - `bun run check-types` passes
   - `bun lint:clean` passes
   - `bun run test` passes (affected tests)
   - Smoke test: `bun run electron:dev` — affected features work

## Risk Summary

| Phase | Risk | Reason |
|-------|------|--------|
| 1 | Low | Pure data + independent polling module |
| 2 | Low-Medium | 7 independent model components, no shared state |
| 3 | Medium | Hook extraction with dependency management |
| 4 | Medium-High | Class method extraction, shared canvas/ctx state |
| 5 | High | IPC handler registration, dual CJS/ESM, Electron context |
