# Moyin UI Gap Analysis — Round 32: Form Autofocus, Batch Delete Confirm, Disabled Hints

## Overview
Round 32 adds autofocus on edit form entry, confirmation dialog for
bulk shot deletion, and disabled-reason title hints on batch buttons.

## Subtasks

### 32.1 Autofocus Name Input on Edit Mode Entry
Add `autoFocus` to the Name input in character and scene edit forms so
users can start typing immediately after clicking Edit.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`

---

### 32.2 Confirmation Dialog for Bulk Shot Deletion
Wrap `deleteSelectedShots` in a `window.confirm()` dialog showing
the count of selected shots, matching the pattern used by character
and scene individual deletes.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

---

### 32.3 Disabled-Reason Title on Batch Generation Buttons
Add `title` attribute to batch generation buttons explaining why
they are disabled (all generated vs batch running).

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/batch-progress.tsx`
