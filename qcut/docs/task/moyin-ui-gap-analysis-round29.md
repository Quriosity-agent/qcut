# Moyin UI Gap Analysis — Round 29: Save Toasts, Keyboard Save Shortcut

## Overview
Round 29 adds toast notifications for save/delete actions and a Ctrl+S
keyboard shortcut for the property-panel character edit mode.

## Subtasks

### 29.1 Toast Notifications for Save Actions
Add `toast.success()` feedback after saving character edits in
property-panel and scene edits in scene-episode-detail.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-episode-detail.tsx`

---

### 29.2 Ctrl+S Keyboard Shortcut in Property Panel
Add `onKeyDown` handler to the character edit form container so
Ctrl+S / Cmd+S saves and Escape cancels.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx`

---

### 29.3 Round 29 Tests
Write tests for keyboard shortcut and toast import.
