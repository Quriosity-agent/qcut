# Moyin UI Gap Analysis — QCut vs Original Moyin Creator

**Goal**: Close the UI/feature gaps between QCut's Moyin panel and the original Moyin Creator's script panel to reach feature parity.

**Reference**: Original source at `/Users/peter/Desktop/code/moyin/moyin-creator/src/components/panels/script/`

---

## Gap Summary

| # | Feature | Original | QCut | Priority |
|---|---------|----------|------|----------|
| 1 | Episode tree with expand/collapse | Full hierarchy (episode → scene → shot) | Flat overview stats only | High |
| 2 | Shot-level management | Per-shot CRUD, tri-layer prompts, status | No shots at all | High |
| 3 | Import pipeline progress | 6-step pipeline with visual tracking | Single "Parse Script" button | High |
| 4 | Property panel (3rd column) | Selected item detail view with all fields | None | Medium |
| 5 | Context menus on tree items | Dropdown actions per episode/scene/shot | None | Medium |
| 6 | Character grouping (protagonist/extras) | Split by tags, collapsible extras section | Flat list | Medium |
| 7 | Filter tabs (all/pending/completed) | On episode tree header | None | Medium |
| 8 | AI search dialogs for add scene/character | AI-powered search before creating | Creates blank items | Low |
| 9 | Trailer generation tab | Duration selector, AI shot selection | None | Low |
| 10 | Export panel | Stats, toggle switches, folder export | None | Low |
| 11 | Shot breakdown view | Visual shot list with scene headers | None | Low |
| 12 | Copy data to clipboard | Per-item copy buttons | None | Low |
| 13 | Episode CRUD dialogs | Create/edit/delete with confirmation | None | Medium |
| 14 | Per-shot image/video generation | Individual shot generation with char refs | Whole-storyboard only | Medium |
| 15 | Create mode AI script generation | Idea input → generated script | Placeholder only | Low |

---

## Subtasks (Recommended Order)

### Subtask 1: Add Shot Type to Store and Wire Shot Generation per Episode
**Time**: ~25 min
**Files**:
- `apps/web/src/stores/moyin-store.ts` (extend)
- `apps/web/src/types/moyin-script.ts` (already has `Shot` type)

**Changes**:
- Add `shots: Shot[]` array to MoyinState
- Add `addShot`, `updateShot`, `removeShot` CRUD actions
- Add `generateShotsForEpisode(episodeId: string)` action that calls `moyin.callLLM` to break scenes into shots
- Add `shotGenerationStatus: Record<string, 'idle' | 'generating' | 'done' | 'error'>` per episode
- Wire `parseScript` to populate `shots` from parsed data (if the API returns them)
- Add `selectedShotId: string | null` to state for property panel selection

**Reference**: Original store manages shots nested under scenes with generation status per episode

---

### Subtask 2: Build Expandable Episode Tree Component
**Time**: ~30 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx` (new)
- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx` (integrate)

**Changes**:
- Create `EpisodeTree` component with 3-level hierarchy:
  - **Episode row**: expand toggle (ChevronRight/Down) + Film icon + title + progress badge (e.g., "3/12")
  - **Scene row** (nested): MapPin icon + scene name + status icon (circle/clock/check) + shot count
  - **Shot row** (nested under scene): index number + shot size + action summary (truncated) + status dot
- Each level indented with `pl-4` / `pl-8`
- Click row to select item → updates `selectedItemId` / `selectedItemType` in store
- Hover reveals action menu trigger (MoreHorizontal icon)
- Replace current `OverviewContent` in StructurePanel with `EpisodeTree`

**Reference**: Original `episode-tree.tsx` lines 558–900

---

