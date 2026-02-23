# ViMax UI Implementation Plan

> **Date:** 2026-02-22
> **Feature:** ViMax AI Video Generation Panel in QCut Editor
> **Scope:** Minimal viable UI — Idea2Video pipeline with storyboard preview
> **Est. total effort:** ~3-4 hours (6 subtasks)

---

## Summary

Add a ViMax panel to QCut's editor media panel that lets users:
1. Enter an idea and generate a full video (Idea2Video)
2. See real-time pipeline progress across stages
3. Preview storyboard images before committing to video generation
4. Browse generated character portraits
5. Import final video into the editor timeline

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Entry point** | New tab in media panel | Follows existing AI panel pattern |
| **State** | Zustand store | Consistent with all other QCut stores |
| **IPC** | Existing `ai-pipeline:generate` | Already wired up for `vimax:*` commands |
| **Progress** | Add `onProgress` callbacks to pipelines | Current pipelines only use `console.log` |
| **Scope** | Idea2Video only (v1) | Script2Video and Novel2Movie deferred |

---

## Implementation Status

| Subtask | Status | Est. |
|---------|--------|------|
| 1. Add progress callbacks to ViMax pipelines | Pending | 30 min |
| 2. Create ViMax Zustand store | Pending | 20 min |
| 3. Register ViMax tab in media panel | Pending | 10 min |
| 4. Build VimaxView root component | Pending | 30 min |
| 5. Build pipeline stage components | Pending | 60 min |
| 6. Add unit tests | Pending | 30 min |

---

## Subtask 1: Add Progress Callbacks to ViMax Pipelines

> The pipelines currently log to console. The UI needs structured progress events.

**Priority:** P1 (blocks all UI work)
**Est. time:** 30 min

### Files to modify

- `electron/native-pipeline/vimax/pipelines/idea2video.ts`
- `electron/native-pipeline/vimax/pipelines/script2video.ts`
- `electron/native-pipeline/vimax/agents/base-agent.ts`

### Changes

1. **Add `ProgressCallback` type** to `electron/native-pipeline/vimax/types/output.ts`:
   ```ts
   export interface VimaxProgressUpdate {
     stage: "script" | "characters" | "portraits" | "storyboard" | "video" | "concat"
     status: "starting" | "processing" | "complete" | "error"
     percent: number        // 0-100 overall
     stagePercent: number   // 0-100 within current stage
     message: string
     data?: {
       script?: Script
       characters?: CharacterInNovel[]
       portraits?: Record<string, CharacterPortrait>
       storyboardImages?: string[]   // file paths
       videoClips?: string[]         // file paths
     }
   }

   export type VimaxProgressCallback = (update: VimaxProgressUpdate) => void
   ```

2. **Thread `onProgress` through Idea2VideoPipeline.run()**:
   - Emit at each stage boundary (6 stages = ~17% each)
   - Include intermediate results in `data` so UI can show storyboard images as they generate
   - Keep existing `console.log` calls alongside callbacks

3. **Wire callbacks through `vimax-cli-handlers.ts`** to emit IPC progress events:
   - File: `electron/native-pipeline/vimax-cli-handlers.ts`
   - Map `VimaxProgressUpdate` → existing `ai-pipeline:progress` IPC channel

---

## Subtask 2: Create ViMax Zustand Store

**Priority:** P1 (blocks UI components)
**Est. time:** 20 min

### Files to create

- `apps/web/src/stores/vimax-store.ts`

### Store shape

```ts
interface VimaxState {
  // Input
  idea: string
  setIdea: (idea: string) => void

  // Config
  targetDuration: number          // seconds, default 60
  setTargetDuration: (d: number) => void
  generatePortraits: boolean      // default true
  setGeneratePortraits: (v: boolean) => void

  // Pipeline state
  pipelineStatus: "idle" | "running" | "complete" | "error"
  currentStage: string            // e.g. "script", "storyboard"
  progress: number                // 0-100
  stageProgress: number           // 0-100
  statusMessage: string
  errorMessage: string

  // Intermediate results
  script: Script | null
  characters: CharacterInNovel[] | null
  portraits: Record<string, CharacterPortrait> | null
  storyboardImages: string[]      // file paths
  videoClips: string[]            // file paths
  finalVideoPath: string | null
  totalCost: number

  // Actions
  startGeneration: () => void
  updateProgress: (update: VimaxProgressUpdate) => void
  reset: () => void
}
```

