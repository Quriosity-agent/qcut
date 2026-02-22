# Moyin UI Gap Analysis — Round 31: Delete Toasts, Keyboard Hints

## Overview
Round 31 adds toast.success feedback to delete actions and keyboard
shortcut hints to character and scene edit forms.

## Subtasks

### 31.1 Delete Toast Notifications
Add `toast.success` after character delete in character-list, scene
delete in scene-list, and bulk shot delete in shot-breakdown.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

---

### 31.2 Keyboard Shortcut Hints
Add small hint text showing Ctrl+Enter to save, Escape to cancel
below Save/Cancel buttons in character and scene edit forms.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`