### Subtask 3: Add Context Menus on Tree Items
**Time**: ~20 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx` (extend)

**Changes**:
- **Episode context menu** (DropdownMenu):
  - "Generate Shots" — calls `generateShotsForEpisode`
  - "AI Calibrate Shots" — post-generation calibration
  - "Add Scene" — appends scene to episode
  - "Edit" — inline edit title/description
  - "Delete" — with confirmation dialog
- **Scene context menu**:
  - "AI Calibrate" — calls `enhanceScenes` for single scene
  - "Edit" — inline edit
  - "Delete" — with confirmation
- **Shot context menu**:
  - "Delete" — with confirmation
- Use `DropdownMenu` from `@/components/ui/dropdown-menu`

**Reference**: Original `episode-tree.tsx` lines 650–780

---

### Subtask 4: Add Filter Tabs and Progress to Episode Tree Header
**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx` (extend)

**Changes**:
- Add header bar above tree: script title + genre badge + overall progress (e.g., "12/49")
- Add filter button group: All | Pending | Completed
  - Filter logic: "pending" = shots without images, "completed" = shots with images
- Add toolbar buttons:
  - "AI Scene Calibration" — bulk calibrate all scenes
  - "Refresh All" — re-parse/update
  - "New Episode" — create new empty episode

**Reference**: Original `episode-tree.tsx` lines 558–620

---

### Subtask 5: Add Character Grouping (Protagonist vs Extras)
**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx` (extend)

**Changes**:
- Split characters into two groups based on `tags`:
  - **Main characters**: tags include "protagonist" or "supporting" (or no tags = default main)
  - **Extras/Minor**: tags include "minor", "extra", "background"
- Render main characters first in a section with "Characters (N)" header
- Render extras in a collapsible section: "Extras (N)" with ChevronDown toggle, dashed border
- Add protagonist/extras detection logic:
  ```typescript
  const isExtra = (c: ScriptCharacter) =>
    c.tags?.some(t => ['minor', 'extra', 'background', '群演', '配角'].includes(t));
  ```

**Reference**: Original `episode-tree.tsx` lines 900–1000 (character sections)

---

### Subtask 6: Build Import Pipeline Progress Tracker
**Time**: ~20 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/import-progress.tsx` (new)
- `apps/web/src/components/editor/media-panel/views/moyin/script-input.tsx` (integrate)
- `apps/web/src/stores/moyin-store.ts` (extend)

**Changes**:
- Define pipeline steps enum:
  ```typescript
  type PipelineStep = 'import' | 'title_calibration' | 'synopsis' |
    'shot_calibration' | 'character_calibration' | 'scene_calibration';
  ```
- Add `pipelineStep: PipelineStep | null` and `pipelineProgress: Record<PipelineStep, 'pending' | 'active' | 'done' | 'error'>` to store
- Create `ImportProgress` component:
  - Vertical step list with icons per step
  - Active step: primary color + spinner
  - Done step: green checkmark
  - Pending step: muted circle
  - Error step: red X
- Show below Parse Script button when pipeline is active
- Update `parseScript` action to progress through pipeline steps

**Reference**: Original `script-input.tsx` lines 400–550 (pipeline progress)

---

### Subtask 7: Add Episode CRUD Dialogs
**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-dialog.tsx` (new)
- `apps/web/src/stores/moyin-store.ts` (extend)

**Changes**:
- Create/Edit dialog with:
  - Title input
  - Description textarea
  - Save/Cancel buttons
- Delete confirmation dialog (AlertDialog)
- Add to store:
  - `addEpisode(ep: Episode)` action
  - `updateEpisode(id: string, updates: Partial<Episode>)` action
  - `removeEpisode(id: string)` action
- Wire to "New Episode" and "Edit" context menu actions

**Reference**: Original `episode-tree.tsx` lines 200–280 (episode dialog)

---

### Subtask 8: Build Property Panel for Selected Items
**Time**: ~30 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (new)
- `apps/web/src/components/editor/media-panel/views/moyin/index.tsx` (extend to 3-panel layout)

**Changes**:
- Add optional 3rd panel (collapsible) that appears when an item is selected
- Layout becomes: ScriptInput (30%) | EpisodeTree (40%) | PropertyPanel (30%)
- PropertyPanel switches content based on `selectedItemType`:
  - **Character**: All ScriptCharacter fields in form layout, identity anchors display, negative prompts, tags, "Copy" button
  - **Scene**: All ScriptScene fields, scene design section (architecture, lighting, color palette, key props), visual prompts (EN/ZH), appearance stats
  - **Shot**: Action summary, dialogue, shot size, camera movement, tri-layer prompt system (image/video/end-frame in EN/ZH), character names, emotion tags
  - **Episode**: Title, synopsis, shot list summary, generate/calibrate buttons
- Each view has Edit/Save/Cancel toggle and a "Copy Data" clipboard button
- Property panel is ~30% width, adjustable via ResizableHandle

**Reference**: Original `property-panel.tsx` (entire file)

---

### Subtask 9: Wire Per-Shot Image/Video Generation
**Time**: ~20 min
**Files**:
- `apps/web/src/stores/moyin-store.ts` (extend)
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx` (extend)