### Pattern reference

- Follow: `apps/web/src/stores/project-store.ts` (simple Zustand pattern)
- No persistence needed (generation is ephemeral)

---

## Subtask 3: Register ViMax Tab in Media Panel

**Priority:** P1 (blocks UI visibility)
**Est. time:** 10 min

### Files to modify

- `apps/web/src/components/editor/media-panel/store.ts`
  - Add `"vimax"` to `Tab` union type
  - Add entry in `tabs` lookup with icon + label
  - Add `"vimax"` to `"ai-create"` tab group

- `apps/web/src/components/editor/media-panel/index.tsx`
  - Import `VimaxView` component
  - Add `vimax: <VimaxView />` to `viewMap`

---

## Subtask 4: Build VimaxView Root Component

**Priority:** P2
**Est. time:** 30 min

### Files to create

- `apps/web/src/components/editor/media-panel/views/vimax/index.tsx`

### Component structure

```
VimaxView
├── Idea input (textarea + duration slider + "Generate" button)
├── Pipeline progress stepper (6 stages, active/complete/pending indicators)
├── Stage result panels (collapsible, show as stages complete):
│   ├── ScriptPreview — title, logline, scene/shot count
│   ├── CharacterList — name, role, appearance thumbnail
│   ├── StoryboardGrid — image grid with shot descriptions
│   └── VideoPreview — final video player + "Add to Timeline" button
└── Cost tracker (running total in bottom bar)
```

### Key behaviors

- **Idle state**: Show idea input form
- **Running state**: Show progress stepper + completed stage results
- **Complete state**: Show all results + "Add to Timeline" CTA
- **Error state**: Show error message + "Retry" button

### IPC call pattern

```ts
const handleGenerate = async () => {
  const sessionId = `vimax-${Date.now()}`

  // Listen for progress
  const cleanup = window.electronAPI.aiPipeline.onProgress((p) => {
    if (p.sessionId === sessionId) {
      store.updateProgress(p)
    }
  })

  const result = await window.electronAPI.aiPipeline.generate({
    command: "vimax:idea2video",
    args: {
      idea: store.idea,
      duration: String(store.targetDuration),
      generatePortraits: store.generatePortraits,
    },
    sessionId,
    projectId: activeProject.id,
  })

  cleanup()
}
```

---

## Subtask 5: Build Pipeline Stage Components

**Priority:** P2
**Est. time:** 60 min

### Files to create

- `apps/web/src/components/editor/media-panel/views/vimax/components/vimax-progress-stepper.tsx`
- `apps/web/src/components/editor/media-panel/views/vimax/components/vimax-script-preview.tsx`
- `apps/web/src/components/editor/media-panel/views/vimax/components/vimax-character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/vimax/components/vimax-storyboard-grid.tsx`
- `apps/web/src/components/editor/media-panel/views/vimax/components/vimax-video-result.tsx`
- `apps/web/src/components/editor/media-panel/views/vimax/components/vimax-idea-form.tsx`

### Component details

#### `vimax-progress-stepper.tsx`
- Horizontal stepper: Script → Characters → Portraits → Storyboard → Video → Done
- Each step shows: icon, label, status (pending/active/complete/error)
- Active step shows a progress bar (stageProgress %)

#### `vimax-idea-form.tsx`
- Textarea for idea (placeholder: "A samurai's journey at sunrise...")
- Duration slider (15s–180s, default 60s)
- Toggle: "Generate character portraits" (default on)
- Generate button (disabled when running)

