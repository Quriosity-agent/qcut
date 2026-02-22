# Moyin UI Gap Analysis — Round 22: View Toggle, No Results, Modal Focus Trap

## Overview
Round 22 addresses three usability / accessibility gaps in the shot breakdown
panel and media preview modal.

## Subtasks

### 22.1 View Mode Toggle `aria-pressed`
Add `aria-pressed` to the list / grid view toggle buttons in ShotBreakdown so
screen readers announce which view is active.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

---

### 22.2 "No Results" Empty State
When search query or filter returns zero shots, display a short informational
message instead of a blank area.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

---

### 22.3 Media Preview Modal Focus Trap
Trap keyboard focus inside the media preview modal so Tab / Shift+Tab cycle
between the Download button and Close button instead of escaping to the page
behind the overlay.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/media-preview-modal.tsx`

---

### 22.4 Round 22 Tests
Write tests for view toggle aria-pressed, no-results message, and modal focus
trap behaviour.
