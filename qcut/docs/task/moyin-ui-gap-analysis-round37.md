# Moyin UI Gap Analysis — Round 37: Enhance Button Label, Bulk Action Tooltips

## Overview
Round 37 updates the AI Enhance button to show "Enhancing..." while
running and adds title tooltip hints to bulk action buttons.

## Subtasks

### 37.1 AI Enhance Button "Enhancing..." Label
Update the AI Enhance button in character-list and scene-list to
show "Enhancing..." while calibration is running instead of just a
spinner with the same label.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`

---

### 37.2 Bulk Action Button Title Tooltips
Add `title` attributes to bulk action buttons (Duplicate, Generate,
Copy, Delete) explaining what they do.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`
