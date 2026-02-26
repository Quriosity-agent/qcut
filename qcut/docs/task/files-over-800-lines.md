# Files Over 800 Lines — Refactor Candidates

Per CLAUDE.md: "No code file should exceed 800 lines; if it does, split it into a new file."

**Generated**: 2026-02-26
**Total files over 800 lines**: 49

---

## Summary by Area

| Area | Count | Worst Offender |
|------|-------|----------------|
| Components | 11 | timeline-track.tsx (1327) |
| Stores | 6 | timeline-store-operations.ts (1431) |
| Lib/Utils | 8 | claude-timeline-bridge.ts (1559) |
| Electron | 7 | ffmpeg-export-handler.ts (1219) |
| Tests | 13 | session-manager.test.ts (1515) |
| QAgent packages | 4 | session-manager.ts (1249) |

---

## All Files (sorted by line count)

### 1500+ lines (Critical)

| Lines | File | Suggested Action |
|-------|------|-----------------|
| 1559 | `apps/web/src/lib/claude-bridge/claude-timeline-bridge.ts` | Split by operation type (add/remove/update/query) |
| 1515 | `packages/qagent/packages/core/src/__tests__/session-manager.test.ts` | Split test suites into separate files |

### 1200–1499 lines

| Lines | File | Suggested Action |
|-------|------|-----------------|
| 1431 | `apps/web/src/stores/timeline/timeline-store-operations.ts` | Extract clip ops, track ops, selection ops |
| 1327 | `apps/web/src/components/editor/timeline/timeline-track.tsx` | Extract sub-components (clip renderer, track controls) |
| 1296 | `apps/web/src/components/editor/preview-panel.tsx` | Extract preview controls, overlay logic |
| 1249 | `packages/qagent/packages/core/src/session-manager.ts` | Split lifecycle vs execution logic |
| 1219 | `electron/ffmpeg-export-handler.ts` | Extract preset builders, progress tracking |

### 1000–1199 lines

| Lines | File | Suggested Action |
|-------|------|-----------------|
| 1187 | `electron/__tests__/editor-cli-integration.test.ts` | Split by feature area |
| 1185 | `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-view.test.tsx` | Split test suites |
| 1182 | `apps/web/src/test/e2e/helpers/electron-helpers.ts` | Extract helper categories |
| 1166 | `apps/web/src/components/editor/media-panel/views/word-timeline-view.tsx` | Extract word list, timing editor |
| 1159 | `apps/web/src/stores/media/media-store.ts` | Split media CRUD vs playback state |
| 1145 | `electron/claude/handlers/claude-timeline-handler.ts` | Split by handler group |
| 1136 | `apps/web/src/components/editor/draw/canvas/drawing-canvas.tsx` | Extract tool handlers, rendering |
| 1130 | `electron/__tests__/remaining-gaps.test.ts` | Split by feature |
| 1128 | `apps/web/src/lib/export/export-engine-cli.ts` | Extract codec config, progress |
| 1126 | `packages/qagent/packages/core/src/types.ts` | Split into domain-specific type files |
| 1091 | `apps/web/src/stores/timeline/timeline-store.ts` | Extract actions into separate slices |
| 1085 | `apps/web/src/components/editor/media-panel/views/ai/hooks/use-ai-generation.ts` | Split by generation type |
| 1031 | `electron/__tests__/cli-pipeline.test.ts` | Split by pipeline stage |
| 1018 | `packages/qagent/packages/web/src/lib/__tests__/serialize.test.ts` | Split test suites |
| 1003 | `electron/preload-types/electron-api.ts` | Split by API domain |

### 800–999 lines

| Lines | File | Suggested Action |
|-------|------|-----------------|
| 985 | `apps/web/src/components/editor/media-panel/views/ai/index.tsx` | Extract form sections |
| 984 | `packages/qagent/packages/core/src/lifecycle-manager.ts` | Extract cleanup, health check |
| 974 | `apps/web/src/test/e2e/project-folder-sync.e2e.ts` | Split test scenarios |
| 970 | `packages/qagent/packages/plugins/agent-codex/src/index.test.ts` | Split test suites |
| 966 | `packages/qagent/packages/plugins/scm-github/test/index.test.ts` | Split test suites |
| 957 | `apps/web/src/lib/remotion/__tests__/component-validator.test.ts` | Split test suites |
| 952 | `apps/web/src/components/editor/timeline/index.tsx` | Extract toolbar, scroll logic |
| 918 | `apps/web/src/stores/ai/remotion-store.ts` | Extract template logic |
| 909 | `packages/qagent/packages/plugins/tracker-linear/test/index.test.ts` | Split test suites |
| 903 | `apps/web/src/lib/ffmpeg/ffmpeg-utils.ts` | Extract codec utils, filter builders |
| 900 | `apps/web/src/stores/moyin/moyin-store.ts` | Split upload vs pipeline state |
| 890 | `packages/qagent/packages/web/server/__tests__/tmux-utils.test.ts` | Split test suites |
| 886 | `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-round11.test.tsx` | Merge into main test or split |
| 884 | `apps/web/src/lib/__tests__/claude-timeline-bridge.test.ts` | Split test suites |
| 870 | `packages/qagent/packages/web/src/components/SessionDetail.tsx` | Extract sub-components |
| 870 | `packages/qagent/packages/core/src/__tests__/lifecycle-manager.test.ts` | Split test suites |
| 864 | `packages/qagent/packages/web/server/__tests__/direct-terminal-ws.integration.test.ts` | Split by scenario |
| 852 | `apps/web/src/stores/ai/effects-store.ts` | Extract effect presets |
| 846 | `apps/web/src/test/e2e/auto-save-export-file-management.e2e.ts` | Split test scenarios |
| 841 | `packages/qagent/packages/plugins/agent-claude-code/src/index.ts` | Extract tool definitions |
| 840 | `apps/web/src/lib/claude-bridge/claude-timeline-bridge-helpers.ts` | Extract by helper category |
| 829 | `apps/web/src/components/editor/draw/hooks/use-canvas-objects.ts` | Extract object type handlers |
| 826 | `electron/preload-integrations.ts` | Split by integration domain |
| 825 | `apps/web/src/lib/moyin/utils/__tests__/utils.test.ts` | Split test suites |
| 821 | `electron/claude/__tests__/claude-http-server.test.ts` | Split test suites |
| 809 | `packages/qagent/packages/plugins/workspace-worktree/src/__tests__/index.test.ts` | Split test suites |
| 807 | `electron/utility/utility-bridge.ts` | Extract bridge categories |
| 804 | `apps/web/src/components/editor/media-panel/views/captions.tsx` | Extract caption editor, style panel |

---

## Priority Refactors

Start with the highest-impact, most-touched files:

1. **claude-timeline-bridge.ts** (1559 lines) — Most over limit, core integration
2. **timeline-store-operations.ts** (1431 lines) — Central store, high change frequency
3. **timeline-track.tsx** (1327 lines) — Complex UI component
4. **preview-panel.tsx** (1296 lines) — Large component with mixed concerns
5. **ffmpeg-export-handler.ts** (1219 lines) — Electron handler, testability gains
