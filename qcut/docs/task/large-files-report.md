# Large Files Report (>800 lines)

Generated: 2026-02-15

## Summary

**Total files exceeding 800 lines:** 33

Previous report (2026-02-12) had 32 files. One new file crossed the threshold (`preload-types.ts` at 810), and several existing files grew significantly.

### Changes Since Last Report

| File | Before | After | Delta | Notes |
|------|-------:|------:|------:|-------|
| `electron/ai-pipeline-handler.ts` | 826 | 1420 | **+594** | Jumped from #26 to #1 |
| `export-engine-cli.ts` | 921 | 1292 | **+371** | Needs urgent split |
| `timeline-store-operations.ts` | 1047 | 1171 | +124 | |
| `timeline-store.ts` | 946 | 1048 | +102 | Crossed 1000-line mark |
| `timeline-track.tsx` | 1226 | 1324 | +98 | |
| `electron/ffmpeg/utils.ts` | 947 | 1003 | +56 | Crossed 1000-line mark |
| `preview-panel.tsx` | 1180 | 1228 | +48 | |
| `electron.d.ts` | 1315 | 1341 | +26 | |
| `electron/preload-types.ts` | — | 810 | **new** | Newly over threshold |

`export-engine.backup.ts` (1088 lines) is still present despite being marked for deletion in the previous report.

## Files by Line Count

| Lines | File | Category | Notes |
|------:|------|----------|-------|
| 1420 | `electron/ai-pipeline-handler.ts` | Electron | Grew +594 since last report |
| 1341 | `apps/web/src/types/electron.d.ts` | Type Definitions | |
| 1324 | `apps/web/src/components/editor/timeline/timeline-track.tsx` | Timeline UI | |
| 1292 | `apps/web/src/lib/export-engine-cli.ts` | Export | Grew +371 since last report |
| 1259 | `apps/web/src/lib/ai-video/generators/image-to-video.ts` | AI Generation | |
| 1228 | `apps/web/src/components/editor/preview-panel.tsx` | Editor UI | |
| 1171 | `apps/web/src/stores/timeline-store-operations.ts` | State Management | |
| 1157 | `apps/web/src/stores/media-store.ts` | State Management | |
| 1132 | `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx` | Drawing Canvas | |
| 1088 | `apps/web/src/lib/export-engine.backup.ts` | Export (backup) | Should be deleted |
| 1082 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | AI Generation | Split v2 Phase 4 — partial |
| 1048 | `apps/web/src/stores/timeline-store.ts` | State Management | Was 946, grew +102 |
| 1003 | `electron/ffmpeg/utils.ts` | Electron / FFmpeg | Was 947, grew +56 |
| 983 | `apps/web/src/lib/remotion/component-loader.ts` | Remotion | |
| 979 | `apps/web/src/components/editor/media-panel/views/ai/index.tsx` | AI UI | Split v3 Phase 3 — partial |
| 974 | `apps/web/src/test/e2e/project-folder-sync.e2e.ts` | Tests | |
| 957 | `apps/web/src/lib/remotion/__tests__/component-validator.test.ts` | Tests | |
| 956 | `apps/web/src/lib/ai-video/validation/validators.ts` | AI Validation | |
| 956 | `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts` | AI Types | |
| 918 | `apps/web/src/stores/remotion-store.ts` | State Management | |
| 903 | `apps/web/src/lib/ffmpeg-utils.ts` | FFmpeg Utils | |
| 884 | `electron/main-ipc.ts` | Electron | |
| 876 | `apps/web/src/test/e2e/helpers/electron-helpers.ts` | Tests | |
| 869 | `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts` | AI Models Config | |
| 866 | `apps/web/src/lib/ai-video/generators/text-to-video.ts` | AI Generation | |
| 853 | `apps/web/src/components/editor/timeline/index.tsx` | Timeline UI | |
| 852 | `apps/web/src/stores/effects-store.ts` | State Management | |
| 840 | `apps/web/src/test/e2e/auto-save-export-file-management.e2e.ts` | Tests | |
| 829 | `apps/web/src/components/editor/draw/hooks/use-canvas-objects.ts` | Drawing Canvas | |
| 826 | `apps/web/src/lib/effects-templates.ts` | Effects | |
| 817 | `apps/web/src/components/export-dialog.tsx` | Editor UI | |
| 810 | `electron/preload-types.ts` | Electron | Newly over threshold |
| 801 | `apps/web/src/components/editor/media-panel/views/captions.tsx` | Editor UI | |

## Breakdown by Category

| Category | Files | Total Lines |
|----------|------:|------------:|
| AI Generation / UI / Config | 8 | ~8,988 |
| State Management | 5 | ~5,146 |
| Electron | 4 | ~4,117 |
| Tests | 4 | ~3,647 |
| Editor UI | 3 | ~2,846 |
| Export | 2 | ~2,380 |
| Timeline UI | 2 | ~2,177 |
| Drawing Canvas | 2 | ~1,961 |
| Type Definitions | 1 | 1,341 |
| Remotion | 1 | 983 |
| FFmpeg Utils | 1 | 903 |
| Effects | 1 | 826 |
| Export (backup) | 1 | 1,088 |

## Top Priority Actions

1. **Delete** `export-engine.backup.ts` (1088 lines) — still present, was flagged for removal last report.
2. **Split** `ai-pipeline-handler.ts` (1420 lines) — grew +594 lines, now the largest file in the project.
3. **Split** `export-engine-cli.ts` (1292 lines) — grew +371 lines, rapidly expanding.
4. **Split** `timeline-track.tsx` (1324 lines) — large UI component, good candidate for extracting sub-components.
5. **Split** `image-to-video.ts` (1259 lines) — stable but well over limit.
6. **Split** `preview-panel.tsx` (1228 lines) — large editor UI component.

## Notes

- The Electron layer is the fastest-growing area: `ai-pipeline-handler.ts` (+594) and `preload-types.ts` (newly over 800) both landed since the last report.
- `export-engine-cli.ts` grew +371 lines — the export subsystem needs attention.
- `timeline-store.ts` (1048) and `timeline-store-operations.ts` (1171) are both over 1000 lines — the combined timeline state is over 2200 lines across two files.
- AI subsystem under `media-panel/views/ai/` remains the most complex area with 8 files totaling ~9000 lines.
- `use-ai-generation.ts` (1082) and `ai/index.tsx` (979) still need follow-up splits from v2/v3.
- Test/e2e files (974, 957, 876, 840 lines) are over 800 — less critical since they don't affect runtime.
- 13 files are now over 1000 lines (up from 10 in the previous report).
