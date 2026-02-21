# Moyin Script UI Integration Plan

> Upgrade the Moyin tab from read-only review wizard to a functional script-to-storyboard pipeline, wiring the ported lib modules to the UI layer.

## Current State

**What exists:**
- 4-step wizard: Script Input → Character List (read-only) → Scene List (read-only) → Generate (placeholder)
- `moyin-store.ts`: Session-scoped Zustand store with `updateCharacter()`/`updateScene()` actions (unwired)
- `moyin:generate-storyboard` IPC handler returns placeholder `{ success: true, outputPaths: [] }`
- 34 ported lib modules (parsers, calibrators, generators, presets) — none wired to UI yet
- 100+ visual style presets and cinematography profiles — no selector UI

**What's missing:**
- Character/scene inline editing UI
- Style & profile selector dropdowns
- Real storyboard generation (wired to `storyboard-service.ts`)
- AI calibration integration (character dedup, scene enrichment)
- Shot-level view after generation
- Generated image/video preview
- Progress granularity (currently 0 or 100)
- Timeline export ("Send to Timeline")

---

## Subtask 1: Style & Profile Selectors in Generate Step

**Goal:** Let users pick a visual style and cinematography profile before generation.

**Files:**
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx` — Add selector UI
- `apps/web/src/stores/moyin-store.ts` — Already has `selectedStyleId` / `selectedProfileId`

**What to do:**
1. Import `VISUAL_STYLE_PRESETS` from `@/lib/moyin/presets/visual-styles`
2. Import `CINEMATOGRAPHY_PROFILES` from `@/lib/moyin/presets/cinematography-profiles`
3. Add a "Visual Style" combobox/select with category grouping (3D, 2D, Real, Stop Motion)
   - Show style name + short description
   - Default: `"2d_ghibli"` (matches store default)
4. Add a "Camera Profile" select
   - Show profile name + reference films
   - Default: `"classic-cinematic"` (matches store default)
5. Wire `setSelectedStyleId()` and `setSelectedProfileId()` actions (add to store if missing)
6. Display selected style thumbnail/description in the summary box

**Tests:**
- Verify selectors render with correct options
- Verify store updates on selection change
- Verify selected values display in summary

---

## Subtask 2: Character Inline Editing

**Goal:** Allow users to edit character fields after parsing — name, gender, age, role, appearance.

**Files:**
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx` — Add edit mode
- `apps/web/src/stores/moyin-store.ts` — Already has `updateCharacter(id, updates)`

**What to do:**
1. Add an "Edit" icon button on each character card
2. Toggle card between view mode (current) and edit mode
3. Edit mode fields:
   - Name: text input
   - Gender: select (男/女/其他)
   - Age: text input
   - Role: text input
   - Appearance: textarea (multiline, for visual prompt refinement)
   - Tags: comma-separated input or tag chips
4. Save/Cancel buttons in edit mode
5. Wire edits to `updateCharacter(id, { field: newValue })`
6. Add "Add Character" button (creates blank character with `id: char_${Date.now()}`)
7. Add "Delete" button per character (with confirmation)

**Store changes:**
- Add `addCharacter(char: ScriptCharacter)` action
- Add `removeCharacter(id: string)` action

**Tests:**
- Toggle edit mode on/off
- Edit a field and verify store update
- Add new character
- Delete character with confirmation

---

## Subtask 3: Scene Inline Editing

**Goal:** Allow users to edit scene fields — name, location, time, atmosphere, visual prompt.

