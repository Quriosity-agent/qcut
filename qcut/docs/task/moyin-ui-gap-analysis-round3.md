# Moyin UI Gap Analysis Round 3 — QCut vs Original Moyin Creator

**Goal**: Close the remaining feature gaps after Rounds 1 and 2. Focus on cinematic vocabulary UI, character reference images, media persistence, per-project persistence, and narrative design fields.

**Previous rounds**:
- `docs/task/moyin-ui-gap-analysis.md` — Round 1 (10 subtasks, all completed)
- `docs/task/moyin-ui-gap-analysis-round2.md` — Round 2 (10 subtasks, 9 completed)

**Reference**: Original source at `/Users/peter/Desktop/code/moyin/moyin-creator/src/`

---

## What Rounds 1 & 2 Delivered

- Episode tree with hierarchy, expand/collapse, filter tabs, context menus
- Character grouping (main vs extras), character CRUD + AI enhancement
- Scene CRUD + AI enhancement, scene list
- Shot generation from episodes (LLM-based), per-shot CRUD
- Per-shot image generation (fal.ai Flux Pro) + video generation (fal.ai WAN)
- Import pipeline 6-step progress tracker
- Property panel (3rd column) with character/scene/shot/episode detail views
- Three-tier prompt editing (Image/Video/EndFrame with EN/ZH toggle)
- Shot breakdown view (grouped by scene, sticky headers)
- Shot metadata selectors (shot size, duration, emotion tags, sound design)
- Batch generation with progress overlay + abort support
- Copy-to-clipboard for all item types
- Media preview modal (fullscreen image/video viewer)
- Drag-to-timeline support (dataTransfer with shot data)
- Visual style selection (58 presets) + cinematography profile selection (18 profiles)
- Storyboard grid generation

---

## Remaining Gap Summary

| # | Feature | Original | QCut Status | Priority |
|---|---------|----------|-------------|----------|
| 1 | Cinematic vocabulary selectors | Full UI for all 5 professional roles (gaffer, focus, rig, SFX, speed) | Type fields exist, no UI | High |
| 2 | Narrative design fields | narrativeFunction, shotPurpose, visualFocus, blocking, rhythm | Type fields exist, no UI | High |
| 3 | Character reference images | Upload/manage reference images for generation consistency | Type field missing | High |
| 4 | Media persistence (Electron) | `saveImageToLocal()`, `local-image://` protocol | Temp fal.ai URLs only | High |
| 5 | End frame image support | Separate end frame image with source tracking | Prompt exists, no image | Medium |
| 6 | Camera angle / focal length / technique selectors | Dropdown/button pickers | Type fields exist, no UI | Medium |
| 7 | Per-project persistence | Project-scoped Zustand persistence | Session-only state | Medium |
| 8 | Character identity anchors UI | 6-layer anchor display + edit | Type exists, no UI | Medium |
| 9 | Storyboard image splitting | Upload storyboard → split into individual shots | No workflow | Low |
| 10 | Trailer generation | AI shot selection for trailers | No workflow | Low |
| 11 | Character stage variants | Multi-version characters (young/old) with episode ranges | No workflow | Low |
| 12 | Scene viewpoint system | Multi-viewpoint per scene, contact sheet | No workflow | Low |
| 13 | Angle switch / 96-angle grid | RunningHub API integration | No workflow | Low |
| 14 | S-Class (Seedance 2.0) | Multi-modal video, shot groups, asset references | No workflow | Low |

---

## Subtasks (Recommended Order)

### Subtask 1: Cinematic Vocabulary Selectors

