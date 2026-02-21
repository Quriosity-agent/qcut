# Moyin Integration: Moyin Panel Tab in Media Panel

> **Date:** 2026-02-22
> **Feature:** Add a new "Moyin" tab to QCut's media panel with script-to-storyboard workflow
> **Phase:** 2 (UI Integration)
> **Priority:** P2
> **Est. total effort:** ~3 hours (6 subtasks)
> **Depends on:** [moyin-01-script-parser.md](moyin-01-script-parser.md), [moyin-02-character-bible.md](moyin-02-character-bible.md), [moyin-03-cinematography-presets.md](moyin-03-cinematography-presets.md)
> **Parent:** [moyin-creator-integration-plan.md](moyin-creator-integration-plan.md)

---

## Summary

Add a `"moyin"` tab to QCut's media panel under the "Create" group. Users can:
1. Paste or type a screenplay script
2. Parse it into structured scenes and characters
3. Review extracted characters with their identity anchors
4. Review scene breakdown with locations and atmosphere
5. Generate storyboard images via QCut's AI pipeline
6. Import generated assets into the media store and timeline

---

## Architecture Decision

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tab placement | `tabGroups["ai-create"]` alongside ai, text2image, sounds | Script-to-video is a creation workflow |
| State | New `moyin-store.ts` Zustand store | Isolates moyin state from existing stores |
| AI calls | Reuse `window.electronAPI.aiPipeline.generate()` | No new IPC handler needed for image/video gen |
| LLM calls (parsing) | New `moyin:parse-script` IPC channel | Script parsing needs LLM; route through Electron |
| UI pattern | Follow AI Video tab structure (tabs/hooks/components) | Consistent with existing media panel views |

---

## Implementation Status

| Subtask | Status | Est. |
|---------|--------|------|
| 1. Register Moyin tab in media panel | Pending | 15 min |
| 2. Create moyin-store (Zustand) | Pending | 30 min |
| 3. Add script parsing IPC handler | Pending | 30 min |
| 4. Build MoyinView root component | Pending | 30 min |
| 5. Build sub-components (script, characters, scenes) | Pending | 45 min |
| 6. Add unit tests | Pending | 30 min |

---

## Subtask 1: Register Moyin Tab in Media Panel

**Priority:** P1 (blocks UI work)
**Est. time:** 15 min

### Files to modify

**`apps/web/src/components/editor/media-panel/store.ts`:**

1. Add `"moyin"` to `Tab` union type (line 25):
   ```typescript
   export type Tab =
     | "media"
     | "text"
     // ... existing tabs
     | "upscale"
     | "moyin";  // NEW
   ```

2. Add entry to `tabs` object (after line 113):
   ```typescript
   moyin: {
     icon: ClapperboardIcon,  // from lucide-react
     label: "Moyin",
   },
   ```

3. Add to `tabGroups["ai-create"].tabs` array (line 149):
   ```typescript
   "ai-create": {
     icon: SparklesIcon,
     label: "Create",
     tabs: ["ai", "text2image", "sounds", "moyin"],  // added "moyin"
   },
   ```

**`apps/web/src/components/editor/media-panel/index.tsx`:**

1. Add import:
   ```typescript
   import { MoyinView } from "./views/moyin";
   ```

2. Add to `viewMap` (inside `Record<Exclude<Tab, "pty">, React.ReactNode>`):
   ```typescript
   moyin: <MoyinView />,
   ```

---

## Subtask 2: Create moyin-store (Zustand)

**Priority:** P1 (blocks UI work)
**Est. time:** 30 min

### Target files
- `apps/web/src/stores/moyin-store.ts` (NEW)

### Store interface

```typescript
import { create } from "zustand"
import type { ScriptData, ScriptCharacter, ScriptScene } from "@/types/moyin-script"
import type { CharacterBible } from "@/lib/moyin/character/types"

type MoyinStep = "script" | "characters" | "scenes" | "generate"
type ParseStatus = "idle" | "parsing" | "ready" | "error"
type GenerationStatus = "idle" | "generating" | "done" | "error"

interface MoyinStore {
  // Workflow
  activeStep: MoyinStep
  setActiveStep: (step: MoyinStep) => void

  // Script
  rawScript: string
  setRawScript: (text: string) => void
  scriptData: ScriptData | null
  parseStatus: ParseStatus
  parseError: string | null
  parseScript: () => Promise<void>
  clearScript: () => void

  // Characters
  characters: ScriptCharacter[]
  characterBibles: CharacterBible[]
  updateCharacter: (id: string, updates: Partial<ScriptCharacter>) => void

  // Scenes
  scenes: ScriptScene[]
  updateScene: (id: string, updates: Partial<ScriptScene>) => void

  // Generation
  generationStatus: GenerationStatus
  generationProgress: number
  generateStoryboard: () => Promise<void>

  // Reset
  reset: () => void
}
```

### Design notes
- No persistence — moyin workflow is session-scoped (no Zustand persist middleware)
- `parseScript()` calls the new `moyin:parse-script` IPC handler (Subtask 3)
- `generateStoryboard()` calls `window.electronAPI.aiPipeline.generate()` with appropriate args
- Follow QCut store patterns from `apps/web/src/stores/media-store.ts`

