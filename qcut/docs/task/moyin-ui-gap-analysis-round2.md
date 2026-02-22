# Moyin UI Gap Analysis Round 2 — QCut vs Original Moyin Creator

**Goal**: Close the remaining UI/feature gaps after Round 1 implementation. Focus on shot workflow polish, batch operations, media persistence, and timeline integration.

**Previous round**: `docs/task/moyin-ui-gap-analysis.md` (all 10 subtasks completed)

**Reference**: Original source at `/Users/peter/Desktop/code/moyin/moyin-creator/src/`

---

## What Round 1 Delivered

- Episode tree with expand/collapse hierarchy
- Shot-level CRUD in store + per-episode generation
- Import pipeline 6-step progress tracker
- Property panel (3rd column) with character/scene/shot/episode detail views
- Context menus on episode/scene/shot tree items
- Character grouping (main vs extras)
- Filter tabs (All/Pending/Completed)
- Episode create/edit dialogs
- Per-shot image/video generation (fal.ai)
- Generation helpers extracted to `moyin-shot-generation.ts`

---

## Remaining Gap Summary

| # | Feature | Original | QCut Status | Priority |
|---|---------|----------|-------------|----------|
| 1 | Three-tier prompt editing | Image/Video/EndFrame prompts per shot with EN/ZH | Basic text fields only | High |
| 2 | Shot breakdown view | Dedicated view with sticky headers, camera icons, dialogue | Tree view only | High |
| 3 | Batch generation + progress overlay | BatchProgressOverlay, rate limiting, abort | One-at-a-time only | High |
| 4 | Media persistence (Electron storage) | `saveImageToLocal()`, `local-image://` protocol | Temp fal.ai URLs only | High |
| 5 | Drag-to-timeline | Drag videos/images from shots to timeline | No integration | High |
| 6 | Emotion tags selector | Predefined tags (sad, tense, angry, etc.) per shot | Field exists, no UI | Medium |
| 7 | Shot size selector | Visual picker (CU, ECU, MS, WS, LS, etc.) | Plain text input | Medium |
| 8 | Duration selector | Per-shot duration (5-12s) with presets | Field exists, no UI | Medium |
| 9 | Ambient sound / SFX tags | Sound input + effect tag selector per shot | Fields exist, no UI | Medium |
| 10 | Copy data to clipboard | Per-item copy buttons for prompts/data | None | Medium |
| 11 | Character reference images | Upload/manage reference images for consistency | None | Medium |
| 12 | Scene viewpoint / multi-view | AI viewpoint analysis, contact sheet generation | None | Low |
| 13 | Character stage management | Multi-version characters (young/old variants) | None | Low |
| 14 | Trailer generation | Duration selector, AI shot selection for trailers | None | Low |
| 15 | Media preview modal | Full-size image/video preview overlay | Inline only | Low |
| 16 | Per-project persistence | Project-scoped Zustand persistence | Session-only | Low |

---

## Subtasks (Recommended Order)

### Subtask 1: Three-Tier Prompt Editing for Shots

**Time**: ~25 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (extend ShotDetail)
- `apps/web/src/components/editor/media-panel/views/moyin/prompt-editor.tsx` (new)

**Changes**:
- Create `PromptEditor` component with three collapsible sections:
  - **Image Prompt** (首帧): textarea for `imagePrompt` (EN) + `imagePromptZh` (ZH)
  - **Video Prompt** (视频): textarea for `videoPrompt` (EN) + `videoPromptZh` (ZH)
  - **End Frame Prompt** (尾帧): checkbox to enable `needsEndFrame`, textarea for `endFramePrompt` (EN) + `endFramePromptZh` (ZH)
- Each section has EN/ZH toggle tab
- Replace the flat prompt textareas in ShotDetail edit mode with `PromptEditor`
- Read mode shows prompts in labeled collapsible sections
- Copy button per prompt field

