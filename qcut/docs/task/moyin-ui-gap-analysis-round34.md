# Moyin UI Gap Analysis — Round 34: Video Button Hint, Drag Affordance

## Overview
Round 34 adds a disabled-reason title to the video generation button
and adds cursor-grab CSS to draggable shot items in grid and list views.

## Subtasks

### 34.1 Video Generation Button Disabled Hint
Add `title` attribute explaining why the video button is disabled
(need to generate image first).

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`

---

### 34.2 Drag Cursor Affordance on Shot Items
Add `cursor-grab` CSS class to draggable shot items in both grid
and list views so users see they can drag to reorder.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`
