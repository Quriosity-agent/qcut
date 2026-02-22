# Moyin UI Gap Analysis — Round 36: Status Dot A11y, Image Sr-only Text

## Overview
Round 36 adds `aria-label` to status indicator dots and sr-only
text to the drag grip icon on image previews.

## Subtasks

### 36.1 ShotStatusDot Aria-labels
Add `aria-label` to the status dot spans in episode-tree so screen
readers announce the status (completed/generating/failed).

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`

---

### 36.2 Image Preview Sr-only Drag Hint
Add sr-only text to the drag grip icon overlay on image previews
so keyboard/screen reader users know images are draggable.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`