**Time**: ~30 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/cinema-selectors.tsx` (new)
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (integrate)

**Changes**:
- Create reusable selector components for Shot's cinematic vocabulary fields:
  - **`LightingStyleSelector`**: buttons for LightingStyle enum (high-key, low-key, silhouette, chiaroscuro, natural, neon, candlelight, moonlight)
  - **`LightingDirectionSelector`**: buttons for LightingDirection enum (front, side, back, top, bottom, rim, three-point)
  - **`ColorTemperatureSelector`**: buttons for ColorTemperature enum (warm, neutral, cool, golden-hour, blue-hour, mixed)
  - **`DepthOfFieldSelector`**: buttons for DepthOfField enum (ultra-shallow to deep, split-diopter)
  - **`CameraRigSelector`**: buttons for CameraRig enum (tripod, handheld, steadicam, dolly, crane, drone, shoulder, slider)
  - **`AtmosphericEffectsSelector`**: multi-select pills for AtmosphericEffect enum (rain, snow, fog, smoke, fire, sparks, etc.)
  - **`EffectIntensitySelector`**: buttons for EffectIntensity (subtle, moderate, heavy)
  - **`PlaybackSpeedSelector`**: buttons for PlaybackSpeed enum (slow-motion 4x/2x, normal, fast 2x, timelapse)
- Each selector follows the same pattern as existing selectors in `shot-selectors.tsx`:
  - `value` + `onChange` + `readOnly` props
  - Button grid in edit mode, badge display in read mode
- Import all enum types from `@/types/moyin-script`
- Group selectors into collapsible sections in ShotDetail:
  - **Lighting** (Gaffer): style + direction + color temp + notes textarea
  - **Focus**: depth of field + focus target input + focus transition buttons
  - **Camera Rig**: rig type + movement speed
  - **Atmosphere**: effects multi-select + intensity
  - **Speed**: playback speed

**Reference**: Original `split-scene-card.tsx` cinematic fields, `cinematography-profiles.ts`

**Tests**: Selectors render options, update on click

---

### Subtask 2: Camera Angle, Focal Length, Photography Technique Selectors

**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/cinema-selectors.tsx` (extend)
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (integrate)

**Changes**:
- Add three more selectors to `cinema-selectors.tsx`:
  - **`CameraAngleSelector`**: buttons for CameraAngle enum (eye-level, high-angle, low-angle, birds-eye, worms-eye, over-shoulder, side-angle, dutch-angle, third-person)
  - **`FocalLengthSelector`**: buttons for FocalLength enum (8mm through 400mm)
  - **`PhotographyTechniqueSelector`**: buttons for PhotographyTechnique enum (long-exposure, double-exposure, macro, tilt-shift, high-speed, bokeh, reflection, silhouette)
- Integrate into ShotDetail under a "Camera" collapsible section
- Update `startEdit` in ShotDetail to include `cameraAngle`, `focalLength`, `photographyTechnique`
- Read mode: show as badges

**Reference**: Original cinematic fields UI

**Tests**: Selectors render, values update

---

### Subtask 3: Narrative Design Fields

**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (extend ShotDetail)

**Changes**:
- Add a collapsible "Narrative" section to ShotDetail (both edit and read modes):
  - **narrativeFunction**: dropdown/buttons (exposition, escalation, climax, turning-point, transition, denouement)
  - **shotPurpose**: textarea ("Why this shot?")
  - **visualFocus**: textarea ("What should viewers look at first?")
  - **cameraPosition**: textarea (machine position relative to actors)
  - **characterBlocking**: textarea (actor positioning in frame)
  - **rhythm**: buttons or input (pacing feel)
- Update `startEdit` to include all 6 narrative fields
- Read mode: FieldRow display for text fields, badge for narrativeFunction

**Reference**: Original `narrativeFunction`, `shotPurpose`, `visualFocus` fields in SplitScene

**Tests**: Narrative fields render, save correctly

---

### Subtask 4: Character Reference Images

**Time**: ~20 min
**Files**:
- `apps/web/src/types/moyin-script.ts` (add `referenceImages` field)
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (extend CharacterDetail)
- `apps/web/src/stores/moyin-store.ts` (verify updateCharacter handles arrays)

**Changes**:
- Add `referenceImages?: string[]` to `ScriptCharacter` interface
- Add reference image section to CharacterDetail read mode:
  - Grid of thumbnail images (max 4, aspect-ratio square)
  - "Add Reference" button (file input → FileReader → data URL)
  - Remove button (X overlay on hover) per image
- Edit mode: same grid with add/remove
- Store: `updateCharacter` already handles partial updates, no change needed
- Update `buildShotImagePrompt` in `moyin-shot-generation.ts` to mention character reference info in prompt context
- Read mode: show thumbnails in 2x2 grid

**Reference**: Original `character-generator.tsx` referenceImages, `screenplay-input.tsx` upload

**Tests**: Upload button renders, image grid displays, remove works

---

### Subtask 5: Media Persistence to Electron Storage

**Time**: ~25 min
**Files**:
- `apps/web/src/stores/moyin-shot-generation.ts` (extend)
- `apps/web/src/stores/moyin-store.ts` (update generateShotImage/Video to persist)

**Changes**:
- Add `persistShotMedia(url: string, filename: string)` helper to `moyin-shot-generation.ts`:
  - If `window.electronAPI?.media?.saveFromUrl` exists: download and persist, return local path
  - Otherwise: return the original URL (web-only fallback)
