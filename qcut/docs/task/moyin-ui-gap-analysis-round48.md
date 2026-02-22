# Moyin UI Gap Analysis — Round 48: Episode/Scene aria-expanded, Modal Escape Fix, Shot Size Labels

## Overview
Round 48 adds `aria-expanded` to episode and scene toggle buttons in
episode-tree, fixes Escape `preventDefault` in media-preview-modal,
and adds descriptive `aria-label` to shot size selector buttons.

## Subtasks

### 48.1 Episode/Scene Toggle `aria-expanded`
Add `aria-expanded` to the episode and scene expand/collapse buttons
in episode-tree.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`

---

### 48.2 Modal Escape `preventDefault` + Remove Empty Handler
Add `e.preventDefault()` to the Escape handler and remove the empty
`onKeyDown={() => {}}` in media-preview-modal.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/media-preview-modal.tsx`

---

### 48.3 Shot Size Button `aria-label`
Add `aria-label` with full description to shot size selector buttons
so screen readers announce e.g. "CU - Close-Up" not just "CU".

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-selectors.tsx`
