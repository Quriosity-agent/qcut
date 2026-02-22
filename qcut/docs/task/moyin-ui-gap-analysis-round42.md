# Moyin UI Gap Analysis — Round 42: Batch Progress Label, Section Description, Validation Hint

## Overview
Round 42 adds aria-label to the batch progress bar, implements the
aria-description prop in CollapsibleSection, and adds validation
error hint to the custom duration input.

## Subtasks

### 42.1 Batch Progress Bar Aria-label
Add `aria-label` to the batch generation progress bar.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/batch-progress.tsx`

---

### 42.2 CollapsibleSection aria-description Prop
Accept and apply `aria-description` prop to the toggle button.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/collapsible-section.tsx`

---

### 42.3 Duration Validation Error Hint
Add aria-describedby with error message for invalid duration input.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-selectors.tsx`