- Update `generateShotImage` action in store:
  - After fal.ai returns URL, call `persistShotMedia(url, shotId-image.png)`
  - Store the local path as `imageUrl`
- Update `generateShotVideo` action in store:
  - After fal.ai returns URL, call `persistShotMedia(url, shotId-video.mp4)`
  - Store the local path as `videoUrl`
- Verify Electron IPC handler exists for `media.saveFromUrl`
  - If not, check `electron/media-handler.ts` and document what's needed

**Reference**: Original `image-storage.ts`, `saveImageToLocal()`

**Tests**: Unit test for `persistShotMedia` with mocked Electron API

---

### Subtask 6: End Frame Image Support

**Time**: ~20 min
**Files**:
- `apps/web/src/types/moyin-script.ts` (add end frame image fields to Shot)
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (extend ShotDetail)
- `apps/web/src/stores/moyin-store.ts` (add generateEndFrameImage action)
- `apps/web/src/stores/moyin-shot-generation.ts` (add helper)

**Changes**:
- Add to Shot type:
  ```typescript
  endFrameImageUrl?: string;
  endFrameImageStatus?: ShotStatus;
  endFrameImageError?: string;
  endFrameSource?: 'upload' | 'ai-generated' | 'next-scene' | 'video-extracted';
  ```
- Add `generateEndFrameImage(shotId: string)` action to store:
  - Uses `endFramePrompt` (or falls back to `imagePrompt`)
  - Calls `generateFalImage` with the prompt
  - Updates `endFrameImageUrl` and `endFrameImageStatus`
- Add end frame section to ShotDetail read mode:
  - Show end frame image thumbnail (if exists) below main image
  - "Generate End Frame" button (only when `needsEndFrame` is true)
  - Source badge (upload/ai-generated/next-scene/video-extracted)
  - Upload button to manually set end frame from file
- Add end frame toggle display in read mode

**Reference**: Original SplitScene `endFrameImageUrl`, `endFrameSource`

**Tests**: End frame generation button renders, image displays

---

### Subtask 7: Character Identity Anchors UI

**Time**: ~20 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (extend CharacterDetail)

**Changes**:
- Add collapsible "Identity Anchors" section to CharacterDetail read mode:
  - Show each populated layer as a labeled field:
    - Layer 1: Bone Structure (faceShape, jawline, cheekbones)
    - Layer 2: Facial Features (eyeShape, noseShape, lipShape)
    - Layer 3: Unique Marks (birthmarks, scars)
    - Layer 4: Color Anchors (irisColor, hairColor, skinTone, lipColor)
    - Layer 5: Skin Texture
    - Layer 6: Hair Style & Hairline
  - Only show layers that have data
- Add "Negative Prompt" display:
  - Show `avoid` list as red-tinted badges
  - Show `styleExclusions` as outline badges
- Edit mode: text inputs for each anchor field
- Note: Identity anchors are populated by AI calibration (`enhanceCharacters`), not manual entry — but allow manual editing

**Reference**: Original character calibration display, `CharacterIdentityAnchors` type

**Tests**: Anchors render when populated, hidden when empty

---

### Subtask 8: Collapsible Sections in ShotDetail

**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/collapsible-section.tsx` (new)
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (refactor ShotDetail)

**Changes**:
- Create a reusable `CollapsibleSection` component:
  ```typescript
  function CollapsibleSection({ title, icon, defaultOpen, children }: {
    title: string;
    icon?: React.ElementType;
    defaultOpen?: boolean;
    children: React.ReactNode;
  })
  ```
  - Chevron toggle (down = open, right = collapsed)
  - Compact header with 10px font
  - Remembers open/closed state per section
- Wrap ShotDetail fields into collapsible groups:
  - **Core** (always open): action summary, camera movement, dialogue
  - **Shot Settings**: shot size, duration
  - **Lighting** (Gaffer): cinematic vocabulary (Subtask 1)
  - **Camera**: angle, focal length, technique (Subtask 2)
  - **Focus**: depth of field, focus target, transition
  - **Atmosphere**: atmospheric effects, intensity
  - **Emotion & Sound**: emotion tags, ambient sound, SFX
  - **Narrative**: narrative function, purpose, focus, blocking, rhythm (Subtask 3)
  - **Prompts**: three-tier prompt editor (already collapsible internally)
  - **Characters**: character names/badges
  - **Media**: image preview, video preview, generation buttons
- This prevents the ShotDetail from becoming overwhelmingly long

**Reference**: Original property panel sections

**Tests**: Sections expand/collapse, content renders

---

### Subtask 9: Per-Project Persistence

**Time**: ~25 min
**Files**:
- `apps/web/src/stores/moyin-store.ts` (add persist middleware)

**Changes**:
- Add Zustand `persist` middleware to `useMoyinStore`:
  - Storage key: `moyin-project-{projectId}`
  - Persist: `rawScript`, `scriptData`, `parseStatus`, `characters`, `scenes`, `shots`, `episodes`, `selectedStyleId`, `selectedProfileId`
  - Skip: transient state (`generationStatus`, `generationProgress`, `generationError`, calibration status, pipeline status, batch state)
  - Use `partialize` to select only persistent fields
- Get `projectId` from URL (TanStack Router `useParams` or passed as prop)
- Add version number for migration support
- Add `clearProjectData(projectId: string)` action to remove persisted data
- Handle migration: when version changes, merge new defaults with persisted state

**Reference**: Original `director-store.ts` per-project persistence pattern

**Tests**: Store persists after reload (manual test), version migration works

---

### Subtask 10: Update Tests and Final Lint/Build

**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-view.test.tsx` (extend)

