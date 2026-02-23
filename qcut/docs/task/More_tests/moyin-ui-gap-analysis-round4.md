# Moyin UI Gap Analysis Round 4 — QCut vs Original Moyin Creator

**Goal**: Close infrastructure and workflow gaps that prevent production use — media persistence, end frame generation, per-project persistence, Create mode, and character wardrobe variations.

**Previous rounds**:
- `docs/task/moyin-ui-gap-analysis.md` — Round 1 (10 subtasks, all completed)
- `docs/task/moyin-ui-gap-analysis-round2.md` — Round 2 (10 subtasks, all completed)
- `docs/task/moyin-ui-gap-analysis-round3.md` — Round 3 (10 subtasks, all completed)

**Reference**: Original source at `/Users/peter/Desktop/code/moyin/moyin-creator/src/`

---

## What Round 3 Delivered

- Cinematic vocabulary selectors (all 5 professional roles + angle/focal/technique)
- Narrative design fields (narrativeFunction, shotPurpose, visualFocus, blocking, rhythm)
- Character reference image grid (upload/remove via FileReader + data URL)
- Character identity anchors display (6-layer read-only with collapsible sections)
- Negative prompt display (avoid badges + style exclusions)
- End frame image display and error display in ShotDetail
- Collapsible sections throughout ShotDetail (8 groups)
- Full character edit mode (visual prompts EN/ZH, traits, relationships, notes, tags, reference images)
- Character click-to-select in CharacterList → PropertyPanel
- Always-clickable Structure tabs (removed disabled gate)

---

## Remaining Gap Summary

| # | Feature | Original | QCut Status | Priority |
|---|---------|----------|-------------|----------|
| 1 | Media persistence (Electron) | `saveImageToLocal()`, `local-image://` protocol | Temp fal.ai URLs lost on reload | **Critical** |
| 2 | Per-project persistence | Zustand persist middleware, project-scoped storage | Session-only — all data lost on reload | **Critical** |
| 3 | End frame generation action | `generateEndFrameImage()` store action + UI button | Type+display exists, no generation action | High |
| 4 | Create mode (AI script generation) | AI generates screenplay from synopsis/idea | "Coming soon" placeholder | High |
| 5 | Character wardrobe/variations | Multiple outfit/stage variations per character, selectable per shot | `CharacterVariation` type exists, no UI | Medium |
| 6 | Storyboard image splitting | Upload storyboard → split into individual shot images | `image-splitter.ts` (714 lines) exists, no UI | Medium |
| 7 | Audio control toggles | Per-shot ambient/SFX/dialogue/BGM on/off toggles | Only text inputs, no toggles | Medium |
| 8 | Scene library selector in shots | Shot references a scene from library + viewpoint picker | Shot has `sceneRefId` but no picker UI | Low |
| 9 | Trailer generation | AI shot selection for trailer (10s/30s/60s) | `trailer-service.ts` may exist in lib, no UI | Low |
| 10 | Content moderation error handling | Detect moderation failures vs other errors, show user-friendly message | Generic error display only | Low |

---

## Subtasks (Recommended Order)

### Subtask 1: Media Persistence to Electron Storage

**Time**: ~25 min
**Files**:
- `apps/web/src/stores/moyin-shot-generation.ts` (extend)
- `apps/web/src/stores/moyin-store.ts` (update generateShotImage/Video)

**Changes**:
- Add `persistShotMedia(url: string, filename: string): Promise<string>` helper to `moyin-shot-generation.ts`:
  - If `window.electronAPI?.saveBlob` exists: fetch URL → Uint8Array → saveBlob → return local path
  - Otherwise: return the original URL (web-only fallback)
- Update `generateShotImage` in store:
  - After fal.ai returns URL, call `persistShotMedia(url, `shot-${shotId}-image.png`)`
  - Store the local path as `imageUrl`
- Update `generateShotVideo` in store:
  - After fal.ai returns URL, call `persistShotMedia(url, `shot-${shotId}-video.mp4`)`
  - Store the local path as `videoUrl`
