# Moyin UI Gap Analysis — Round 14: Character Filter, Shot Paste, Scene Generate

## Overview
Round 14 adds character filtering in the episode tree, shot settings
copy/paste across shots, and a scene-level batch generation trigger.

## Subtasks

### 14.1 Character Filter Pills in Episode Tree
Add a horizontal character pill bar that filters the tree to show only
scenes/shots containing the selected character.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`

---

### 14.2 Shot Settings Copy/Paste
Add "Copy Settings" and "Paste Settings" actions to the shot context menu
so users can quickly duplicate camera, lighting, and prompt parameters
between shots.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/tree-context-menu.tsx`
- `apps/web/src/stores/moyin-store.ts`

---

### 14.3 Scene Batch Generate Button
Add a "Generate All Shots" button in the scene context menu to trigger
batch generation for all shots in that scene without navigating away.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/tree-context-menu.tsx`

---

### 14.4 Round 14 Tests
Write tests for character filter and shot paste functionality.