**Changes**:
- Add `generateShotImage(shotId: string)` action:
  - Uses shot's `imagePrompt` + character visual descriptions + style tokens
  - Calls fal.ai for single image generation
  - Updates `shot.imageStatus`, `shot.imageUrl`
- Add `generateShotVideo(shotId: string)` action:
  - Uses shot's `videoPrompt` + generated image as reference
  - Calls fal.ai video generation
  - Updates `shot.videoStatus`, `shot.videoUrl`
- Add generation buttons to Shot property view:
  - "Generate Image" button with status indicator
  - "Generate Video" button (enabled after image exists)
  - Character variation selector (which version of each character to use)
- Show generated image/video inline in property panel

**Reference**: Original `shot-list.tsx` (per-shot generation controls)

---

### Subtask 10: Update Tests for New Components
**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-view.test.tsx` (extend)

**Changes**:
- Add tests for EpisodeTree:
  - Renders empty state when no episodes
  - Renders episode hierarchy when data exists
  - Expand/collapse episodes
  - Filter tabs work
- Add tests for CharacterList grouping:
  - Main vs extras separation
  - Collapsible extras section
- Add tests for ImportProgress:
  - Shows pipeline steps
  - Active step has spinner
  - Done step has checkmark
- Add tests for PropertyPanel:
  - Renders character fields when character selected
  - Renders scene fields when scene selected
  - Edit/save toggle works

---

## Dependency Graph

```
Subtask 1 (Store: shots)
    ↓
Subtask 2 (Episode tree) ──→ Subtask 4 (Filters/progress)
    ↓                            ↓
Subtask 3 (Context menus)   Subtask 7 (Episode CRUD)
    ↓
Subtask 8 (Property panel)
    ↓
Subtask 9 (Per-shot generation)

Independent:
Subtask 5 (Character grouping) — can be done anytime
Subtask 6 (Import pipeline) — can be done anytime

Subtask 10 (Tests) — after all others
```

**Recommended order**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

---

## Files Impact Summary

| File | Action |
|------|--------|
| `stores/moyin-store.ts` | Extend — shots, episodes CRUD, pipeline, per-shot generation |
| `moyin/index.tsx` | Extend — optional 3rd panel for property view |
| `moyin/episode-tree.tsx` | **New** — expandable hierarchy with context menus, filters |
| `moyin/episode-dialog.tsx` | **New** — episode create/edit/delete dialogs |
| `moyin/import-progress.tsx` | **New** — 6-step pipeline progress tracker |
| `moyin/property-panel.tsx` | **New** — selected item detail view (char/scene/shot/episode) |
| `moyin/character-list.tsx` | Extend — protagonist/extras grouping |
| `moyin/structure-panel.tsx` | Adapt — replace overview with episode tree |
| `moyin/__tests__/moyin-view.test.tsx` | Extend — tests for new components |

---

## Out of Scope (Future Work)

- Create mode AI script generation — needs backend AI pipeline
- Trailer generation tab — separate workflow
- Export panel — needs asset management system
- Shot breakdown visual view — nice-to-have after shot management works
- Multi-viewpoint joint diagram analysis — advanced AI feature
- Copy data to clipboard — small polish, add after core features
- Second-pass calibration ("2次") — optimization after basic calibration works
