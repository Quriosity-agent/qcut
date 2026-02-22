# Moyin UI Gap Analysis — Round 18: Scene Badges, Bulk Copy, Tooltips

## Overview
Round 18 adds scene completion badges in the episode tree, a bulk
copy-prompts action in shot breakdown, and tooltip hints for
cinematography selectors.

## Subtasks

### 18.1 Scene Completion Badges in Episode Tree
Show small `completed/total` badges next to each scene in the
episode tree, so users can see per-scene progress at a glance.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`

---

### 18.2 Bulk Copy Prompts in Shot Breakdown
Add a "Copy Prompts" button in the bulk action bar that copies
all selected shots' image prompts to the clipboard.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

---

### 18.3 Cinematography Tooltips
Add `title` attributes to cinematography selector labels in
shot-detail.tsx collapsible sections for better UX.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`

---

### 18.4 Round 18 Tests
Write tests for scene badges and bulk copy prompts.
