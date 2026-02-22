# Moyin UI Gap Analysis — Round 52: Character Search Label, Status Text, Filter Group, Success Announce

## Overview
Round 52 adds `aria-label` to character search input, `role="status"`
to MoyinView status text and generate success message, and `role="group"`
to character filter in episode-tree.

## Subtasks

### 52.1 Character Search `aria-label`
Add `aria-label="Search characters"` to the search input in character-list.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`

---

### 52.2 Status Text `role="status"`
Add `role="status"` and `aria-live="polite"` to the status text in
MoyinView and the success message in generate-actions.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/index.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx`

---

### 52.3 Character Filter `role="group"`
Add `role="group"` to the character filter button container in episode-tree.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`
