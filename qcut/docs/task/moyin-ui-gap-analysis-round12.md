# Moyin UI Gap Analysis — Round 12: Keyboard Nav, Scene Inline Edit, Shot Stats

## Overview
Round 12 adds scene title inline editing (matching episode inline edit from
Round 11), a shot statistics dashboard in the generate panel, and enhanced
keyboard navigation in the episode tree.

## Subtasks

### 12.1 Scene Title Inline Editing (Double-Click)
Allow double-click on scene names in episode tree to rename in-place,
matching the episode inline edit pattern.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`

---

### 12.2 Shot Statistics Dashboard
Show a compact stats summary in the generate-actions panel: total shots,
images completed, videos completed, completion percentage.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx`

---

### 12.3 Episode Tree Keyboard Navigation
Add keyboard focus and Enter/Space to expand/collapse episodes and scenes
in the tree without mouse interaction.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`

---

### 12.4 Round 12 Tests
Write tests for scene inline editing and shot stats dashboard.