**Files:**
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx` — Add edit mode
- `apps/web/src/stores/moyin-store.ts` — Already has `updateScene(id, updates)`

**What to do:**
1. Same edit pattern as character-list: icon button toggles edit mode per card
2. Edit mode fields:
   - Name: text input
   - Location: text input
   - Time: select (白天/夜晚/黄昏/清晨/下午)
   - Atmosphere: textarea
   - Visual Prompt (EN): textarea (for image generation prompt)
   - Tags: comma-separated input
3. Save/Cancel buttons
4. Wire edits to `updateScene(id, { field: newValue })`
5. Add "Add Scene" / "Delete Scene" buttons

**Store changes:**
- Add `addScene(scene: ScriptScene)` action
- Add `removeScene(id: string)` action

**Tests:**
- Toggle edit mode
- Edit fields and verify store
- Add/remove scenes

---

## Subtask 4: AI Calibration Step

**Goal:** After parsing, run AI calibration to deduplicate characters, enrich with visual prompts, and add scene art direction — using the already-ported calibrator modules.

**Files:**
- `apps/web/src/stores/moyin-store.ts` — Add calibration actions
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx` — Add "AI Enhance" button
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx` — Add "AI Enhance" button
- `electron/moyin-handler.ts` — Add `moyin:calibrate-characters` and `moyin:calibrate-scenes` IPC handlers

**What to do:**
1. Add new IPC handlers in `moyin-handler.ts`:
   - `moyin:calibrate-characters` — Calls `calibrateCharacters()` from character-calibrator
     - Input: `{ characters, episodeScripts, background }`
     - Output: `{ success, characters: ScriptCharacter[] }`
   - `moyin:calibrate-scenes` — Calls `calibrateScenes()` from scene-calibrator
     - Input: `{ scenes, episodeScripts, background }`
     - Output: `{ success, scenes: ScriptScene[] }`
2. Register handlers in `electron/main.ts`
3. Add preload API types in `electron/preload-types.ts` and `apps/web/src/types/electron.d.ts`
4. Add store actions:
   - `calibrateCharacters()` — Calls IPC, replaces `characters` array with enriched version
   - `calibrateScenes()` — Calls IPC, replaces `scenes` array with enriched version
   - Track `calibrationStatus: "idle" | "calibrating" | "done" | "error"` per entity type
5. UI: Add "AI Enhance" button in character-list header
   - Shows spinner during calibration
   - After calibration: characters have `visualPromptEn`, `identityAnchors`, `importance` filled
   - Badge/indicator shows "AI Enhanced" on calibrated characters
6. Same pattern for scene-list "AI Enhance" button

**Tests:**
- Mock IPC calls for calibration
- Verify calibrated data replaces original
- Verify loading/error states

---

## Subtask 5: Wire Real Storyboard Generation

**Goal:** Replace the placeholder `moyin:generate-storyboard` handler with actual storyboard image generation using `storyboard-service.ts`.

**Files:**
- `electron/moyin-handler.ts` — Implement real generation logic
- `apps/web/src/stores/moyin-store.ts` — Add granular progress tracking
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx` — Show generated image

**What to do:**
1. Update `moyin:generate-storyboard` handler:
   - Accept: `{ scenes, characters, styleId, profileId, apiKey?, baseUrl?, model? }`
   - Build `StoryboardGenerationConfig` from input
   - Call `generateStoryboardImage()` from `storyboard-service.ts`
   - Return: `{ success, imageUrl, gridConfig }` or `{ success: false, error }`
   - Use `event.sender.send()` for progress updates (or use IPC invoke with progress callback pattern)
2. Add API key resolution:
   - Reuse `getDecryptedApiKeys()` from existing moyin-handler
   - Map style to appropriate model/provider
3. Store changes:
   - Add `storyboardImageUrl: string | null` to state
   - Add `storyboardGridConfig` to state
   - Update `generationProgress` with real intermediate values (10, 30, 50, 70, 100)
4. UI changes in `generate-actions.tsx`:
   - After generation succeeds, show the storyboard image in an `<img>` tag
   - Show grid overlay info (e.g., "6 panels, 3x2 grid")
   - Add "Regenerate" button (re-runs with same params)
   - Add "Split into Shots" button (next phase — leads to shot view)

**Tests:**
- Mock generation IPC
- Verify progress bar updates at intermediate values
- Verify image display after success
- Verify error handling

---

## Subtask 6: Shot View After Split

**Goal:** After storyboard image is generated and split, show individual shots as cards with per-shot prompts and generation controls.

**Files:**
- `apps/web/src/components/editor/media-panel/views/moyin/shot-list.tsx` — New component
- `apps/web/src/components/editor/media-panel/views/moyin/index.tsx` — Add step 5
- `apps/web/src/stores/moyin-store.ts` — Add shots array and shot actions
- `apps/web/src/components/editor/media-panel/views/moyin/step-indicator.tsx` — Add 5th step

**What to do:**
1. Add `"shots"` as step 5 in the workflow (after "generate")
2. Store changes:
   - Add `shots: Shot[]` to state
   - Add `splitStoryboard()` action — calls `splitStoryboardImage()` from image-splitter, populates shots
   - Add `updateShot(id, updates)` action
   - Add per-shot image/video generation actions