**Reference**: Original `split-scene-card.tsx` three-layer prompt display (lines 200-350)

**Tests**: `moyin-view.test.tsx` — PromptEditor renders three sections, EN/ZH toggle works

---

### Subtask 2: Shot Breakdown View

**Time**: ~30 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx` (new)
- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx` (add tab)

**Changes**:
- Create `ShotBreakdown` component:
  - Sticky scene headers (scene name, location, shot count)
  - Left index bar with shot numbers for quick nav
  - Shot rows showing: index, shot size badge, camera movement icon, truncated action summary, dialogue icon, character name tags, image/video status dots
  - Click to select shot (opens in PropertyPanel)
  - Compact visual layout optimized for scanning many shots
- Add "Shots" tab to StructurePanel between "Scenes" and "Generate"
- Show empty state when no shots generated

**Reference**: Original `shot-breakdown.tsx` (entire file ~220 lines)

**Tests**: `moyin-view.test.tsx` — renders shot rows, sticky headers, selection works

---

### Subtask 3: Shot Metadata Selectors (Shot Size, Duration, Emotion Tags, Sound)

**Time**: ~25 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-selectors.tsx` (new)
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (integrate)

**Changes**:
- Create reusable selector components:
  - **`ShotSizeSelector`**: grid of shot size buttons (ECU, CU, MCU, MS, MLS, FS, WS, EWS) with visual icons; maps to `shot.shotSize`
  - **`DurationSelector`**: slider or button group (5-12 seconds); maps to `shot.duration`
  - **`EmotionTagSelector`**: multi-select pill buttons for predefined emotions (sad, tense, serious, angry, scared, happy, excited, melancholic); maps to `shot.emotionTags[]`
  - **`SoundDesignInput`**: ambient sound textarea + SFX tag pills (rain, wind, fire, etc.); maps to `shot.ambientSound`, `shot.soundEffect`
- Integrate all four into ShotDetail (both read and edit mode)
- Read mode: badges/tags display; Edit mode: interactive selectors
- Use constants from `@/lib/moyin/presets/director-presets.ts` if available, else define locally

**Reference**: Original `emotion-tags.tsx`, `shot-size-selector.tsx`, `duration-selector.tsx`, `sound-effect-tags.tsx`, `ambient-sound-input.tsx`

**Tests**: `moyin-view.test.tsx` — each selector renders options, updates store on change

---

### Subtask 4: Batch Generation with Progress Overlay

**Time**: ~30 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/batch-progress.tsx` (new)
- `apps/web/src/stores/moyin-store.ts` (extend)
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx` (integrate)

**Changes**:
- Add batch state to store:
  ```typescript
  batchProgress: { isRunning: boolean; current: number; total: number; message: string } | null;
  batchAbortRef: { current: boolean };
  ```
- Add `generateAllShotImages()` action:
  - Iterates shots missing images (`imageStatus !== 'completed'`)
  - Rate-limited: 2-second delay between requests
  - Updates `batchProgress` on each iteration
  - Checks `batchAbortRef.current` before each request for cancellation
  - Uses `generateShotImageRequest` from helper
- Add `cancelBatchGeneration()` action: sets `batchAbortRef.current = true`
- Create `BatchProgressOverlay` component:
  - Dark overlay with centered progress card
  - Shows: "Generating shot N of M" + progress bar + percentage
  - Cancel button
  - Auto-dismisses on completion
- Add "Batch Generate All Images" button to GenerateActions panel
- Optionally add "Batch Generate All Videos" with same pattern

**Reference**: Original `BatchProgressOverlay` component pattern, `split-scenes.tsx` batch logic

**Tests**: `moyin-view.test.tsx` — overlay renders with progress, cancel button works

---

### Subtask 5: Copy Data to Clipboard

**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (extend)

**Changes**:
- Add copy button to each detail view header (CharacterDetail, SceneDetail, ShotDetail, EpisodeDetail)
- Copy formats:
  - **Character**: JSON with name, gender, age, role, appearance, visualPromptEn, tags
  - **Scene**: Markdown with location, time, atmosphere, visualPrompt, architectureStyle, lightingDesign
  - **Shot**: Structured text with action, camera, imagePrompt, videoPrompt, endFramePrompt, characters
  - **Episode**: Markdown with title, description, scene list, shot count
- Use `navigator.clipboard.writeText()` with toast feedback
- Add `CopyIcon` button with "Copied!" tooltip feedback (1.5s auto-dismiss)

**Reference**: Original `property-panel.tsx` copy buttons

**Tests**: `moyin-view.test.tsx` — copy button calls clipboard API

---

### Subtask 6: Media Persistence to Electron Storage

**Time**: ~30 min
**Files**:
- `apps/web/src/stores/moyin-shot-generation.ts` (extend)
- `apps/web/src/stores/moyin-store.ts` (extend)
- `electron/moyin-handler.ts` (extend or verify IPC exists)

**Changes**:
- After image/video generation succeeds, save to Electron local storage:
  - Call `window.electronAPI?.media?.saveFromUrl(url, filename)` to download and persist
  - Get back `local-image://` or local file path
  - Update shot with persistent `imageUrl` / `videoUrl`
