# Moyin UI Gap Analysis — Round 11: Progress Bars, Inline Edit, Onboarding

## Overview
Round 11 adds visible progress indicators during shot generation, inline
episode title editing, and a brief onboarding workflow guide.

## Subtasks

### 11.1 Shot Generation Progress Bars
Surface `imageProgress` and `videoProgress` as visible progress bars during
generation, rather than just a spinner.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`

**Changes**:
- Import `Progress` component from `@/components/ui/progress`
- Below the generation buttons, show `<Progress value={shot.imageProgress} />`
  when `imageStatus === "generating"`
- Show `<Progress value={shot.videoProgress} />` when `videoStatus === "generating"`
- Display percentage text next to progress bar

---

### 11.2 Episode Title Inline Editing (Double-Click)
Allow users to double-click an episode title in the tree to rename it in-place.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`

**Changes**:
- Add `editingEpisodeId` state
- On double-click episode row, set editingEpisodeId and render an input
- On blur or Enter, save via `updateEpisode(id, { title })`
- On Escape, cancel editing

---

### 11.3 Workflow Onboarding Card
Show a brief workflow guide in the script input panel when no script has been
entered yet.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/script-input.tsx`

**Changes**:
- When `rawScript === ""` and `parseStatus === "idle"`, show a compact 3-step
  guide card above the textarea:
  1. Import or create a script
  2. Review characters & scenes
  3. Generate storyboard & shots

---

### 11.4 Round 11 Tests
Write tests for progress bars, inline editing, and onboarding card.

**Verification**:
- All new tests pass
- All existing 79 moyin tests still pass
- Build succeeds
- moyin-store.ts stays ≤ 800 lines