3. Create `shot-list.tsx`:
   - Grid layout of shot cards (2 columns in the media panel width)
   - Each shot card shows:
     - Shot index number
     - Cropped image from storyboard (or placeholder if not split yet)
     - Action summary (1-2 lines)
     - Camera info badges (shot size, camera angle, lighting)
     - "Generate Video" button per shot
     - Video generation status/progress per shot
   - Header: "N shots" count + "Generate All Videos" batch button
   - "Send to Timeline" button (per shot or batch)
4. Update step-indicator with 5th icon (Film icon)

**Store changes:**
- `shots: Shot[]`
- `splitStoryboard()` — Image splitter integration
- `generateShotVideo(shotId)` — Per-shot video gen
- `batchGenerateVideos()` — All shots
- `sendToTimeline(shotIds)` — Export to QCut timeline

**Tests:**
- Verify shot cards render with correct data
- Verify shot editing
- Verify per-shot generation status display

---

## Subtask 7: Timeline Export Bridge

**Goal:** Allow users to send generated images/videos from the Moyin pipeline into QCut's timeline.

**Files:**
- `apps/web/src/components/editor/media-panel/views/moyin/shot-list.tsx` — "Send to Timeline" button
- `apps/web/src/stores/moyin-store.ts` — Export action
- Integration with `apps/web/src/stores/timeline-store.ts` and `apps/web/src/stores/media-store.ts`

**What to do:**
1. Add `sendShotsToTimeline(shotIds: string[])` action to moyin-store
2. For each shot with a generated image or video:
   - Add media to project's media store (`useMediaStore.addMedia()`)
   - Add element to timeline at sequential positions (`useTimelineStore.addElement()`)
   - Set duration based on shot duration field (default 3s for images, actual duration for videos)
3. UI: "Send to Timeline" button on shot-list header
   - Disabled if no shots have generated media
   - Shows count: "Send N shots to timeline"
   - After sending: show success toast

**Tests:**
- Verify media store integration
- Verify timeline element creation with correct duration/position

---

## Implementation Order & Dependencies

```
Subtask 1: Style Selectors          ← No dependencies, quick win
Subtask 2: Character Editing        ← No dependencies
Subtask 3: Scene Editing            ← No dependencies
    ↓ (1-3 can be done in parallel)
Subtask 4: AI Calibration           ← Depends on 2 & 3 (editing UI shows enriched data)
Subtask 5: Real Storyboard Gen      ← Depends on 1 (needs style/profile selection)
    ↓
Subtask 6: Shot View                ← Depends on 5 (needs generated storyboard to split)
    ↓
Subtask 7: Timeline Export          ← Depends on 6 (needs shots with generated media)
```

**Recommended execution order:** 1 → 2 → 3 → 4 → 5 → 6 → 7

---

## File Impact Summary

| File | Changes |
|------|---------|
| `apps/web/src/stores/moyin-store.ts` | Add: style/profile setters, add/remove character/scene, calibration actions, shots array, split/generation/export actions |
| `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx` | Add: style selector, profile selector, image preview, regenerate button |
| `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx` | Add: edit mode, add/delete buttons, AI enhance button |
| `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx` | Add: edit mode, add/delete buttons, AI enhance button |
| `apps/web/src/components/editor/media-panel/views/moyin/shot-list.tsx` | **New**: Shot cards grid, per-shot actions, timeline export |
| `apps/web/src/components/editor/media-panel/views/moyin/index.tsx` | Add: 5th step ("shots"), update step routing |
| `apps/web/src/components/editor/media-panel/views/moyin/step-indicator.tsx` | Add: 5th step icon/label |
| `electron/moyin-handler.ts` | Add: `moyin:calibrate-characters`, `moyin:calibrate-scenes`; implement real `moyin:generate-storyboard` |
| `electron/main.ts` | Register new IPC handlers |
| `electron/preload-types.ts` | Add calibration + generation types |
| `apps/web/src/types/electron.d.ts` | Add calibration + generation API types |

---

## Out of Scope (Deferred)

- **Director panel** (separate from media panel tab) — Phase 2
- **Character library store** — Phase 2
- **Scene library store** — Phase 2
- **Full-script-service orchestrator** — Not needed; individual modules called directly
- **Multi-episode UI** (episode tabs/selector) — Future
- **SClass / Seedance 2.0 integration** — Phase 3
- **Trailer generation** — Phase 3