#### `vimax-script-preview.tsx`
- Shows: title, logline, scene count, total duration
- Collapsible scene list with shot descriptions
- Appears after script stage completes

#### `vimax-character-list.tsx`
- Grid of character cards: name, role badge, appearance snippet
- Portrait thumbnails (4 views) when portraits stage completes
- Appears after characters stage completes

#### `vimax-storyboard-grid.tsx`
- Image grid (2 columns) with shot descriptions below each image
- Each card: image, shot_type badge, camera_movement, duration
- Click to preview full-size
- Appears after storyboard stage completes

#### `vimax-video-result.tsx`
- Video player for final concatenated video
- Stats: total duration, total cost, shot count
- "Add to Timeline" button → calls `addMediaItem()` + `addElement()`
- "Open in Folder" button → `shell.showItemInFolder()`

---

## Subtask 6: Unit Tests

**Priority:** P3
**Est. time:** 30 min

### Files to create

- `apps/web/src/__tests__/stores/vimax-store.test.ts`
- `apps/web/src/__tests__/components/vimax-view.test.tsx`

### Test coverage

#### Store tests (`vimax-store.test.ts`)
- `setIdea` updates idea
- `startGeneration` sets status to "running"
- `updateProgress` correctly maps stage progress
- `reset` clears all state
- Intermediate results accumulate correctly

#### Component tests (`vimax-view.test.tsx`)
- Renders idea form in idle state
- Disables generate button when no idea entered
- Shows progress stepper when running
- Displays script preview after script stage
- Shows storyboard grid with correct image count
- "Add to Timeline" button calls media store

### Test pattern reference

- Follow: `apps/web/src/__tests__/` existing patterns
- Use: `@testing-library/react`, `vitest`
- Mock: `window.electronAPI.aiPipeline` for IPC calls

---

## Out of Scope (Future)

| Feature | Why deferred |
|---------|-------------|
| Script2Video UI | Requires JSON script editor — complex input |
| Novel2Movie UI | Multi-chapter, file upload — complex UX |
| Model selection dropdowns | Keep simple — use defaults, expose later |
| Portrait registry management | Reuse across projects — needs design |
| Storyboard editing (reorder/regenerate shots) | Interactive editing — v2 feature |
| Cost estimation before generation | Needs API pricing integration |

---

## File Summary

| Action | Path |
|--------|------|
| **Modify** | `electron/native-pipeline/vimax/types/output.ts` |
| **Modify** | `electron/native-pipeline/vimax/pipelines/idea2video.ts` |
| **Modify** | `electron/native-pipeline/vimax/pipelines/script2video.ts` |
| **Modify** | `electron/native-pipeline/vimax/agents/base-agent.ts` |
| **Modify** | `electron/native-pipeline/vimax-cli-handlers.ts` |
| **Modify** | `apps/web/src/components/editor/media-panel/store.ts` |
| **Modify** | `apps/web/src/components/editor/media-panel/index.tsx` |
| **Create** | `apps/web/src/stores/vimax-store.ts` |
| **Create** | `apps/web/src/components/editor/media-panel/views/vimax/index.tsx` |
| **Create** | `apps/web/src/components/editor/media-panel/views/vimax/components/vimax-progress-stepper.tsx` |
| **Create** | `apps/web/src/components/editor/media-panel/views/vimax/components/vimax-script-preview.tsx` |
| **Create** | `apps/web/src/components/editor/media-panel/views/vimax/components/vimax-character-list.tsx` |
| **Create** | `apps/web/src/components/editor/media-panel/views/vimax/components/vimax-storyboard-grid.tsx` |
| **Create** | `apps/web/src/components/editor/media-panel/views/vimax/components/vimax-video-result.tsx` |
| **Create** | `apps/web/src/components/editor/media-panel/views/vimax/components/vimax-idea-form.tsx` |
| **Create** | `apps/web/src/__tests__/stores/vimax-store.test.ts` |
| **Create** | `apps/web/src/__tests__/components/vimax-view.test.tsx` |
