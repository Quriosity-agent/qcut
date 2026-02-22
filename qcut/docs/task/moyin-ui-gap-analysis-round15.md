# Moyin UI Gap Analysis — Round 15: Shot Nav, Tab Badges, Keyboard Hints

## Overview
Round 15 adds shot prev/next navigation in the detail panel, completion
badges on structure panel tabs, and keyboard shortcut hints.

## Subtasks

### 15.1 Shot Prev/Next Navigation
Add arrow buttons in shot detail header to quickly jump between shots
without returning to the breakdown list.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`

---

### 15.2 Structure Panel Tab Badges
Add count/status badges to structure panel tabs showing how many items
are in each category and generation progress.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx`

---

### 15.3 Keyboard Shortcut Hints
Show a small hint bar at the bottom of the structure panel indicating
available keyboard shortcuts (arrows, delete, escape).

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx`

---

### 15.4 Round 15 Tests
Write tests for shot navigation and tab badges.