- Add `persistShotMedia(shotId: string, type: 'image' | 'video', url: string)` helper
- Update `generateShotImageRequest` and `generateShotVideoRequest` to return both remote URL and trigger persistence
- Fallback: if Electron API unavailable (web-only dev), keep remote URL
- Optionally sync to media library: `window.electronAPI?.media?.addToLibrary({ type, url, name, projectId })`

**Reference**: Original `image-storage.ts`, `saveImageToLocal()`, `migrateBase64ToLocalImages()`

**Tests**: Unit test for persistence helper with mocked Electron API

---

### Subtask 7: Character Reference Images

**Time**: ~20 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (extend CharacterDetail)
- `apps/web/src/stores/moyin-store.ts` (extend)
- `apps/web/src/types/moyin-script.ts` (verify field exists)

**Changes**:
- Add `referenceImages?: string[]` to ScriptCharacter if not present
- Add reference image section to CharacterDetail:
  - Grid of thumbnail images (max 4)
  - Upload button (file input → FileReader → data URL → Electron save)
  - Remove button per image (X overlay on hover)
  - Used as reference in shot image generation prompt
- Add `updateCharacterReferenceImage(charId: string, images: string[])` store action
- Update `buildShotImagePrompt` in `moyin-shot-generation.ts` to include character reference info in prompt
- Show reference images in read mode as small thumbnails

**Reference**: Original `character-generator.tsx` referenceImages flow, `screenplay-input.tsx` character reference upload

**Tests**: `moyin-view.test.tsx` — upload button renders, image grid displays

---

### Subtask 8: Drag-to-Timeline Integration

**Time**: ~25 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (extend ShotDetail)
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx` (extend)
- `apps/web/src/stores/timeline-store.ts` (verify drop handler)

**Changes**:
- Add `draggable` attribute to generated image/video elements in ShotDetail
- Implement `onDragStart` handler:
  ```typescript
  const handleDragStart = (e: React.DragEvent, shot: Shot, type: 'image' | 'video') => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      id: shot.id,
      type: type === 'image' ? 'image' : 'video',
      name: `Shot ${shot.index + 1}`,
      url: type === 'image' ? shot.imageUrl : shot.videoUrl,
      duration: shot.duration || 5,
    }));
  };
  ```
- Add drag handle icon overlay on image/video previews
- Add drag affordance in ShotBreakdown rows (status dot → draggable if completed)
- Verify timeline drop handler accepts this data format (check existing drag-drop in timeline-store)
- Visual feedback: "Drag to timeline" tooltip on hover

**Reference**: Original `split-scene-card.tsx` `handleVideoDragStart()`, `shot-list-panel.tsx` drag support

**Tests**: `moyin-view.test.tsx` — drag event data format test

---

### Subtask 9: Media Preview Modal

**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/media-preview-modal.tsx` (new)
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (integrate)