---

## Subtask 3: Add Script Parsing IPC Handler

**Priority:** P1
**Est. time:** 30 min

### Target files
- `electron/moyin-handler.ts` (NEW)
- `electron/preload-integrations.ts` (MODIFY — add `createMoyinAPI()`)
- `apps/web/src/types/electron.d.ts` (MODIFY — add `moyin` to `ElectronAPI`)
- `electron/main.ts` (MODIFY — register handler)
- `electron/preload.ts` (MODIFY — expose API)

### IPC channels

```typescript
// moyin-handler.ts
export interface MoyinParseOptions {
  rawScript: string
  language?: string
  sceneCount?: number
}

export interface MoyinParseResult {
  success: boolean
  data?: ScriptData
  error?: string
}

// Handles: "moyin:parse-script"
export function setupMoyinIPC(ipcMain: Electron.IpcMain): void {
  ipcMain.handle("moyin:parse-script", async (_event, options: MoyinParseOptions): Promise<MoyinParseResult> => {
    // 1. Get API keys via getDecryptedApiKeys()
    // 2. Call LLM with script-parser's system prompts
    // 3. Return parsed ScriptData
  })
}
```

### Preload integration

```typescript
// preload-integrations.ts
export function createMoyinAPI(): ElectronAPI["moyin"] {
  return {
    parseScript: (options) => ipcRenderer.invoke("moyin:parse-script", options),
  }
}
```

### Type definition

```typescript
// electron.d.ts — add to ElectronAPI interface
moyin?: {
  parseScript: (options: MoyinParseOptions) => Promise<MoyinParseResult>
}
```

---

## Subtask 4: Build MoyinView Root Component

**Priority:** P1
**Est. time:** 30 min

### Target files
- `apps/web/src/components/editor/media-panel/views/moyin/index.tsx` (NEW)

### Component structure

```
MoyinView
├── Step indicator (script → characters → scenes → generate)
├── Active step content:
│   ├── ScriptInput (step: "script")
│   ├── CharacterList (step: "characters")
│   ├── SceneList (step: "scenes")
│   └── GenerateActions (step: "generate")
└── Navigation (Back / Next buttons)
```

### Design notes
- Follow the pattern from `apps/web/src/components/editor/media-panel/views/ai/index.tsx`
- Use QCut's existing Radix UI components (`Tabs`, `Button`, `ScrollArea`)
- Step indicator uses `Badge` components showing current progress
- Each step is conditionally rendered based on `moyin-store.activeStep`

---

## Subtask 5: Build Sub-Components

**Priority:** P2
**Est. time:** 45 min

### Target files
- `apps/web/src/components/editor/media-panel/views/moyin/script-input.tsx` (NEW)
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx` (NEW)
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx` (NEW)
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx` (NEW)

### Component specs

**ScriptInput:**
- `Textarea` for raw screenplay input (auto-resize, max 10000 chars)
- "Parse Script" button — calls `moyin-store.parseScript()`
- Loading spinner during parsing
- Error display on parse failure

**CharacterList:**
- Scrollable list of `ScriptCharacter` cards
- Each card shows: name, role, appearance, personality
- Editable fields (inline edit via `Input` components)
- "Add to Character Bible" button per character

**SceneList:**
- Scrollable list of `ScriptScene` cards
- Each card shows: location, time, atmosphere, visual prompt
- Editable `visualPrompt` field for user refinement

**GenerateActions:**
- Summary: X characters, Y scenes ready
- Style selector (dropdown using `VISUAL_STYLE_PRESETS`)
- Cinematography profile selector (dropdown using `CINEMATOGRAPHY_PROFILES`)
- "Generate Storyboard" button
- Progress bar during generation
- Results grid showing generated images
- "Add to Timeline" button per image/video

---

## Subtask 6: Unit Tests

**Priority:** P2
**Est. time:** 30 min

### Target files
- `apps/web/src/stores/__tests__/moyin-store.test.ts` (NEW)
- `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-view.test.tsx` (NEW)

### Test coverage

**moyin-store.test.ts:**
- `setActiveStep()` — updates activeStep
- `setRawScript()` — stores raw text
- `clearScript()` — resets to initial state
- `reset()` — clears all state
- `updateCharacter()` — updates character by id
- `updateScene()` — updates scene by id

**moyin-view.test.tsx:**
- Renders step indicator with 4 steps
- Shows ScriptInput on initial render (default step = "script")
- Navigation buttons advance/retreat steps
- Parse button is disabled when rawScript is empty
- Follow QCut's test patterns from `apps/web/src/components/editor/media-panel/views/ai/__tests__/`

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Storyboard grid splitting (N×N) | Phase 2.5 — separate task: [moyin-06-storyboard-generator.md](moyin-06-storyboard-generator.md) |
| Video generation from storyboard | Phase 3 — uses existing AI Video pipeline |
| Persistence across sessions | Add Zustand persist once workflow is validated |
| Director panel (frame-by-frame) | Phase 4 — see integration plan |
