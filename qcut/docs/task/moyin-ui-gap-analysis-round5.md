# Moyin UI Gap Analysis Round 5 — Wiring Advanced Modules & Structural Fixes

**Goal**: Connect the powerful but unused lib modules (calibrators, stage analyzer, scene-prompt-generator) to the UI, fix dead/orphaned state, and add missing CRUD entry points.

**Previous rounds**:
- `docs/task/moyin-ui-gap-analysis.md` — Round 1 (10 subtasks, all completed)
- `docs/task/moyin-ui-gap-analysis-round2.md` — Round 2 (10 subtasks, all completed)
- `docs/task/moyin-ui-gap-analysis-round3.md` — Round 3 (10 subtasks, all completed)
- `docs/task/moyin-ui-gap-analysis-round4.md` — Round 4 (9 subtasks, all completed)

---

## What Round 4 Delivered

- Media persistence to Electron storage (`persistShotMedia`)
- Per-project localStorage persistence (`moyin-persistence.ts`)
- End frame image generation (`generateEndFrameImage`)
- Create mode AI script generation (genre/synopsis/duration → `generateScriptFromIdea`)
- Character wardrobe/stage variations CRUD (`character-variations.tsx`)
- Storyboard image splitting UI (Split & Apply to Shots)
- Audio control toggles (BGM + audioEnabled on SoundDesignInput)
- Content moderation error handling (`isModerationError` + friendly UI)

---

## Remaining Gap Summary

| # | Feature | Current Status | Impact |
|---|---------|---------------|--------|
| 1 | Pipeline progress tracker dead | `ImportProgress` renders 6-step tracker but `pipelineStep` is never set | **High** — users see no parsing feedback |
| 2 | Wire full character calibrator | `enhanceCharacters` uses simple inline LLM; `character-calibrator.ts` (5-step pipeline) unused | **High** — shallow results |
| 3 | Wire full scene calibrator | `enhanceScenes` uses simple inline LLM; `scene-calibrator.ts` (art direction enrichment) unused | **High** — shallow results |
| 4 | Scene-prompt-generator after split | After storyboard split, shot prompts stay empty; `scene-prompt-generator.ts` unused | **High** — split images have no prompts |
| 5 | Wire character-stage-analyzer | `character-stage-analyzer.ts` does AI-assisted multi-stage detection, never called | **Medium** — manual-only variations |
| 6 | Add Episode button missing | `EpisodeDialog` exists but no button opens it | **Medium** — no manual episode creation |
| 7 | Add Shot button missing | `addShot` store action exists but no UI button | **Medium** — no manual shot creation |
| 8 | Sync `activeStep` state with tabs | `activeStep` in store is orphaned; tabs use local `useState` | **Medium** — workflow not persisted |
| 9 | Scene edit form incomplete | Enriched fields (architectureStyle, colorPalette, etc.) are read-only, not editable | **Low** — can't manually tweak AI results |

---

## Subtasks (Recommended Order)

### Subtask 1: Activate Import Pipeline Progress Tracker

**Time**: ~20 min
**Files**:
- `apps/web/src/stores/moyin-store.ts` — update `parseScript` to set pipeline steps
- `apps/web/src/components/editor/media-panel/views/moyin/import-progress.tsx` — verify rendering

**Changes**:
- In the `parseScript` action, add `pipelineStep` and `pipelineProgress` mutations at each stage:
  - Before calling `api.parseScript`: set step=`import`, status=`active`
  - After successful parse: set step=`title_calibration`, then `synopsis`, etc.
  - Mark steps as `done` progressively as data is extracted
  - On error: mark current step as `error`
- The `ImportProgress` component already reads these from the store — it just needs the store to actually write them
- Reset pipeline state in `clearScript`

**Tests**: Verify `pipelineStep` transitions during `parseScript`

---

### Subtask 2: Wire Full Character Calibrator Pipeline

**Time**: ~30 min
**Files**:
- `apps/web/src/stores/moyin-store.ts` — replace `enhanceCharacters` internals
- `apps/web/src/lib/moyin/script/character-calibrator.ts` — existing, already exported

