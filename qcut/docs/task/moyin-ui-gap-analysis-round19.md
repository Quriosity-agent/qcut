# Moyin UI Gap Analysis — Round 19: Contextual Details, Empty States

## Overview
Round 19 improves the Details panel header with contextual labels and
adds empty-state messages to structure panel tabs.

## Subtasks

### 19.1 Contextual Details Header
Replace the static "Details" label in the right panel header with
a dynamic label showing the selected item type and name
(e.g. "Character: Alice", "Shot 3 of 12").

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/index.tsx`

---

### 19.2 Empty Tab States in Structure Panel
Add placeholder messages when tabs have no content, so users
know what to do (e.g. "No characters yet. Parse a script first.").

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx`

---

### 19.3 Round 19 Tests
Write tests for contextual header and empty tab states.