- Handle errors gracefully — if persistence fails, keep the remote URL

**Reference**: `electron/preload.ts` exposes `saveBlob`; `apps/web/src/types/electron.d.ts` line 141

**Tests**: Unit test `persistShotMedia` with mocked `window.electronAPI`

---

### Subtask 2: Per-Project Zustand Persistence

**Time**: ~30 min
**Files**:
- `apps/web/src/stores/moyin-store.ts` (add persist middleware)
- `apps/web/src/stores/moyin-persistence.ts` (new — extraction to keep store under 800 lines)

**Changes**:
- Create `moyin-persistence.ts` with:
  - `getMoyinStorageKey(projectId: string)` → `"moyin-project-{projectId}"`
  - `moyinPersistOptions(projectId: string)` — returns Zustand persist config
  - `partialize` function selecting only persistent fields:
    - Persist: `rawScript`, `scriptData`, `parseStatus`, `characters`, `scenes`, `shots`, `episodes`, `selectedStyleId`, `selectedProfileId`, `language`, `sceneCount`, `shotCount`
    - Skip: `generationStatus`, `generationProgress`, `generationError`, `calibrationStatus`, `pipelineStep`, `pipelineProgress`, `selectedItemId`, `selectedItemType`
  - Version number (1) with migration function
- Get `projectId` from URL via TanStack Router `useParams` or passed via prop to MoyinView
- Wrap store creation with `persist` middleware
- Add `clearProjectData()` action for project cleanup
- Note: moyin-store.ts is at 808 lines — extraction to separate file is required

**Reference**: Zustand persist docs; existing `panel-sizes` localStorage pattern in codebase

**Tests**: Verify partialize excludes transient state, storage key includes project ID

---

### Subtask 3: End Frame Image Generation

**Time**: ~20 min
**Files**:
- `apps/web/src/stores/moyin-store.ts` (add action)
- `apps/web/src/stores/moyin-shot-generation.ts` (add helper)
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx` (add UI button)

**Changes**:
- Add `generateEndFrameImage(shotId: string)` action to store:
  - Uses `endFramePrompt` if available, falls back to `imagePrompt`
  - Calls `generateFalImage` with the prompt
  - Updates shot: `endFrameImageUrl`, `endFrameImageStatus`, `endFrameSource: "ai-generated"`
  - Uses `persistShotMedia` (from Subtask 1) to save locally
- Add `buildEndFramePrompt(shot: Shot)` helper to `moyin-shot-generation.ts`
- Add "Generate End Frame" button in ShotDetail generation section:
  - Only visible when `needsEndFrame` is true or `endFramePrompt` exists
  - Shows status (generating/completed/failed) like image/video buttons
  - Disabled when generating

**Reference**: Original `endFrameImageUrl` + `endFrameSource` in director-store.ts

**Tests**: Button renders when `needsEndFrame` is true, hidden otherwise

---

### Subtask 4: Create Mode — AI Script Generation

**Time**: ~30 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/script-input.tsx` (extend Create tab)
- `apps/web/src/stores/moyin-store.ts` (add `generateScript` action)
- `apps/web/src/lib/moyin/script/system-prompts.ts` (may need new prompt)

**Changes**:
- Replace "Coming soon" placeholder in Create tab with:
  - **Genre selector**: dropdown (drama, action, comedy, romance, sci-fi, horror, documentary)
  - **Synopsis textarea**: 2-4 sentence story idea
  - **Target duration** input: number of episodes or total minutes
  - **Language** selector: reuse existing language selector
  - "Generate Script" button
- Add `generateScript(synopsis: string, genre: string, duration: string)` action to store:
  - Calls `generateScriptFromIdea` (already exists in `lib/moyin/script/script-parser.ts`)
  - Sets `rawScript` with the generated text
  - Sets `parseStatus` to ready and populates `scriptData`
- Show loading state during generation (spinner + "Generating screenplay..." text)
- On success, auto-switch to Import tab to show the generated script

**Reference**: `generateScriptFromIdea` in `lib/moyin/script/script-parser.ts`; original Create mode in moyin-creator

