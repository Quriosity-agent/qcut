# Moyin UI Gap Analysis — Round 39: Progress Labels, Collapsible Aria-controls

## Overview
Round 39 adds aria-label to shot-level progress bars and adds
aria-controls linking to collapsible section content.

## Subtasks

### 39.1 Shot Progress Bar Aria-labels
Add `aria-label` to Progress components in shot-detail showing
the generation percentage context.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`

---

### 39.2 CollapsibleSection Aria-controls
Add `aria-controls` to the toggle button linking it to the content
panel, and add an `id` to the content div.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/collapsible-section.tsx`
