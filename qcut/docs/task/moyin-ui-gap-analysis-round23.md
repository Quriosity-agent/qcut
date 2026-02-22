# Moyin UI Gap Analysis — Round 23: Validation Feedback, Collapsible a11y, Filter Indicator

## Overview
Round 23 addresses duration input validation feedback, collapsible section
`aria-expanded`, and an active filter indicator on the shot list toolbar.

## Subtasks

### 23.1 Duration Input Validation Feedback
Show a red border and `aria-invalid` when the custom duration input value
is non-empty but outside the 1–60 range.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-selectors.tsx`

---

### 23.2 CollapsibleSection `aria-expanded`
Add `aria-expanded` to the toggle button so screen readers announce
whether the section is open or closed.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/collapsible-section.tsx`

---

### 23.3 Active Filter Indicator
Update the shot list filter `<select>` to use a dynamic `aria-label`
that announces the active filter, and apply a visual accent when a
non-default filter is selected.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

---

### 23.4 Round 23 Tests
Write tests covering validation state, aria-expanded, and filter indicator.
