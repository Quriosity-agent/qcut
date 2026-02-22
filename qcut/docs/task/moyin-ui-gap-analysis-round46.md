# Moyin UI Gap Analysis — Round 46: Search No-Results, Batch Dialog Describe, Tabpanel Label

## Overview
Round 46 adds `role="status"` + `aria-live` to search no-results messages,
`aria-describedby` to batch progress dialog, and `aria-labelledby` to
script-input tabpanels.

## Subtasks

### 46.1 Search No-Results Announcements
Add `role="status"` and `aria-live="polite"` to the no-results div
in both character-list and scene-list.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`

---

### 46.2 Batch Dialog `aria-describedby`
Add `id` to the batch message paragraph and `aria-describedby` to
the dialog element referencing it.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/batch-progress.tsx`

---

### 46.3 Script-Input Tabpanel `aria-labelledby`
Add `id` attributes to the tab buttons and `aria-labelledby` to
the corresponding tabpanels.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/script-input.tsx`
