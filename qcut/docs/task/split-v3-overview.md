# Split Top 5 Large Files — Round 3: Overview

**Created:** 2026-02-11
**Completed:** 2026-02-12
**Status:** All 5 phases completed
**Goal:** Reduce all remaining >800-line files to <800 lines with zero behavior changes.

## Results

| Phase | Target File | Before | After | Status | Commit |
|-------|-------------|-------:|------:|--------|--------|
| 1 | `image-edit-client.ts` | 1325 | 716 | Done | `53efb8d9` |
| 2 | `ai-image-tab.tsx` | 1283 | 464 | Done | `776c546e` |
| 3 | `ai/index.tsx` | 1281 | 935 | Done (see note) | `6f5900af` |
| 4 | `export-engine.ts` | 1404 | 542 | Done | `237aa647` |
| 5 | `ffmpeg-handler.ts` | 1310 | 83 | Done | `05af141e` |

### Extracted Modules

**Phase 1** — `apps/web/src/lib/`:
- `image-edit-client.ts` (716 lines, main)
- Extracted polling, data, and utility modules

**Phase 2** — `apps/web/src/components/editor/media-panel/views/ai/tabs/`:
- `ai-image-tab.tsx` (464 lines, main)
- 7 model settings components extracted

**Phase 3** — `apps/web/src/components/editor/media-panel/views/ai/`:
- `index.tsx` (935 lines, main)
- Extracted hooks and components

**Phase 4** — `apps/web/src/lib/`:
- `export-engine.ts` (542 lines, main)
- `export-engine-utils.ts` (120 lines)
- `export-engine-debug.ts` (76 lines)
- `export-engine-recorder.ts` (113 lines)
- `export-engine-renderer.ts` (422 lines)

**Phase 5** — `electron/`:
- `ffmpeg-handler.ts` (83 lines, orchestrator)
- `ffmpeg-args-builder.ts` (254 lines)
- `ffmpeg-basic-handlers.ts` (108 lines)
- `ffmpeg-export-handler.ts` (690 lines)
- `ffmpeg-utility-handlers.ts` (284 lines)

## Known Remaining Issues

1. **`ai/index.tsx` (935 lines)** — Phase 3 extraction reduced it from 1281 but it still exceeds the 800-line limit. Needs a follow-up round.
2. **`export-engine-cli.ts` (831 lines)** — Pre-existing file not part of the original plan, but exceeds 800 lines. Consider splitting in a future pass.
3. **`export-engine.backup.ts` (927 lines)** — Backup file from Phase 4. Should be deleted once the refactor is stable.
