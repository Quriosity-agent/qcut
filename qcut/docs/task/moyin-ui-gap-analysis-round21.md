# Moyin UI Gap Analysis — Round 21: Custom Duration, Import Progress a11y

## Overview
Round 21 adds a custom duration input to the shot duration selector
and adds aria-live region to import pipeline progress for screen readers.

## Subtasks

### 21.1 Custom Duration Input in DurationSelector
Add an optional text input below the preset buttons that allows
entering a custom duration value (any integer 1-60 seconds).

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-selectors.tsx`

---

### 21.2 Import Progress aria-live Region
Add `aria-live="polite"` to the import pipeline steps container
and `aria-label` to each step describing its status.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/import-progress.tsx`

---

### 21.3 Round 21 Tests
Write tests for custom duration input and import progress aria.
