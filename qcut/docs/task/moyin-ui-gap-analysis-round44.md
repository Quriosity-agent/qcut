# Moyin UI Gap Analysis — Round 44: Selected Item ARIA, Bulk Group, Batch Modal

## Overview
Round 44 adds `aria-current` to selected items across components,
`role="group"` with `aria-labelledby` to bulk action bar, and
`aria-modal="true"` to batch progress dialog overlay.

## Subtasks

### 44.1 Selected Item `aria-current`
Add `aria-current="true"` to selected shot buttons in shot-breakdown,
selected episode/scene/shot rows in episode-tree, and selected
character card in character-list.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`

---

### 44.2 Bulk Action Bar Grouping
Wrap bulk action controls in `role="group"` with `aria-labelledby`
pointing to the count label.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

---

### 44.3 Batch Dialog `aria-modal`
Add `aria-modal="true"` to the batch progress overlay dialog.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/batch-progress.tsx`
