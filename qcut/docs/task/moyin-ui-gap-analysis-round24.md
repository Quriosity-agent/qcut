# Moyin UI Gap Analysis — Round 24: Escape Clear, Group Role, Button Labels

## Overview
Round 24 adds Escape-to-clear on the shot search input, wraps the
narrative function buttons in a `role="group"`, and adds missing
`aria-label` to icon-only buttons in ShotDetail.

## Subtasks

### 24.1 Escape Key to Clear Search
Add `onKeyDown` handler so pressing Escape clears the search query.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

---

### 24.2 Narrative Function Button Group
Wrap narrative function buttons in `role="group"` with `aria-label`.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`

---

### 24.3 Icon-Only Button Labels
Add `aria-label` to the Edit (pencil) button in ShotDetail header.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`

---

### 24.4 Round 24 Tests
Write tests for Escape to clear search, group role, and button label.
