# Large Files Report (>800 lines)

Generated: 2026-02-12 (updated after split-v3 phases 1–5)

## Summary

**Total files exceeding 800 lines:** 32

Previous report had 36 files. The decrease is from split-v3 completing:
- **Phase 1** (image-edit-client): 1325 → 793 — removed from list
- **Phase 2** (ai-image-tab): 1283 → 491 — removed from list
- **Phase 4** (export-engine): 1404 → 641 — removed from list
- **Phase 5** (ffmpeg-handler): 1310 → 96 — removed from list

Additionally, `timeline/index.tsx` was reduced from 1584 → 860 by a separate extraction (`d652c7fc`).

### Split Plan v3 Impact

| Phase | File | Before | After | Status |
|-------|------|-------:|------:|--------|
| Phase 1 | `image-edit-client.ts` | 1325 | 793 | **Done** — removed from list |
| Phase 2 | `ai-image-tab.tsx` | 1283 | 491 | **Done** — removed from list |
| Phase 3 | `ai/index.tsx` | 1281 | 979 | **Partial** — still >800 |
| Phase 4 | `export-engine.ts` | 1404 | 641 | **Done** — removed from list |
| Phase 5 | `ffmpeg-handler.ts` | 1310 | 96 | **Done** — removed from list |

### Split Plan v2 Impact (prior round)

| Phase | File | Before | After | Status |
|-------|------|-------:|------:|--------|
| Phase 1 | `text2image-models.ts` | 1422 | ~91 barrel | **Done** — removed from list |
| Phase 2 | `model-handler-implementations.ts` | 1518 | 10 (shim) | **Done** — removed from list |
| Phase 3 | `fal-ai-client.ts` | 1512 | 656 | **Done** — removed from list |
| Phase 4 | `use-ai-generation.ts` | 1428 | 1082 | **Partial** — still >800 |
| Phase 5 | `timeline/index.tsx` | 1584 | 860 | **Done** — reduced via separate extraction |

## Files by Line Count

| Lines | File | Category | Notes |
|------:|------|----------|-------|
| 1315 | `apps/web/src/types/electron.d.ts` | Type Definitions | |
| 1259 | `apps/web/src/lib/ai-video/generators/image-to-video.ts` | AI Generation | |
| 1226 | `apps/web/src/components/editor/timeline/timeline-track.tsx` | Timeline UI | |
| 1180 | `apps/web/src/components/editor/preview-panel.tsx` | Editor UI | |
| 1157 | `apps/web/src/stores/media-store.ts` | State Management | |
| 1132 | `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx` | Drawing Canvas | |
| 1088 | `apps/web/src/lib/export-engine.backup.ts` | Export (backup) | Should be deleted |
| 1082 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | AI Generation | Split v2 Phase 4 — partial |
| 1047 | `apps/web/src/stores/timeline-store-operations.ts` | State Management | From split v1 |
| 983 | `apps/web/src/lib/remotion/component-loader.ts` | Remotion | |
| 979 | `apps/web/src/components/editor/media-panel/views/ai/index.tsx` | AI UI | Split v3 Phase 3 — partial |
| 974 | `apps/web/src/test/e2e/project-folder-sync.e2e.ts` | Tests | |
| 957 | `apps/web/src/lib/remotion/__tests__/component-validator.test.ts` | Tests | |
| 956 | `apps/web/src/lib/ai-video/validation/validators.ts` | AI Validation | |
| 956 | `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts` | AI Types | |
| 947 | `electron/ffmpeg/utils.ts` | Electron / FFmpeg | |
| 946 | `apps/web/src/stores/timeline-store.ts` | State Management | Reduced from 1660 (split v1) |
| 921 | `apps/web/src/lib/export-engine-cli.ts` | Export | Created during v3 Phase 4 |
| 918 | `apps/web/src/stores/remotion-store.ts` | State Management | |
| 903 | `apps/web/src/lib/ffmpeg-utils.ts` | FFmpeg Utils | |
| 884 | `electron/main-ipc.ts` | Electron | From split v1 |
| 869 | `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts` | AI Models Config | |
| 866 | `apps/web/src/test/e2e/helpers/electron-helpers.ts` | Tests | |
| 866 | `apps/web/src/lib/ai-video/generators/text-to-video.ts` | AI Generation | |
| 860 | `apps/web/src/components/editor/timeline/index.tsx` | Timeline UI | Reduced from 1584 |
| 852 | `apps/web/src/stores/effects-store.ts` | State Management | |
| 840 | `apps/web/src/test/e2e/auto-save-export-file-management.e2e.ts` | Tests | |
| 829 | `apps/web/src/components/editor/draw/hooks/use-canvas-objects.ts` | Drawing Canvas | |
| 826 | `electron/ai-pipeline-handler.ts` | Electron | |
| 826 | `apps/web/src/lib/effects-templates.ts` | Effects | |
| 816 | `apps/web/src/components/export-dialog.tsx` | Editor UI | |
| 801 | `apps/web/src/components/editor/media-panel/views/captions.tsx` | Editor UI | |

## Breakdown by Category

| Category | Files | Total Lines |
|----------|------:|------------:|
| AI Generation / UI / Config | 8 | ~8,988 |
| State Management | 5 | ~4,920 |
| Electron | 3 | ~2,657 |
| Tests | 4 | ~3,637 |
| Timeline UI | 2 | ~2,086 |
| Editor UI | 3 | ~2,797 |
| Export | 2 | ~2,009 |
| Drawing Canvas | 2 | ~1,961 |
| Type Definitions | 1 | 1,315 |
| Remotion | 1 | 983 |
| FFmpeg Utils | 1 | 903 |
| Effects | 1 | 826 |

## Notes

- `export-engine.backup.ts` (1088 lines) is a backup file from the v3 Phase 4 refactor — should be deleted now that the refactor is stable.
- AI subsystem under `media-panel/views/ai/` remains the most complex area with the highest concentration of large files.
- `use-ai-generation.ts` (1082 lines) still needs further extraction — settings builders and response handlers were not fully moved.
- `ai/index.tsx` (979 lines) was reduced by v3 Phase 3 but still exceeds 800 — needs a follow-up pass.
- `export-engine-cli.ts` (921 lines) was created during v3 Phase 4 and already exceeds 800 — should be split.
- Several test/e2e files (974, 957, 866, 840 lines) are over 800 — less critical since they don't affect runtime.
- Top split candidates for a future round: `image-to-video.ts` (1259), `timeline-track.tsx` (1226), `preview-panel.tsx` (1180), `media-store.ts` (1157), `drawing-canvas.tsx` (1132).