**Changes**:
- Add mock for any new UI components used (if any)
- Add new icon mocks to lucide-react mock (if any new icons imported)
- Add tests for:
  - CinemaSelectors: render options, update on click
  - CollapsibleSection: expand/collapse toggle
  - CharacterDetail: reference images grid renders
  - Narrative fields: render in ShotDetail
  - End frame: generate button renders when needsEndFrame is true
  - Identity anchors: render when populated
- Run `bun lint:clean` and fix issues
- Run `npx tsc --noEmit` and fix type errors
- Run `bun run build` and verify clean build
- Run `bun run test -- moyin` and verify all tests pass

---

## Dependency Graph

```
Subtask 1 (Cinema selectors) ──→ Subtask 8 (Collapsible sections, integrates cinema)
                                     ↑
Subtask 2 (Angle/focal/technique) ──┘
Subtask 3 (Narrative fields) ───────┘

Subtask 4 (Character ref images) — independent
Subtask 5 (Media persistence) — independent
Subtask 6 (End frame images) — independent
Subtask 7 (Identity anchors UI) — independent
Subtask 9 (Per-project persistence) — independent (but should be last before tests)

Subtask 10 (Tests + lint/build) — after all others
```

**Recommended order**: 1 → 2 → 3 → 8 → 4 → 5 → 6 → 7 → 9 → 10

Subtasks 4, 5, 6, 7 are independent and can be parallelized.

---

## Files Impact Summary

| File | Action |
|------|--------|
| `moyin/cinema-selectors.tsx` | **New** — lighting, rig, atmosphere, speed, angle, focal length, technique selectors |
| `moyin/collapsible-section.tsx` | **New** — reusable collapsible section component |
| `moyin/property-panel.tsx` | Extend — integrate cinema selectors, narrative fields, ref images, end frame, anchors, collapsible layout |
| `types/moyin-script.ts` | Extend — add `referenceImages` to ScriptCharacter, add end frame image fields to Shot |
| `stores/moyin-store.ts` | Extend — persist middleware, generateEndFrameImage action |
| `stores/moyin-shot-generation.ts` | Extend — persistShotMedia helper, end frame generation |
| `moyin/__tests__/moyin-view.test.tsx` | Extend — tests for all new components |

---

## Out of Scope (Future Work — Round 4+)

- **Storyboard image splitting** — Upload storyboard → AI split into shots (needs backend image analysis + grid splitting)
- **Trailer generation** — AI shot selection for trailers (needs duration analysis, narrative scoring, spoiler avoidance)
- **Character stage variants** — Multi-version characters with episode ranges (complex UI + stage analysis AI)
- **Scene viewpoint system** — Multi-viewpoint per scene, contact sheet generation (needs grid slicing, viewpoint AI)
- **Angle switch / 96-angle grid** — RunningHub API integration (external API dependency)
- **Quad grid (4-view variations)** — Multi-view generation (needs generation pipeline)
- **S-Class (Seedance 2.0)** — Multi-modal video generation, shot groups, asset references (massive feature, needs Seedance 2.0 API)
- **Character sheet generator** — Three-view + expression grid (needs dedicated generation pipeline)
- **AI character/scene finder** — Auto-link script entities to libraries (semantic matching)
- **API provider management** — Multi-provider routing, feature binding UI (complex settings)
- **Video last frame extraction** — FFmpeg/canvas frame extraction for visual continuity
- **Create mode AI script generation** — Full screenplay generation from synopsis (backend AI pipeline)
- **Media library** — Full folder-organized media browser (separate from shot images)
