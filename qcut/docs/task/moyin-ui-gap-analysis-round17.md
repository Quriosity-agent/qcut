# Moyin UI Gap Analysis — Round 17: Shot Breakdown Enhancements

## Overview
Round 17 improves the shot-breakdown panel with bulk actions, narrative
function badges in list view, and a bulk generate button for selected shots.

## Subtasks

### 17.1 Duplicate Selected Shots (Bulk Action)
Add a "Duplicate" button in the bulk action bar that duplicates all
selected shots using the existing `duplicateShot` store action.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

---

### 17.2 Narrative Function Badges in List View
Show a small colored badge (2-letter abbreviation) for the `narrativeFunction`
field in the list view row. Uses color coding: exposition=gray, escalation=amber,
climax=red, turning-point=purple, transition=blue, denouement=green.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

---

### 17.3 Bulk Generate Images for Selected Shots
Add a "Generate" button in the bulk action bar that calls `generateShotImage`
for each selected shot that has image status "idle" or "failed".

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-breakdown.tsx`

---

### 17.4 Round 17 Tests
Write tests for duplicate selected, narrative badges, and bulk generate.
