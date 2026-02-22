# Moyin UI Gap Analysis — Round 20: Accessibility Pass

## Overview
Round 20 is a focused accessibility pass, adding ARIA roles, states,
and labels to interactive controls across multiple components.

## Subtasks

### 20.1 Tab Role Attributes in Structure Panel
Add `role="tablist"` to tab bar, `role="tab"` and `aria-selected`
to each tab button.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx`

---

### 20.2 Dialog Semantics for Batch Progress
Add `role="dialog"` and `aria-label` to the batch progress overlay.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/batch-progress.tsx`

---

### 20.3 aria-pressed on Cinema Selector Toggles
Add `aria-pressed` to toggle-style buttons in EnumSelector.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/cinema-selectors.tsx`

---

### 20.4 Round 20 Tests
Write tests for ARIA attributes.
