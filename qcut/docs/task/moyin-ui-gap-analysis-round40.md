# Moyin UI Gap Analysis — Round 40: Tab Panels, File Input Labels, Generate Hint

## Overview
Round 40 adds tab panel ARIA roles to script-input, aria-labels to
hidden file inputs, and disabled-reason title to generate button.

## Subtasks

### 40.1 Script Input Tab Panel ARIA
Add `aria-controls` to tab buttons and `role="tabpanel"` with `id`
to tab content divs.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/script-input.tsx`

---

### 40.2 File Input Aria-labels
Add `aria-label` to hidden file inputs in generate-actions and
property-panel.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx`

---

### 40.3 Generate Button Disabled Hint
Add `title` to "Generate Storyboard" button explaining why it is
disabled.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx`
