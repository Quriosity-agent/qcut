# Moyin UI Gap Analysis — Round 13: Confirm Dialogs, Collapse All, Shot Copy

## Overview
Round 13 adds confirmation dialogs for destructive actions, collapse/expand all
functionality, and shot data copy-to-clipboard.

## Subtasks

### 13.1 Delete Confirmation Dialog
Show a confirmation prompt before deleting episodes, scenes, or shots to
prevent accidental data loss.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/tree-context-menu.tsx`

---

### 13.2 Collapse/Expand All Episodes
Add buttons to collapse or expand all episodes at once in the episode tree.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`

---

### 13.3 Copy Shot Data to Clipboard
Add a "Copy Shot" option in shot context menu that copies all shot metadata
as formatted text to the clipboard.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/tree-context-menu.tsx`

---

### 13.4 Round 13 Tests
Write tests for confirmation dialogs and collapse/expand all.
