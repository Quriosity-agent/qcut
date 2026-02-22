# Moyin UI Gap Analysis — Round 30: Remaining Save Toast Notifications

## Overview
Round 30 adds toast.success notifications to the three remaining save
functions that were missed in Round 29.

## Subtasks

### 30.1 Shot Detail Save Toast
Add `toast.success("Shot saved")` to the save callback in ShotDetail.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`

---

### 30.2 Character List Save Toast
Add `toast.success("Character saved")` to the saveEdit callback in
CharacterCard.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`

---

### 30.3 Scene List Save Toast
Add `toast.success("Scene saved")` to the saveEdit callback in SceneCard.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`