**Tests**: Create tab renders genre selector and synopsis input; generate button triggers action

---

### Subtask 5: Character Wardrobe / Stage Variations

**Time**: ~30 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-variations.tsx` (new)
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (integrate)
- `apps/web/src/stores/moyin-store.ts` (add variation CRUD)

**Changes**:
- Create `character-variations.tsx` with:
  - `VariationList` — shows character variations as small cards (name + thumbnail + age/stage description)
  - "Add Variation" button with inline form (name, visual prompt, age description, episode range)
  - Remove variation button (X)
  - Each variation shows its reference image if available
- Add to CharacterDetail in property-panel.tsx:
  - Collapsible "Variations" section below identity anchors
  - Renders `VariationList` for the selected character
- Add store actions (in moyin-store.ts or new `moyin-character-actions.ts` if store is too large):
  - `addCharacterVariation(characterId: string, variation: CharacterVariation)`
  - `removeCharacterVariation(characterId: string, variationId: string)`
  - `updateCharacterVariation(characterId: string, variationId: string, updates: Partial<CharacterVariation>)`
- Add `characterVariations: Record<string, CharacterVariation[]>` to store state
- In ShotDetail, add a variation selector dropdown when shot has characters with variations

**Reference**: Original `WardrobeModal.tsx`, `CharacterVariation` type in `moyin-script.ts` (already defined)

**Tests**: Variation list renders, add/remove works

---

### Subtask 6: Storyboard Image Splitting UI

**Time**: ~25 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/storyboard-splitter.tsx` (new)
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx` (integrate)

**Changes**:
- Create `storyboard-splitter.tsx`:
  - "Split Storyboard" button (only visible when `storyboardImageUrl` exists)
  - Calls `splitStoryboardImage` from existing `lib/moyin/storyboard/image-splitter.ts`
  - Shows split results as a grid of individual shot images
  - "Apply to Shots" button — assigns each split image as the corresponding shot's `imageUrl`
  - Progress indicator during splitting
- Integrate into GenerateActions below the storyboard result display
- The `image-splitter.ts` (714 lines) already handles:
  - Canvas-based grid splitting
  - Edge detection and threshold filtering
  - Multiple aspect ratio support (9:16, 16:9)

**Reference**: `lib/moyin/storyboard/image-splitter.ts`, `storyboard-service.ts`

**Tests**: Split button renders when storyboard exists, hidden otherwise

---

### Subtask 7: Audio Control Toggles

**Time**: ~15 min
**Files**:
- `apps/web/src/types/moyin-script.ts` (add toggle fields to Shot)
- `apps/web/src/components/editor/media-panel/views/moyin/shot-selectors.tsx` (extend SoundDesignInput)

**Changes**:
- Add to Shot type in `moyin-script.ts`:
  ```typescript
  audioAmbientEnabled?: boolean;
  audioSfxEnabled?: boolean;
  audioDialogueEnabled?: boolean;
  audioBgmEnabled?: boolean;
  backgroundMusic?: string;
  ```
- Extend `SoundDesignInput` in `shot-selectors.tsx`:
  - Add toggle switches (Checkbox or Switch) for each audio channel
  - Add BGM description input when `audioBgmEnabled` is true
  - Disabled channels grey out their text inputs
- Update ShotDetail edit mode to include the toggle props
- Update `startEdit` in shot-detail.tsx to copy the new fields

**Reference**: Original per-scene audio switches in split-scene-card.tsx

**Tests**: Toggles render, disabling a channel greys out the input

---

### Subtask 8: Content Moderation Error Handling

**Time**: ~15 min
**Files**:
- `apps/web/src/stores/moyin-shot-generation.ts` (add detection)
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx` (improve error display)

**Changes**:
- Add `isModerationError(error: unknown): boolean` helper to `moyin-shot-generation.ts`:
  - Checks for common moderation error patterns (fal.ai content policy, NSFW, banned content)
  - Returns true if the error is a content moderation rejection