**Changes**:
- Replace the current `enhanceCharacters` implementation with one that calls `calibrateCharacters()` from `character-calibrator.ts`
- The calibrator pipeline does 5 steps: stats → classification → dedup/merge → visual prompts → identity anchors
- Pass `episodes` (as episode scripts) and character list to `calibrateCharacters()`
- Map `CalibratedCharacter[]` result back to `ScriptCharacter[]` using `convertToScriptCharacters()`
- Keep `characterCalibrationStatus` updates for UI feedback
- If episodes are empty (no episode data), fall back to the current simple LLM approach

**Reference**: `character-calibrator.ts` lines 42-145, `character-calibrator-enrichment.ts`

**Tests**: Verify `enhanceCharacters` uses calibrator when episodes exist

---

### Subtask 3: Wire Full Scene Calibrator Pipeline

**Time**: ~25 min
**Files**:
- `apps/web/src/stores/moyin-store.ts` — replace `enhanceScenes` internals
- `apps/web/src/lib/moyin/script/scene-calibrator.ts` — existing, already exported

**Changes**:
- Replace the current `enhanceScenes` implementation with one that calls `calibrateScenes()` from `scene-calibrator.ts`
- The calibrator enriches scenes with: architectureStyle, lightingDesign, colorPalette, keyProps, spatialLayout, eraDetails, visualPromptEn/Zh
- Map `CalibratedScene[]` result back to `ScriptScene[]` using `convertToScriptScenes()`
- Keep `sceneCalibrationStatus` updates for UI feedback
- Same fallback strategy as characters

**Reference**: `scene-calibrator.ts`

**Tests**: Verify `enhanceScenes` uses calibrator when episodes exist

---

### Subtask 4: Wire Scene-Prompt-Generator After Storyboard Split

**Time**: ~20 min
**Files**:
- `apps/web/src/stores/moyin-store.ts` — extend `splitAndApplyStoryboard`
- `apps/web/src/lib/moyin/storyboard/scene-prompt-generator.ts` — existing, already exported

**Changes**:
- After `splitAndApplyStoryboard` assigns split images to shots, call the scene-prompt-generator to populate each shot's `imagePrompt`, `videoPrompt`, and `endFramePrompt` fields
- Read the `scene-prompt-generator.ts` to understand its API and adapt
- If the generator needs an LLM call, use the same `window.electronAPI.moyin.callLLM` adapter pattern
- This ensures split images aren't "dead" — they have prompts for regeneration and video generation

**Reference**: `lib/moyin/storyboard/scene-prompt-generator.ts`

**Tests**: Verify shots have prompts after split+apply

---

### Subtask 5: Wire Character Stage Analyzer

**Time**: ~25 min
**Files**:
- `apps/web/src/stores/moyin-store.ts` — add `analyzeCharacterStages` action
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx` — add button
- `apps/web/src/lib/moyin/script/character-stage-analyzer.ts` — existing

**Changes**:
- Add `analyzeCharacterStages()` action to store:
  - Calls `detectMultiStageHints()` first (no API call needed) to check if analysis is worthwhile
  - If hints found, calls `analyzeCharacterStages()` with project background and characters
  - Uses `convertStagesToVariations()` to generate `CharacterVariation[]` per character
  - Adds variations to the character's `variations` array via `updateCharacter`
- Add "Analyze Stages" button in CharacterList (next to "AI Enhance"):
  - Shows only when episodes.length > 1 (multi-episode projects)
  - Disabled during analysis, shows spinner
  - On completion, shows count of characters needing multi-stage

**Reference**: `character-stage-analyzer.ts` lines 50-193

**Tests**: Verify `detectMultiStageHints` is called before full analysis

---

### Subtask 6: Add Episode & Shot Manual Creation Buttons

**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx` — add "New Episode" button
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx` — add "Add Shot" button

**Changes**:
- In `episode-tree.tsx`: Add a "New Episode" button at the top of the tree that opens the existing `EpisodeDialog`
  - Import `EpisodeDialog` and manage open state
  - The dialog already supports creating new episodes
- In `shot-breakdown.tsx`: Add a "+" button per scene section that calls `addShot` with a blank shot template
  - Generate a unique shot ID
  - Set `sceneRefId` to the scene's ID
  - Set reasonable defaults for `imageStatus: "idle"`, `videoStatus: "idle"`, etc.

**Tests**: "New Episode" button opens dialog; "Add Shot" creates a shot in the correct scene

---

### Subtask 7: Sync activeStep State With Structure Tabs

**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx` — read/write store state
- `apps/web/src/stores/moyin-store.ts` — no changes needed (state + action already exist)