**Changes**:
- Create `MediaPreviewModal` component:
  - Full-screen dark overlay with centered media
  - Image: full-resolution display with zoom capability
  - Video: full-size player with native controls
  - Close button (X) and click-outside-to-close
  - ESC key to close
  - Download button in header
- Trigger: click on image/video thumbnail in ShotDetail or ShotBreakdown
- State: local `useState` for open/close + media URL

**Reference**: Original `media-preview-modal.tsx`

**Tests**: `moyin-view.test.tsx` — modal opens on click, closes on ESC

---

### Subtask 10: Update Tests and Final Lint/Build

**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-view.test.tsx` (extend)

**Changes**:
- Add tests for all new components:
  - PromptEditor: three sections render, EN/ZH toggle
  - ShotBreakdown: renders shot rows grouped by scene
  - ShotSizeSelector: renders all size options
  - EmotionTagSelector: multi-select works
  - BatchProgressOverlay: renders progress, cancel button
  - MediaPreviewModal: opens/closes
  - Copy buttons: clipboard API called
- Run `bun lint:clean` and fix any issues
- Run `npx tsc --noEmit` and fix type errors
- Run `bun run build` and verify clean build
- Verify all moyin tests pass: `bun run test -- moyin`

---

## Dependency Graph

```
Subtask 1 (Prompt editor)
    ↓
Subtask 2 (Shot breakdown) ──→ Subtask 8 (Drag-to-timeline)
    ↓
Subtask 3 (Shot selectors) ──→ integrates into PropertyPanel + ShotBreakdown

Subtask 4 (Batch generation) — independent, uses existing store actions
Subtask 5 (Copy to clipboard) — independent, extends PropertyPanel
Subtask 6 (Media persistence) — independent, extends generation helpers
Subtask 7 (Character ref images) — independent, extends CharacterDetail
Subtask 9 (Media preview modal) — after Subtask 2 (needs shot images to preview)

Subtask 10 (Tests + lint/build) — after all others
```

**Recommended order**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

Subtasks 4, 5, 6, 7 are independent and can be parallelized.

---

## Files Impact Summary

| File | Action |
|------|--------|
| `moyin/prompt-editor.tsx` | **New** — three-tier prompt editing component |
| `moyin/shot-breakdown.tsx` | **New** — shot list view with scene headers |
| `moyin/shot-selectors.tsx` | **New** — shot size, duration, emotion, sound selectors |
| `moyin/batch-progress.tsx` | **New** — batch generation progress overlay |
| `moyin/media-preview-modal.tsx` | **New** — full-size media preview dialog |
| `moyin/property-panel.tsx` | Extend — integrate prompt editor, selectors, copy, drag, preview |
| `moyin/structure-panel.tsx` | Extend — add "Shots" tab |
| `moyin/generate-actions.tsx` | Extend — add batch generation button |
| `stores/moyin-store.ts` | Extend — batch state, batch actions, ref image support |
| `stores/moyin-shot-generation.ts` | Extend — media persistence helper |
| `moyin/__tests__/moyin-view.test.tsx` | Extend — tests for all new components |

---

## Out of Scope (Future Work — Round 3)

- Scene viewpoint / multi-view analysis — complex AI feature, needs contact sheet splitting
- Character stage management — multi-version character system with stage analysis
- Trailer generation — needs separate trailer workflow with shot selection
- Angle switch generation — needs RunningHub API integration
- Quad grid (4-view variations) — needs additional API endpoint
- Create mode AI script generation — needs full backend AI pipeline
- Per-project persistence — Zustand persist middleware migration
- Video last frame extraction — needs FFmpeg/canvas frame extraction
- Character sheet generator (three-view, expressions) — needs dedicated generation pipeline