- Update `generateShotImageRequest` and `generateShotVideoRequest` catch blocks:
  - If moderation error: set error message to "Content moderation: prompt may contain restricted content. Try rephrasing."
  - Otherwise: show the original error message
- Update ShotDetail error display:
  - Moderation errors show with a warning icon (orange) instead of destructive (red)
  - Add "Edit Prompt" shortcut button next to moderation errors to jump to edit mode

**Reference**: Original content moderation handling in use-video-generation.ts

**Tests**: `isModerationError` detects moderation strings correctly

---

### Subtask 9: Update Tests and Final Lint/Build

**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-view.test.tsx` (extend)
- `apps/web/src/stores/__tests__/moyin-persistence.test.ts` (new)

**Changes**:
- Add mocks for any new UI components (Switch/toggle, genre Select, etc.)
- Add tests for:
  - `persistShotMedia` with mocked Electron API
  - Persistence partialize excludes transient state
  - Create tab genre/synopsis form renders
  - End frame generate button conditional rendering
  - Storyboard split button conditional rendering
  - Audio toggles render and interact
  - `isModerationError` detection
- Run `bun lint:clean` and fix issues
- Run `npx tsc --noEmit` and verify clean
- Run `bun run build` and verify clean build
- Run `bun run test` and verify moyin tests pass

---

## Dependency Graph

```
Subtask 1 (Media persistence) ──→ Subtask 3 (End frame generation uses persistShotMedia)
                                      ↑
Subtask 2 (Per-project persistence) ──┘ (persist includes shot URLs)

Subtask 4 (Create mode) — independent
Subtask 5 (Character variations) — independent
Subtask 6 (Storyboard splitting) — independent
Subtask 7 (Audio toggles) — independent
Subtask 8 (Moderation errors) — independent

Subtask 9 (Tests + lint/build) — after all others
```

**Recommended order**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

Subtasks 4–8 are independent and can be parallelized after 1–3.

---

## Files Impact Summary

| File | Action |
|------|--------|
| `stores/moyin-shot-generation.ts` | Extend — `persistShotMedia`, `buildEndFramePrompt`, `isModerationError` |
| `stores/moyin-store.ts` | Extend — persist middleware, `generateEndFrameImage`, `generateScript`, variation CRUD |
| `stores/moyin-persistence.ts` | **New** — extracted persist config to stay under 800 lines |
| `moyin/character-variations.tsx` | **New** — variation list and CRUD UI |
| `moyin/storyboard-splitter.tsx` | **New** — storyboard split UI and apply-to-shots |
| `moyin/script-input.tsx` | Extend — Create tab with genre/synopsis/generate |
| `moyin/shot-detail.tsx` | Extend — end frame generate button, moderation error styling |
| `moyin/shot-selectors.tsx` | Extend — audio channel toggles |
| `moyin/property-panel.tsx` | Extend — character variations section |
| `moyin/generate-actions.tsx` | Extend — integrate storyboard splitter |
| `types/moyin-script.ts` | Extend — audio toggle fields on Shot |
| `moyin/__tests__/moyin-view.test.tsx` | Extend — tests for all new components |
| `stores/__tests__/moyin-persistence.test.ts` | **New** — persistence unit tests |

---

## Out of Scope (Future Work — Round 5+)

- **Scene viewpoint system** — Multi-viewpoint per scene, contact sheet generation (needs viewpoint AI + grid slicing)
- **Angle switch / 96-angle grid** — RunningHub API integration (external API dependency)
- **Quad grid (4-view variations)** — Multi-view generation (needs generation pipeline)
- **S-Class shot grouping** — Hierarchical shot groups with extend/edit workflows (massive feature)
- **Multi-provider API routing** — Feature binding, key rotation, provider sync (complex settings)
- **Image host integration** — External image hosting upload (needs provider config)
- **Character sheet generator** — Three-view + expression grid (dedicated generation pipeline)
- **AI character/scene finder** — Auto-link script entities to libraries (semantic matching)
- **Video last frame extraction** — FFmpeg/canvas frame extraction for visual continuity
- **Export/publication panel** — Timeline export and project publishing workflows
