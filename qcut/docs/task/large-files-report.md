# Large Files Report (>800 lines)

Generated: 2026-02-09

## Summary

**Total files exceeding 800 lines:** 27

The largest concentration is in AI-related code (`media-panel/views/ai/`) with 7 files totaling ~7,500 lines. Electron layer and timeline components are also significant.

## Files by Line Count

| Lines | File | Category |
|------:|------|----------|
| 1695 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | AI Generation |
| 1676 | `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts` | AI Generation |
| 1660 | `apps/web/src/stores/timeline-store.ts` | State Management |
| 1517 | `electron/preload.ts` | Electron |
| 1485 | `apps/web/src/components/editor/timeline/index.tsx` | Timeline UI |
| 1368 | `electron/main.ts` | Electron |
| 1349 | `apps/web/src/lib/fal-ai-client.ts` | AI Client |
| 1278 | `apps/web/src/lib/text2image-models.ts` | AI Models Config |
| 1219 | `apps/web/src/types/electron.d.ts` | Type Definitions |
| 1219 | `apps/web/src/lib/image-edit-client.ts` | AI Client |
| 1215 | `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-image-tab.tsx` | AI UI |
| 1206 | `apps/web/src/lib/export-engine.ts` | Export |
| 1183 | `apps/web/src/components/editor/media-panel/views/ai/index.tsx` | AI UI |
| 1144 | `electron/ffmpeg-handler.ts` | Electron / FFmpeg |
| 1094 | `apps/web/src/components/editor/timeline/timeline-track.tsx` | Timeline UI |
| 1084 | `apps/web/src/lib/ai-video/generators/image-to-video.ts` | AI Generation |
| 1025 | `apps/web/src/stores/media-store.ts` | State Management |
| 1018 | `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx` | Drawing Canvas |
| 988 | `apps/web/src/components/editor/preview-panel.tsx` | Editor UI |
| 926 | `apps/web/src/lib/export-engine.backup.ts` | Export (backup) |
| 875 | `apps/web/src/components/editor/media-panel/views/ai/types/ai-types.ts` | AI Types |
| 874 | `apps/web/src/lib/remotion/component-loader.ts` | Remotion |
| 854 | `apps/web/src/lib/ai-video/validation/validators.ts` | AI Validation |
| 828 | `apps/web/src/components/editor/media-panel/views/ai/constants/text2video-models-config.ts` | AI Models Config |
| 821 | `apps/web/src/test/e2e/project-folder-sync.e2e.ts` | Tests |
| 805 | `apps/web/src/lib/export-engine-cli.ts` | Export |
| 801 | `apps/web/src/lib/effects-templates.ts` | Effects |

## Breakdown by Category

| Category | Files | Total Lines |
|----------|------:|------------:|
| AI Generation / UI / Config | 10 | ~11,222 |
| Electron | 3 | ~4,029 |
| Timeline | 2 | ~2,579 |
| State Management | 2 | ~2,685 |
| Export | 3 | ~2,937 |
| Type Definitions | 1 | 1,219 |
| Editor UI | 2 | ~2,006 |
| Drawing Canvas | 1 | 1,018 |
| Remotion | 1 | 874 |
| Tests | 1 | 821 |
| Effects | 1 | 801 |

## Notes

- `export-engine.backup.ts` (926 lines) appears to be a backup file — consider removing if no longer needed.
- AI subsystem under `media-panel/views/ai/` is the most complex area with the highest concentration of large files.
- `timeline-store.ts` (1660 lines) is the core Zustand store — may benefit from splitting into sub-stores.
- `electron/preload.ts` (1517 lines) and `electron/main.ts` (1368 lines) could be modularized further.
