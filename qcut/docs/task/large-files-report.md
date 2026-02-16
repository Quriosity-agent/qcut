# Large Files Report (>800 lines)

Generated: 2026-02-16

## Summary

**Total files exceeding 800 lines:** 31

Previous report (2026-02-15) had 33 files. Two files dropped below 800 due to splits (`preview-panel.tsx` 1228→718, `image-to-video.ts` 1259→178). `ai-pipeline-handler.ts` dropped from 1420→940 after extracting output/IPC modules.

### Changes Since Last Report

| File | Before | After | Delta | Notes |
|------|-------:|------:|------:|-------|
| `electron/ai-pipeline-handler.ts` | 1420 | 940 | **-480** | Split into handler + output + IPC |
| `apps/web/src/lib/ai-video/generators/image-to-video.ts` | 1259 | 178 | **-1081** | Split into per-provider generators |
| `apps/web/src/components/editor/preview-panel.tsx` | 1228 | 718 | **-510** | Dropped below threshold |
| `apps/web/src/lib/export-engine-cli.ts` | 1292 | 1030 | **-262** | Reduced via extraction |
| `apps/web/src/types/electron.d.ts` | 1341 | 1348 | +7 | |
| `electron/preload-types.ts` | 810 | 817 | +7 | |
| `apps/web/src/components/editor/timeline/index.tsx` | 853 | 856 | +3 | |

`export-engine.backup.ts` (1088 lines) is still present despite being flagged for deletion in two previous reports.

## Files by Line Count

| Lines | File | Category | Notes |
|------:|------|----------|-------|
| 1348 | `apps/web/src/types/electron.d.ts` | Type Definitions | |
| 1324 | `apps/web/src/components/editor/timeline/timeline-track.tsx` | Timeline UI | |
| 1171 | `apps/web/src/stores/timeline-store-operations.ts` | State Management | |
| 1157 | `apps/web/src/stores/media-store.ts` | State Management | |
| 1132 | `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx` | Drawing Canvas | |
| 1088 | `apps/web/src/lib/export-engine.backup.ts` | Export (backup) | Should be deleted |
| 1082 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | AI Generation | |
| 1048 | `apps/web/src/stores/timeline-store.ts` | State Management | |
| 1030 | `apps/web/src/lib/export-engine-cli.ts` | Export | Down from 1292 |
| 1003 | `electron/ffmpeg/utils.ts` | Electron / FFmpeg | |
| 983 | `apps/web/src/lib/remotion/component-loader.ts` | Remotion | |
| 979 | `apps/web/src/components/editor/media-panel/views/ai/index.tsx` | AI UI | |
| 974 | `apps/web/src/test/e2e/project-folder-sync.e2e.ts` | Tests | |
| 957 | `apps/web/src/lib/remotion/__tests__/component-validator.test.ts` | Tests | |
| 956 | `apps/web/src/lib/ai-video/validation/validators.ts` | AI Validation | |
| 956 | `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts` | AI Types | |
| 940 | `electron/ai-pipeline-handler.ts` | Electron | Down from 1420 |
| 918 | `apps/web/src/stores/remotion-store.ts` | State Management | |
| 903 | `apps/web/src/lib/ffmpeg-utils.ts` | FFmpeg Utils | |
| 884 | `electron/main-ipc.ts` | Electron | |
| 876 | `apps/web/src/test/e2e/helpers/electron-helpers.ts` | Tests | |
| 869 | `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts` | AI Models Config | |
| 866 | `apps/web/src/lib/ai-video/generators/text-to-video.ts` | AI Generation | |
| 856 | `apps/web/src/components/editor/timeline/index.tsx` | Timeline UI | |
| 852 | `apps/web/src/stores/effects-store.ts` | State Management | |
| 840 | `apps/web/src/test/e2e/auto-save-export-file-management.e2e.ts` | Tests | |
| 829 | `apps/web/src/components/editor/draw/hooks/use-canvas-objects.ts` | Drawing Canvas | |
| 826 | `apps/web/src/lib/effects-templates.ts` | Effects | |
| 817 | `apps/web/src/components/export-dialog.tsx` | Editor UI | |
| 817 | `electron/preload-types.ts` | Electron | |
| 801 | `apps/web/src/components/editor/media-panel/views/captions.tsx` | Editor UI | |

## Breakdown by Category

| Category | Files | Total Lines |
|----------|------:|------------:|
| AI Generation / UI / Config | 7 | ~7,688 |
| State Management | 5 | ~5,146 |
| Electron | 4 | ~3,641 |
| Tests | 4 | ~3,647 |
| Timeline UI | 2 | ~2,180 |
| Editor UI | 2 | ~1,618 |
| Drawing Canvas | 2 | ~1,961 |
| Export | 1 | 1,030 |
| Type Definitions | 1 | 1,348 |
| Remotion | 1 | 983 |
| FFmpeg Utils | 1 | 903 |
| Effects | 1 | 826 |
| Export (backup) | 1 | 1,088 |

## Top Priority Actions

1. **Delete** `export-engine.backup.ts` (1088 lines) — flagged for removal in three consecutive reports.
2. **Split** `timeline-track.tsx` (1324 lines) — large UI component, extract sub-components.
3. **Split** `timeline-store-operations.ts` (1171 lines) — extract operation groups into separate files.
4. **Split** `media-store.ts` (1157 lines) — extract media helpers/utilities.
5. **Split** `drawing-canvas.tsx` (1132 lines) — extract canvas tools/handlers.
6. **Split** `use-ai-generation.ts` (1082 lines) — pending from v2/v3 split plans.

## Progress

- `ai-pipeline-handler.ts` successfully split: 1420 → 940 + 334 (output) + 185 (IPC)
- `image-to-video.ts` successfully split: 1259 → 178 (split into per-provider generator files)
- `preview-panel.tsx` reduced below threshold: 1228 → 718
- `export-engine-cli.ts` partially reduced: 1292 → 1030
- 11 files remain over 1000 lines (down from 13)
- Next file approaching threshold: `image-edit-client.ts` at 793 lines

## Notes

- The split of `ai-pipeline-handler.ts` was the biggest win: -480 lines with clean extraction boundaries.
- `image-to-video.ts` was dramatically split from 1259 → 178 lines by extracting per-provider generators.
- `preview-panel.tsx` dropped below 800 after component extraction.
- `timeline-store.ts` (1048) + `timeline-store-operations.ts` (1171) combined is 2219 lines of timeline state.
- AI subsystem under `media-panel/views/ai/` has 7 files totaling ~7700 lines.
- Test/e2e files (974, 957, 876, 840 lines) are over 800 — less critical since they don't affect runtime.
