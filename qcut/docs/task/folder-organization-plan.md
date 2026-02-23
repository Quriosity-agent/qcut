# Folder Organization Plan

> Reorganize oversized flat directories into logical subdirectories.  
> Target: 5–15 files per subdirectory. Group by domain/feature.

---

## Table of Contents

1. [apps/web/src/lib/ (89 files)](#1-appswebsrclib--89-files)
2. [apps/web/src/stores/ (37 files)](#2-appswebsrcstores--37-files)
3. [apps/web/src/hooks/ (37 files)](#3-appswebsrchooks--37-files)
4. [electron/native-pipeline/ (38 files)](#4-electronnative-pipeline--38-files)
5. [electron/claude/ (22 files)](#5-electronclaude--22-files)

---

## 1. `apps/web/src/lib/` — 89 files

### Current Files (sorted by line count)

| File | Lines |
|------|------:|
| claude-timeline-bridge.ts | 1288 |
| export-engine-cli.ts | 1016 |
| ffmpeg-utils.ts | 791 |
| image-edit-client.ts | 716 |
| export-analysis.ts | 669 |
| zip-manager.ts | 604 |
| fal-ai-client.ts | 584 |
| export-engine-factory.ts | 577 |
| export-engine.ts | 545 |
| sam3-client.ts | 539 |
| export-engine-optimized.ts | 538 |
| export-engine-renderer.ts | 524 |
| audio-mixer.ts | 512 |
| video-edit-client.ts | 471 |
| error-handler.ts | 470 |
| screen-recording-controller.ts | 461 |
| model-utils.ts | 456 |
| claude-timeline-bridge-helpers.ts | 443 |
| blob-manager.ts | 380 |
| webcodecs-export-engine.ts | 380 |
| upscale-models.ts | 373 |
| image-utils.ts | 366 |
| iconify-api.ts | 364 |
| webcodecs-detector.ts | 351 |
| media-processing.ts | 344 |
| effects-canvas-advanced.ts | 342 |
| fal-ai-client-generation.ts | 336 |
| timeline-sticker-integration.ts | 332 |
| fal-ai-client-veo31.ts | 309 |
| effects-chaining.ts | 304 |
| effects-utils.ts | 297 |
| image-edit-models-info.ts | 277 |
| effects-keyframes.ts | 243 |
| export-engine-cli-audio.ts | 217 |
| error-context.ts | 211 |
| project-folder-sync.ts | 209 |
| video-metadata.ts | 205 |
| dev-memory-profiler.ts | 194 |
| image-edit-polling.ts | 183 |
| api-adapter.ts | 175 |
| memory-utils.ts | 159 |
| bulk-import.ts | 157 |
| utils.ts | 145 |
| sticker-persistence-debug.ts | 144 |
| blob-url-debug.ts | 134 |
| fal-ai-client-reve.ts | 134 |
| time.ts | 125 |
| export-engine-cli-utils.ts | 122 |
| export-engine-utils.ts | 121 |
| image-validation.ts | 121 |
| audio-export-config.ts | 118 |
| canvas-utils.ts | 115 |
| sticker-downloader.ts | 114 |
| export-engine-recorder.ts | 113 |
| debug-sticker-overlay.ts | 113 |
| sticker-test-helper.ts | 111 |
| ai-video-output.ts | 105 |
| ffmpeg-video-recorder.ts | 88 |
| image-edit-capabilities.ts | 85 |
| release-notes.ts | 78 |
| export-engine-debug.ts | 76 |
| debug-config.ts | 75 |
| ffmpeg-utils-encode.ts | 71 |
| ffmpeg-filter-chain.ts | 70 |
| export-errors.ts | 68 |
| blog-query.ts | 67 |
| image-edit-utils.ts | 66 |
| sam3-models.ts | 62 |
| camera-prompt-builder.ts | 55 |
| markdown.ts | 55 |
| sticker-timeline-query.ts | 54 |
| timeline.ts | 53 |
| claude-bridge-lifecycle.ts | 49 |
| ai-video-client.ts | 46 |
| fetch-github-stars.ts | 47 |
| debug-logger.ts | 41 |
| fal-ai-client-internal-types.ts | 40 |
| media-source.ts | 40 |
| font-config.ts | 36 |
| project-skills-sync.ts | 35 |
| ffmpeg-loader.ts | 31 |
| rate-limit.ts | 28 |
| feature-flags.ts | 24 |
| ffmpeg-utils-loader.ts | 22 |
| pty-session-cleanup.ts | 21 |
| asset-path.ts | 14 |
| waitlist.ts | 12 |
| index.ts | 7 |
| update-veo31-types.sh | 3 |
| text2image-models.ts | 2 |

### High-Risk Files (many importers — need barrel re-exports)

| File | Importers | Risk |
|------|----------:|------|
| debug-config.ts | 36 | 🔴 Critical — keep path or add barrel |
| utils.ts | 21 | 🔴 Critical |
| error-handler.ts | 11 | 🟡 High |
| blob-manager.ts | 7 | 🟡 Medium |
| markdown.ts | 4 | 🟢 Low |
| asset-path.ts | 2 | 🟢 Low |
| effects-utils.ts | 2 | 🟢 Low |

### Proposed Subdirectory Structure

#### `lib/export/` — Export engine and related (15 files)
```
export-engine.ts
export-engine-cli.ts
export-engine-cli-audio.ts
export-engine-cli-utils.ts
export-engine-debug.ts
export-engine-factory.ts
export-engine-optimized.ts
export-engine-recorder.ts
export-engine-renderer.ts
export-engine-utils.ts
export-analysis.ts
export-errors.ts
webcodecs-export-engine.ts
webcodecs-detector.ts
audio-export-config.ts
```

#### `lib/ffmpeg/` — FFmpeg utilities (8 files)
```
ffmpeg-utils.ts
ffmpeg-utils-encode.ts
ffmpeg-utils-loader.ts
ffmpeg-loader.ts
ffmpeg-filter-chain.ts
ffmpeg-video-recorder.ts
audio-mixer.ts
memory-utils.ts          (export memory calculations)
```

#### `lib/ai-clients/` — FAL.ai and AI service clients (14 files)
```
fal-ai-client.ts
fal-ai-client-generation.ts
fal-ai-client-reve.ts
fal-ai-client-veo31.ts
fal-ai-client-internal-types.ts
image-edit-client.ts
image-edit-models-info.ts
image-edit-polling.ts
image-edit-capabilities.ts
image-edit-utils.ts
video-edit-client.ts
sam3-client.ts
sam3-models.ts
ai-video-client.ts
ai-video-output.ts
```

#### `lib/ai-models/` — Model definitions and utilities (5 files)
```
model-utils.ts
upscale-models.ts
text2image-models.ts     (re-export barrel)
camera-prompt-builder.ts
image-validation.ts
```

#### `lib/effects/` — Visual effects system (5 files)
```
effects-utils.ts
effects-chaining.ts
effects-keyframes.ts
effects-canvas-advanced.ts
canvas-utils.ts
```

#### `lib/stickers/` — Sticker system (7 files)
```
sticker-downloader.ts
sticker-persistence-debug.ts
sticker-test-helper.ts
sticker-timeline-query.ts
timeline-sticker-integration.ts
debug-sticker-overlay.ts
iconify-api.ts
```

#### `lib/claude-bridge/` — Claude ↔ renderer bridge (4 files)
```
claude-timeline-bridge.ts
claude-timeline-bridge-helpers.ts
claude-bridge-lifecycle.ts
project-skills-sync.ts
```

#### `lib/media/` — Media processing and metadata (7 files)
```
media-processing.ts
media-source.ts
video-metadata.ts
image-utils.ts
blob-manager.ts
blob-url-debug.ts
bulk-import.ts
```

#### `lib/project/` — Project management (4 files)
```
project-folder-sync.ts
zip-manager.ts
screen-recording-controller.ts
release-notes.ts
```

#### `lib/debug/` — Debug and error utilities (6 files)
```
debug-config.ts
debug-logger.ts
dev-memory-profiler.ts
error-handler.ts
error-context.ts
pty-session-cleanup.ts
```

#### `lib/` (root) — Core utilities, stay flat (13 files)
```
utils.ts                 (21 importers — DO NOT MOVE)
index.ts
time.ts
markdown.ts
font-config.ts
feature-flags.ts
rate-limit.ts
asset-path.ts
api-adapter.ts
timeline.ts
blog-query.ts
fetch-github-stars.ts
waitlist.ts
```

### Barrel Re-export Strategy

Each new subdirectory gets an `index.ts` that re-exports all public APIs. Additionally, `lib/index.ts` should be updated to re-export from subdirectories so existing `@/lib/foo` imports continue working.

**Critical:** `debug-config.ts` (36 importers) and `utils.ts` (21 importers) are the highest risk. Recommend:
- Keep `utils.ts` in `lib/` root (don't move)
- Move `debug-config.ts` to `lib/debug/` BUT add `lib/debug-config.ts` re-export shim:
  ```ts
  export * from './debug/debug-config';
  ```
- Same re-export shim pattern for `error-handler.ts` (11 importers)

---

## 2. `apps/web/src/stores/` — 37 files

### Current Files

| File | Lines |
|------|------:|
| timeline-store-operations.ts | 1240 |
| media-store.ts | 1036 |
| timeline-store.ts | 985 |
| remotion-store.ts | 788 |
| effects-store.ts | 779 |
| moyin-store.ts | 748 |
| text2image-store.ts | 624 |
| word-timeline-store.ts | 617 |
| stickers-overlay-store.ts | 591 |
| project-store.ts | 543 |
| adjustment-store.ts | 506 |
| pty-terminal-store.ts | 502 |
| panel-store.ts | 495 |
| folder-store.ts | 460 |
| segmentation-store.ts | 426 |
| moyin-generation.ts | 417 |
| export-store.ts | 361 |
| scene-store.ts | 354 |
| sounds-store.ts | 322 |
| moyin-calibration.ts | 289 |
| keybindings-store.ts | 244 |
| playback-store.ts | 220 |
| captions-store.ts | 217 |
| gemini-terminal-store.ts | 192 |
| stickers-store.ts | 188 |
| moyin-shot-generation.ts | 157 |
| moyin-persistence.ts | 138 |
| skills-store.ts | 124 |
| media-store-types.ts | 116 |
| camera-selector-store.ts | 108 |
| white-draw-store.ts | 104 |
| editor-store.ts | 102 |
| moyin-gen-config.ts | 71 |
| moyin-undo.ts | 48 |
| nano-edit-store.ts | 44 |
| mcp-app-store.ts | 33 |
| media-store-loader.ts | 30 |

### High-Risk Files

| File | Importers | Risk |
|------|----------:|------|
| timeline-store.ts | 13 | 🔴 Critical |
| project-store.ts | 12 | 🔴 Critical |
| media-store.ts | 12 | 🔴 Critical |
| effects-store.ts | 6 | 🟡 High |
| export-store.ts | 5 | 🟡 High |
| editor-store.ts | 4 | 🟡 Medium |

### Proposed Subdirectory Structure

#### `stores/timeline/` — Timeline state (4 files)
```
timeline-store.ts
timeline-store-operations.ts
word-timeline-store.ts
scene-store.ts
```

#### `stores/media/` — Media management (4 files)
```
media-store.ts
media-store-types.ts
media-store-loader.ts
sounds-store.ts
```

#### `stores/moyin/` — Moyin workflow (7 files)
```
moyin-store.ts
moyin-generation.ts
moyin-calibration.ts
moyin-shot-generation.ts
moyin-persistence.ts
moyin-gen-config.ts
moyin-undo.ts
```

#### `stores/editor/` — Editor UI state (7 files)
```
editor-store.ts
panel-store.ts
keybindings-store.ts
playback-store.ts
camera-selector-store.ts
white-draw-store.ts
nano-edit-store.ts
```

#### `stores/ai/` — AI feature stores (5 files)
```
text2image-store.ts
remotion-store.ts
segmentation-store.ts
adjustment-store.ts
effects-store.ts
```

#### `stores/` (root) — Keep flat (10 files)
```
project-store.ts         (12 importers — high risk)
export-store.ts
folder-store.ts
stickers-store.ts
stickers-overlay-store.ts
captions-store.ts
pty-terminal-store.ts
gemini-terminal-store.ts
skills-store.ts
mcp-app-store.ts
```

### Barrel Re-exports

Each subdirectory gets `index.ts`. **Critical stores** (`timeline-store`, `media-store`, `project-store`) have many importers — add re-export shims at `stores/` root:
```ts
// stores/timeline-store.ts (shim)
export * from './timeline/timeline-store';
```

---

## 3. `apps/web/src/hooks/` — 37 files

### Current Files

| File | Lines |
|------|------:|
| use-frame-cache.ts | 356 |
| use-ai-pipeline.ts | 301 |
| use-timeline-element-resize.ts | 259 |
| use-elevenlabs-transcription.ts | 247 |
| use-export-progress.ts | 245 |
| use-timeline-playhead.ts | 238 |
| use-effect-keyboard-shortcuts.ts | 225 |
| use-editor-actions.ts | 208 |
| use-error-reporter.ts | 205 |
| use-project-folder.ts | 171 |
| use-selection-box.ts | 164 |
| use-toast.ts | 160 |
| use-timeline-snapping.ts | 158 |
| use-keyboard-shortcuts-help.ts | 153 |
| useElectron.ts | 149 |
| use-memory-monitor.ts | 146 |
| use-zip-export.ts | 146 |
| use-export-settings.ts | 146 |
| use-sound-search.ts | 140 |
| use-async-module-loading.tsx | 119 |
| use-skill-runner.ts | 111 |
| use-aspect-ratio.ts | 107 |
| use-async-media-store.ts | 98 |
| use-playback-controls.ts | 85 |
| use-async-ffmpeg.ts | 80 |
| use-drag-drop.ts | 69 |
| use-claude-project-updates.ts | 66 |
| use-blob-image.ts | 63 |
| use-keybindings.ts | 60 |
| use-save-on-visibility-change.ts | 60 |
| use-timeline-zoom.ts | 52 |
| use-export-presets.ts | 49 |
| use-export-validation.ts | 49 |
| use-keybinding-conflicts.ts | 48 |
| use-infinite-scroll.ts | 30 |
| use-debounce.ts | 24 |
| use-mobile.tsx | 17 |

### Proposed Subdirectory Structure

#### `hooks/timeline/` — Timeline interaction (7 files)
```
use-timeline-element-resize.ts
use-timeline-playhead.ts
use-timeline-snapping.ts
use-timeline-zoom.ts
use-frame-cache.ts
use-selection-box.ts
use-playback-controls.ts
```

#### `hooks/export/` — Export workflow (5 files)
```
use-export-progress.ts
use-export-settings.ts
use-export-presets.ts
use-export-validation.ts
use-zip-export.ts
```

#### `hooks/keyboard/` — Keyboard shortcuts (4 files)
```
use-keybindings.ts
use-keybinding-conflicts.ts
use-keyboard-shortcuts-help.ts
use-effect-keyboard-shortcuts.ts
```

#### `hooks/media/` — Media loading and processing (6 files)
```
use-async-media-store.ts
use-async-ffmpeg.ts
use-blob-image.ts
use-aspect-ratio.ts
use-sound-search.ts
use-elevenlabs-transcription.ts
```

#### `hooks/` (root) — General/utility hooks (15 files)
```
use-ai-pipeline.ts
use-editor-actions.ts
use-error-reporter.ts
use-project-folder.ts
use-toast.ts
useElectron.ts
use-memory-monitor.ts
use-async-module-loading.tsx
use-skill-runner.ts
use-drag-drop.ts
use-claude-project-updates.ts
use-save-on-visibility-change.ts
use-infinite-scroll.ts
use-debounce.ts
use-mobile.tsx
```

### Barrel Re-exports

Each subdirectory gets `index.ts`. Hooks are typically imported individually so risk is lower than lib/stores.

---

## 4. `electron/native-pipeline/` — 38 files

### Current Files

| File | Lines |
|------|------:|
| cli-runner.ts | 859 |
| vimax-cli-handlers.ts | 729 |
| editor-handlers-timeline.ts | 650 |
| cli.ts | 650 |
| manager.ts | 622 |
| step-executors.ts | 489 |
| api-caller.ts | 479 |
| parallel-executor.ts | 404 |
| editor-handlers-generate.ts | 340 |
| editor-handlers-media.ts | 323 |
| editor-handlers-analysis.ts | 317 |
| executor.ts | 272 |
| cli-handlers-admin.ts | 241 |
| cli-handlers-media.ts | 211 |
| editor-api-client.ts | 209 |
| key-manager.ts | 202 |
| project-commands.ts | 194 |
| cli-output-formatters.ts | 194 |
| registry.ts | 187 |
| chain-parser.ts | 183 |
| cli-output.ts | 168 |
| validators.ts | 161 |
| config-loader.ts | 157 |
| errors.ts | 151 |
| cost-calculator.ts | 151 |
| file-manager.ts | 145 |
| srt-generator.ts | 133 |
| editor-api-types.ts | 129 |
| interactive.ts | 124 |
| stream-emitter.ts | 110 |
| grid-generator.ts | 105 |
| example-pipelines.ts | 94 |
| platform-logger.ts | 79 |
| cli-handlers-editor.ts | 78 |
| xdg-paths.ts | 70 |
| index.ts | 52 |
| init.ts | 27 |
| output-utils.ts | 25 |

### Proposed Subdirectory Structure

#### `native-pipeline/cli/` — CLI entry and handlers (10 files)
```
cli.ts
cli-runner.ts
cli-handlers-admin.ts
cli-handlers-media.ts
cli-handlers-editor.ts
cli-output.ts
cli-output-formatters.ts
vimax-cli-handlers.ts
interactive.ts
example-pipelines.ts
```

#### `native-pipeline/editor/` — Editor API integration (7 files)
```
editor-api-client.ts
editor-api-types.ts
editor-handlers-timeline.ts
editor-handlers-generate.ts
editor-handlers-media.ts
editor-handlers-analysis.ts
project-commands.ts
```

#### `native-pipeline/execution/` — Pipeline execution (6 files)
```
executor.ts
parallel-executor.ts
step-executors.ts
chain-parser.ts
config-loader.ts
validators.ts
```

#### `native-pipeline/infra/` — Infrastructure utilities (8 files)
```
api-caller.ts
key-manager.ts
registry.ts
cost-calculator.ts
file-manager.ts
platform-logger.ts
stream-emitter.ts
xdg-paths.ts
```

#### `native-pipeline/output/` — Output generation (4 files)
```
srt-generator.ts
grid-generator.ts
output-utils.ts
errors.ts
```

#### `native-pipeline/` (root) — Entry points (3 files)
```
index.ts
init.ts
manager.ts
```

---

## 5. `electron/claude/` — 22 files

### Current Files

| File | Lines |
|------|------:|
| claude-timeline-handler.ts | 1037 |
| claude-export-handler.ts | 938 |
| claude-http-server.ts | 722 |
| claude-http-analysis-routes.ts | 611 |
| claude-media-handler.ts | 588 |
| claude-transcribe-handler.ts | 586 |
| claude-analyze-handler.ts | 388 |
| claude-vision-handler.ts | 383 |
| claude-summary-handler.ts | 342 |
| claude-suggest-handler.ts | 306 |
| claude-scene-handler.ts | 304 |
| claude-auto-edit-handler.ts | 296 |
| claude-generate-handler.ts | 284 |
| claude-project-handler.ts | 266 |
| claude-diagnostics-handler.ts | 248 |
| claude-http-generate-routes.ts | 115 |
| claude-cuts-handler.ts | 96 |
| claude-filler-handler.ts | 91 |
| claude-range-handler.ts | 86 |
| claude-personaplex-handler.ts | 83 |
| claude-operation-log.ts | 64 |
| index.ts | 47 |

### Proposed Subdirectory Structure

#### `claude/handlers/` — All command handlers (15 files)
```
claude-timeline-handler.ts
claude-export-handler.ts
claude-media-handler.ts
claude-transcribe-handler.ts
claude-analyze-handler.ts
claude-vision-handler.ts
claude-summary-handler.ts
claude-suggest-handler.ts
claude-scene-handler.ts
claude-auto-edit-handler.ts
claude-generate-handler.ts
claude-project-handler.ts
claude-diagnostics-handler.ts
claude-cuts-handler.ts
claude-filler-handler.ts
claude-range-handler.ts
claude-personaplex-handler.ts
```

#### `claude/http/` — HTTP server and routes (3 files)
```
claude-http-server.ts
claude-http-analysis-routes.ts
claude-http-generate-routes.ts
```

#### `claude/` (root) — Entry and shared (2 files)
```
index.ts
claude-operation-log.ts
```

### Note

At 22 files this directory is borderline. The handlers subdirectory has 17 files (slightly over target), but they form a cohesive group — all are Claude API command handlers with identical structure. Splitting further would be artificial.

---

## Implementation Notes

### Execution Order
1. **`apps/web/src/lib/`** — Highest priority (89 files), biggest impact
2. **`electron/native-pipeline/`** — Clean separation already implied by naming
3. **`apps/web/src/stores/`** — High import risk, needs careful shim work
4. **`electron/claude/`** — Simplest restructure
5. **`apps/web/src/hooks/`** — Lowest urgency

### Re-export Shim Pattern
For every moved file with >3 importers, leave a shim at the original path:
```ts
// apps/web/src/lib/debug-config.ts (shim)
export * from './debug/debug-config';
```
This prevents breaking existing imports. Shims can be removed later via a bulk find-and-replace pass.

### Risks
- **`debug-config.ts`** (36 importers) — Must have shim or stay in place
- **`utils.ts`** (21 importers) — Recommend keeping in lib root permanently
- **`timeline-store.ts`** (13 importers) — Needs shim at stores root
- **`media-store.ts`** / **`project-store.ts`** (12 each) — Same

### Testing
After each directory move, run:
```bash
bun run build        # Verify no broken imports
bun run type-check   # Verify TypeScript resolution
```
