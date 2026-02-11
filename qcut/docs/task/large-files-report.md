# Large Files Report (>800 lines)

Generated: 2026-02-11 (updated after split-v2 phases)

## Summary

**Total files exceeding 800 lines:** 37

Previous report had 39 files. The decrease is from split-v2 completing Phase 1 (text2image-models) and Phase 3 (fal-ai-client), which brought both files under 800. Phase 4 (use-ai-generation) was partial — reduced from 1428 → 1082 but still over the limit.

### Split Plan v2 Impact

| Phase | File | Before | After | Status |
|-------|------|--------|-------|--------|
| Phase 1 | `text2image-models.ts` | 1422 | ~91 barrel + split dir | **Done** — removed from list |
| Phase 2 | `model-handler-implementations.ts` | 1518 | 1518 | **Not started** |
| Phase 3 | `fal-ai-client.ts` | 1512 | 647 | **Done** — removed from list |
| Phase 4 | `use-ai-generation.ts` | 1428 | 1082 | **Partial** — still >800 |
| Phase 5 | `timeline/index.tsx` | 1584 | 1584 | **Not started** |

## Files by Line Count

| Lines | File | Category | Notes |
|------:|------|----------|-------|
| 1584 | `apps/web/src/components/editor/timeline/index.tsx` | Timeline UI | Split v2 Phase 5 — not started |
| 1518 | `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handler-implementations.ts` | AI Generation | Split v2 Phase 2 — not started |
| 1404 | `apps/web/src/lib/export-engine.ts` | Export | |
| 1325 | `apps/web/src/lib/image-edit-client.ts` | AI Client | |
| 1315 | `apps/web/src/types/electron.d.ts` | Type Definitions | |
| 1310 | `electron/ffmpeg-handler.ts` | Electron / FFmpeg | |
| 1283 | `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-image-tab.tsx` | AI UI | |
| 1270 | `apps/web/src/components/editor/media-panel/views/ai/index.tsx` | AI UI | |
| 1259 | `apps/web/src/lib/ai-video/generators/image-to-video.ts` | AI Generation | |
| 1226 | `apps/web/src/components/editor/timeline/timeline-track.tsx` | Timeline UI | |
| 1179 | `apps/web/src/components/editor/preview-panel.tsx` | Editor UI | |
| 1157 | `apps/web/src/stores/media-store.ts` | State Management | |
| 1132 | `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx` | Drawing Canvas | |
| 1087 | `apps/web/src/lib/export-engine.backup.ts` | Export (backup) | Consider removing |
| 1082 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | AI Generation | Split v2 Phase 4 — partial |
| 1047 | `apps/web/src/stores/timeline-store-operations.ts` | State Management | From split v1 |
| 983 | `apps/web/src/lib/remotion/component-loader.ts` | Remotion | |
| 974 | `apps/web/src/test/e2e/project-folder-sync.e2e.ts` | Tests | |
| 957 | `apps/web/src/lib/remotion/__tests__/component-validator.test.ts` | Tests | |
| 956 | `apps/web/src/lib/ai-video/validation/validators.ts` | AI Validation | |
| 956 | `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts` | AI Types | |
| 947 | `electron/ffmpeg/utils.ts` | Electron / FFmpeg | |
| 946 | `apps/web/src/stores/timeline-store.ts` | State Management | Reduced from 1660 (split v1) |
| 918 | `apps/web/src/stores/remotion-store.ts` | State Management | |
| 903 | `apps/web/src/lib/ffmpeg-utils.ts` | FFmpeg Utils | |
| 900 | `apps/web/src/lib/export-engine-cli.ts` | Export | |
| 884 | `electron/main-ipc.ts` | Electron | From split v1 |
| 869 | `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts` | AI Models Config | |
| 866 | `apps/web/src/test/e2e/helpers/electron-helpers.ts` | Tests | |
| 866 | `apps/web/src/lib/ai-video/generators/text-to-video.ts` | AI Generation | |
| 852 | `apps/web/src/stores/effects-store.ts` | State Management | |
| 840 | `apps/web/src/test/e2e/auto-save-export-file-management.e2e.ts` | Tests | |
| 829 | `apps/web/src/components/editor/draw/hooks/use-canvas-objects.ts` | Drawing Canvas | |
| 826 | `electron/ai-pipeline-handler.ts` | Electron | |
| 826 | `apps/web/src/lib/effects-templates.ts` | Effects | |
| 818 | `apps/web/src/components/export-dialog.tsx` | Editor UI | |
| 801 | `apps/web/src/components/editor/media-panel/views/captions.tsx` | Editor UI | |

## Breakdown by Category

| Category | Files | Total Lines |
|----------|------:|------------:|
| AI Generation / UI / Config | 11 | ~12,286 |
| State Management | 5 | ~4,920 |
| Electron | 4 | ~3,967 |
| Export | 3 | ~3,391 |
| Tests | 4 | ~3,637 |
| Timeline UI | 2 | ~2,810 |
| Editor UI | 3 | ~2,798 |
| Drawing Canvas | 2 | ~1,961 |
| Type Definitions | 1 | 1,315 |
| Remotion | 1 | 983 |
| FFmpeg Utils | 1 | 903 |
| Effects | 1 | 826 |

## Notes

- `export-engine.backup.ts` (1087 lines) appears to be a backup file — consider removing if no longer needed.
- AI subsystem under `media-panel/views/ai/` remains the most complex area with the highest concentration of large files.
- `use-ai-generation.ts` (1082 lines) still needs further extraction — settings builders and response handlers were not fully moved to helpers file.
- `model-handler-implementations.ts` (1518 lines) needs split into 4 handler category files (T2V, I2V, avatar, upscale).
- `timeline/index.tsx` (1584 lines) is the largest file and next split candidate.
- Several test/e2e files (974, 957, 866, 840 lines) are over 800 — less critical since they don't affect runtime, but worth noting.
- `fal-ai-client.ts` and `text2image-models.ts` were successfully removed from this list by split-v2 Phases 1 and 3.
