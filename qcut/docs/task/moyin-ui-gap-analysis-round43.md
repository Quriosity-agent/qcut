# Moyin UI Gap Analysis — Round 43: Structure Tab Panels, Image Labels, Export Announce

## Overview
Round 43 adds aria-controls/tabpanel to structure-panel tabs, aria-label
to image preview buttons, and aria-live to the export button state.

## Subtasks

### 43.1 Structure Panel Tab ARIA
Add `aria-controls` to tab buttons and `role="tabpanel"` with `id`
to each tab content wrapper.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx`

---

### 43.2 Image Preview Button Labels
Add `aria-label` to the image and end-frame preview divs with
`role="button"`, and wire Enter/Space to trigger click.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`

---

### 43.3 Export Button State Announcement
Add `aria-live="polite"` to the export button text so screen readers
announce the "Copied!" state change.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx`
