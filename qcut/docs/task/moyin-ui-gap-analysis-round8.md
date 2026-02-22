# Moyin UI Gap Analysis — Round 8: Drag-Reorder, Keyboard Shortcuts & Bulk Select

**Status**: Planning
**Previous**: Rounds 1–7 complete (foundational UI, shot workflow, cinematic vocabulary, persistence, wiring, visual review, accessibility)

## Overview

Round 8 focuses on interaction quality: drag-and-drop reordering, keyboard shortcuts for power users, multi-select with bulk actions, and episode quick-jump navigation. These features bring the Moyin panel closer to professional NLE-style workflows.

---

## Task 1: Drag-and-Drop Shot Reordering

**Goal**: Allow users to drag shots within a scene to reorder them in `shot-breakdown.tsx`.

**Approach**: Use native HTML5 drag events (no extra dependency) since shots are flat within a scene. Store exposes a `reorderShots` action that swaps indices.

**Files**:

- `apps/web/src/stores/moyin-store.ts` — add `reorderShots(shotId: string, targetIndex: number)` action
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx` — add `draggable`, `onDragStart`, `onDragOver`, `onDrop` to shot cards

**Subtasks**:

1. Add `reorderShots` action to store (swap shot positions within same `sceneRefId`)
2. Add drag state and handlers to `ShotCard` in `shot-breakdown.tsx`
3. Visual drop indicator (border highlight on drag-over target)

**Tests**: Verify reorder action moves shot to correct index; verify original shot list is unchanged when drag is cancelled.

---

## Task 2: Drag-and-Drop Scene Reordering

**Goal**: Allow users to drag scenes within an episode to reorder them in `episode-tree.tsx`.

**Approach**: Similar HTML5 drag pattern. Store exposes `reorderScenes(episodeId, sceneId, targetIndex)`.

**Files**:

- `apps/web/src/stores/moyin-store.ts` — add `reorderScenes(episodeId: string, sceneId: string, targetIndex: number)` action
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx` — add drag handlers to scene rows

**Subtasks**:

1. Add `reorderScenes` action (reorder sceneIds array in episode)
2. Add drag handlers to scene rows in episode tree
3. Visual drop indicator

**Tests**: Verify reorder action changes sceneIds order in episode.

---

## Task 3: Keyboard Shortcuts

**Goal**: Add keyboard shortcuts for common operations: Delete, Escape, Enter, arrow navigation.

**Approach**: Use `useEffect` with `keydown` listener in the structure panel. Selected item context determines action.

**Files**:

- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx` — add keyboard handler
- `apps/web/src/stores/moyin-store.ts` — add `deleteSelectedItem()` convenience action

**Shortcuts**:

| Key | Action |
| --- | --- |
| `Delete` / `Backspace` | Delete selected shot/scene/episode |
| `Escape` | Deselect current item |
| `ArrowUp` / `ArrowDown` | Navigate between items in current list |

**Subtasks**:

1. Add `deleteSelectedItem` and `selectNextItem` / `selectPrevItem` to store
2. Add `useEffect` keyboard listener to structure-panel
3. Ensure keyboard actions respect focus (don't interfere when editing inputs)

**Tests**: Verify delete keyboard shortcut removes selected item; verify Escape clears selection.

---

## Task 4: Multi-Select with Bulk Delete

**Goal**: Allow selecting multiple shots for batch deletion.

**Approach**: Add `selectedShotIds: Set<string>` to store. Shift+click adds to selection. Bulk delete button appears when multiple selected.

**Files**:

- `apps/web/src/stores/moyin-store.ts` — add `selectedShotIds`, `toggleShotSelection`, `clearShotSelection`, `deleteSelectedShots`
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx` — add Shift+click multi-select, selection highlight, bulk action bar

**Subtasks**:

1. Add multi-select state and actions to store
2. Add Shift+click handler to shot cards
3. Add floating bulk action bar with delete button + count badge
4. Clear selection after bulk delete

**Tests**: Verify multi-select adds/removes shots; verify bulk delete removes all selected.

---

## Task 5: Tests for Round 8

**Files**:

- `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-view.test.tsx`
- `apps/web/src/stores/__tests__/moyin-store-reorder.test.ts` (new, for reorder + delete logic)

**Test cases**:

- `reorderShots` moves shot within scene correctly
- `reorderScenes` reorders sceneIds in episode
- `deleteSelectedItem` removes current selection
- `toggleShotSelection` adds/removes from selectedShotIds
- `deleteSelectedShots` removes all selected shots
- Keyboard Delete triggers deletion of selected item
- Keyboard Escape clears selection

---

## Estimated Complexity

| Task | Scope | Files Changed |
| --- | --- | --- |
| 1. Shot drag reorder | Medium | 2 (store + shot-breakdown) |
| 2. Scene drag reorder | Medium | 2 (store + episode-tree) |
| 3. Keyboard shortcuts | Medium | 2 (structure-panel + store) |
| 4. Multi-select bulk delete | Medium | 2 (store + shot-breakdown) |
| 5. Tests | Medium | 2 (test files) |
