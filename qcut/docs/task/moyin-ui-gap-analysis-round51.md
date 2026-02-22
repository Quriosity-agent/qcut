# Moyin UI Gap Analysis — Round 51: Panel Labels, Scene Search Label, Shot Toolbar Group

## Overview
Round 51 adds `aria-label` to ResizablePanel components in MoyinView,
`aria-label` to the scene search input, and `role="toolbar"` to the
shot breakdown toolbar.

## Subtasks

### 51.1 Panel Group Aria Labels
Add `aria-label` to ResizablePanelGroup and ResizableHandle components
in the main MoyinView layout.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/index.tsx`

---

### 51.2 Scene Search Input `aria-label`
Add `aria-label="Search scenes"` to the search input in scene-list.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`

---

### 51.3 Shot Toolbar Grouping
Add `role="toolbar"` and `aria-label` to the shot breakdown toolbar
containing search, filter, and view controls.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`
