# Moyin UI Gap Analysis — Round 9: Export, Undo/Redo, Episode Navigation

**Status**: Planning
**Previous**: Rounds 1–8 complete (foundational UI, workflow, cinematic vocabulary, persistence, wiring, visual review, accessibility, interaction quality)

## Overview

Round 9 focuses on production workflow: JSON project export/import for backup and collaboration, a simple undo/redo system for critical edits, and episode quick-jump navigation for large scripts.

---

## Task 1: JSON Project Export/Import

**Goal**: Export full moyin project state as JSON file. Import from previously exported JSON.

**Approach**: Serialize the partialized store state to JSON and trigger browser download. Import reads the JSON file and loads it into store.

**Files**:

- `apps/web/src/stores/moyin-persistence.ts` — add `exportProjectJSON()` and `importProjectJSON(json)` helpers
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx` — add Export JSON / Import JSON buttons alongside existing Markdown export

**Subtasks**:

1. Add `exportProjectJSON` helper that serializes store state to downloadable JSON blob
2. Add `importProjectJSON` helper that validates and loads JSON into store
3. Add Export/Import buttons in generate-actions.tsx
4. Handle file input for import via hidden `<input type="file">`

**Tests**: Verify export produces valid JSON; verify import restores state correctly.

---

## Task 2: Simple Undo/Redo

**Goal**: Track shot/scene/character edits and allow undo/redo of the last N changes.

**Approach**: Lightweight undo stack stored in memory (not persisted). Push previous state slice before each mutation. Limit to 20 entries to avoid memory issues.

**Files**:

- `apps/web/src/stores/moyin-undo.ts` (new) — undo/redo stack with push/pop/redo operations
- `apps/web/src/stores/moyin-store.ts` — integrate undo push into updateShot, updateScene, updateCharacter
- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx` — add Ctrl+Z / Ctrl+Shift+Z keyboard bindings

**Subtasks**:

1. Create `moyin-undo.ts` with `UndoStack` class (push, undo, redo, canUndo, canRedo)
2. Wrap relevant store mutations to push undo entries
3. Add keyboard handlers for Ctrl+Z and Ctrl+Shift+Z in structure-panel

**Tests**: Verify undo restores previous state; verify redo re-applies change; verify stack limit works.

---

## Task 3: Episode Quick-Jump Navigation

**Goal**: Add a dropdown/pill bar at the top of the episode tree to quickly jump between episodes.

**Approach**: Small horizontal scrollable pill bar showing episode titles. Click to auto-expand and scroll to that episode.

**Files**:

- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx` — add episode pill bar above the tree

**Subtasks**:

1. Add horizontal pill bar of episode titles
2. Click a pill to expand that episode and collapse others
3. Highlight the currently selected episode

**Tests**: Verify pills render for each episode; verify click expands target episode.

---

## Task 4: Tests for Round 9

**Files**:

- `apps/web/src/stores/__tests__/moyin-undo.test.ts` (new)
- `apps/web/src/stores/__tests__/moyin-persistence-export.test.ts` (new)
- `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-view.test.tsx`

**Test cases**:

- Export produces valid JSON with expected keys
- Import restores characters, scenes, shots
- Undo reverts the last edit
- Redo re-applies the undone edit
- Undo stack respects max limit
- Episode pills render and click handler works

---

## Estimated Complexity

| Task | Scope | Files Changed |
| --- | --- | --- |
| 1. JSON Export/Import | Medium | 2 (persistence + generate-actions) |
| 2. Undo/Redo | Medium-High | 3 (new file + store + structure-panel) |
| 3. Episode Quick-Jump | Low-Medium | 1 (episode-tree) |
| 4. Tests | Medium | 3 (test files) |
