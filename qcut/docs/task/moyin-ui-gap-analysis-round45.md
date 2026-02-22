# Moyin UI Gap Analysis — Round 45: Skeleton aria-busy, Extras aria-expanded, Reference Alt Text

## Overview
Round 45 adds `aria-busy` to loading skeletons, `aria-expanded` to the
character extras toggle, and contextual alt text to reference images.

## Subtasks

### 45.1 Loading Skeleton `aria-busy`
Add `aria-busy="true"` to skeleton loading containers in both
character-list and scene-list.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`

---

### 45.2 Character Extras `aria-expanded`
Add `aria-expanded={extrasExpanded}` to the extras toggle button in
character-list.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`

---

### 45.3 Reference Image Alt Text
Improve generic `alt="Ref N"` to include character name in
property-panel edit mode.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx`
