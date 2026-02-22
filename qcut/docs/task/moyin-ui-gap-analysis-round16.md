# Moyin UI Gap Analysis — Round 16: Delete Confirms, Keyboard Edits, Aria Labels

## Overview
Round 16 adds consistency to character-list and scene-list: delete
confirmations, Enter/Escape in inline editors, and accessibility labels.

## Subtasks

### 16.1 Delete Confirmations in Character & Scene Lists
Add window.confirm() before deleting characters and scenes from the
list views, matching the tree-context-menu pattern.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`

---

### 16.2 Keyboard Shortcuts in Inline Card Editors
Add Enter to save and Escape to cancel in character and scene card
inline editors.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`

---

### 16.3 Accessibility Labels on Add Buttons
Add aria-label attributes to the Add Character and Add Scene buttons.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`

---

### 16.4 Round 16 Tests
Write tests for delete confirmations and keyboard shortcuts.
