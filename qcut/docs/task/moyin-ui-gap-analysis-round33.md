# Moyin UI Gap Analysis — Round 33: Truncation Tooltips, Bulk Copy Feedback

## Overview
Round 33 adds native `title` attributes to truncated text so users can
hover to see full content, and adds toast feedback to the bulk copy
prompts action.

## Subtasks

### 33.1 Truncation Title Tooltips
Add `title` attributes to elements that use `truncate` or `line-clamp-*`
so that hovering reveals the full text.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`

---

### 33.2 Bulk Copy Toast Feedback
Add `toast.success` to the bulk "Copy prompts" action in shot-breakdown
so users see confirmation that content was copied.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`