**Changes**:
- Replace `structure-panel.tsx`'s local `useState<string>("overview")` with the store's `activeStep`
- Map between tab keys and `MoyinStep` values:
  - "overview" → "script", "characters" → "characters", "scenes" → "scenes", "shots" → "scenes", "generate" → "generate"
- Use `setActiveStep` from the store to persist tab selection
- Since `activeStep` is included in the persisted state, the selected tab will survive page reloads

**Tests**: Tab selection persists via store

---

### Subtask 8: Expand Scene Edit Form With Enriched Fields

**Time**: ~20 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` — extend SceneDetail edit mode

**Changes**:
- Extend `SceneDetail`'s `startEdit` to copy the 7 enriched fields:
  - `visualPromptEn`, `architectureStyle`, `lightingDesign`, `colorPalette`, `keyProps`, `spatialLayout`, `eraDetails`
- Add these as input fields in edit mode (inside a collapsible "Art Direction" section):
  - `architectureStyle`: Input
  - `lightingDesign`: Textarea (short)
  - `colorPalette`: Input (comma-separated colors)
  - `keyProps`: Input (comma-separated)
  - `spatialLayout`: Textarea (short)
  - `eraDetails`: Input
  - `visualPromptEn`: Textarea
- These fields are already in the `ScriptScene` type and displayed in read mode

**Tests**: Edit form includes architecture style and color palette inputs

---

### Subtask 9: Final Lint, Type-Check, Build, Tests

**Time**: ~15 min
**Files**: All modified files

**Changes**:
- Run `npx @biomejs/biome check --write` on all modified files
- Run `npx tsc --noEmit` — verify no new TS errors
- Run `bun run build` — verify clean build
- Run `bun run test` — verify moyin tests pass (fix any test regressions)
- Check all modified files stay under 800 lines

---

## Dependency Graph

```
Subtask 1 (Pipeline progress)  — independent
Subtask 2 (Character calibrator) — independent
Subtask 3 (Scene calibrator) — independent
Subtask 4 (Scene prompts after split) — independent
Subtask 5 (Stage analyzer) — independent (but benefits from Subtask 2 running first)
Subtask 6 (Add Episode/Shot buttons) — independent
Subtask 7 (Sync activeStep) — independent
Subtask 8 (Scene edit form) — benefits from Subtask 3 (richer data to edit)

Subtask 9 (Tests + lint/build) — after all others
```

**Recommended order**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

---

## Files Impact Summary

| File | Action |
|------|--------|
| `stores/moyin-store.ts` | Extend — pipeline progress, calibrator wiring, stage analyzer, activeStep sync |
| `moyin/import-progress.tsx` | Verify — already reads store, just needs store to write |
| `moyin/structure-panel.tsx` | Modify — replace local state with store activeStep |
| `moyin/episode-tree.tsx` | Extend — "New Episode" button + EpisodeDialog |
| `moyin/shot-breakdown.tsx` | Extend — "Add Shot" button per scene |
| `moyin/character-list.tsx` | Extend — "Analyze Stages" button |
| `moyin/property-panel.tsx` | Extend — scene edit enriched fields |
| `lib/moyin/script/character-calibrator.ts` | Used — wired to store |
| `lib/moyin/script/scene-calibrator.ts` | Used — wired to store |
| `lib/moyin/script/character-stage-analyzer.ts` | Used — wired to store |
| `lib/moyin/storyboard/scene-prompt-generator.ts` | Used — wired to store |

---

## Out of Scope (Future Work — Round 6+)

- **AI character/scene finder** — `ai-character-finder.ts`, `ai-scene-finder.ts` search features
- **CharacterBibleManager** — Dedicated character bible with image management
- **Director presets** — Wiring `director-presets.ts` to generation pipeline
- **storyboard-service.ts** — Configurable API endpoint (vs direct fal.ai)
- **episode-parser.ts** — Rule-based Chinese screenplay parsing (complement to LLM)
- **Scene viewpoint system** — Multi-viewpoint per scene
- **Multi-provider API routing** — Feature binding, key rotation
- **Export/publication panel** — Timeline export workflows
