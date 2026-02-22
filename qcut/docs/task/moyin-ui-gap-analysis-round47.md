# Moyin UI Gap Analysis — Round 47: Extras aria-controls, Shot No-Results, Structure Tabpanel Labels

## Overview
Round 47 adds `aria-controls` to extras toggle, `role="status"` to
shot-breakdown no-results, and `aria-labelledby` to structure-panel tabpanels.

## Subtasks

### 47.1 Extras Toggle `aria-controls`
Add `aria-controls="extras-content"` to the extras toggle button and
`id="extras-content"` to the content div in character-list.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`

---

### 47.2 Shot Breakdown No-Results Announcement
Add `role="status"` and `aria-live="polite"` to the no-results div
in shot-breakdown.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

---

### 47.3 Structure Panel Tabpanel `aria-labelledby`
Add `id` to tab buttons and `aria-labelledby` to tabpanels in
structure-panel.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx`
