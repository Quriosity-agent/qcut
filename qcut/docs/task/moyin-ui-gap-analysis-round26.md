# Moyin UI Gap Analysis — Round 26: CopyButton Labels, Narrative Pressed, Filter Pressed

## Overview
Round 26 adds `aria-label` to all CopyButton instances, `aria-pressed` to
narrative function buttons, and `aria-pressed` to episode tree filter buttons.

## Subtasks

### 26.1 CopyButton `aria-label`
Add `aria-label="Copy to clipboard"` to CopyButton in shot-detail,
property-panel, and scene-episode-detail.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/property-panel.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-episode-detail.tsx`

---

### 26.2 Narrative Function `aria-pressed`
Add `aria-pressed` to the narrative function toggle buttons in ShotDetail
edit mode.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`

---

### 26.3 Episode Tree Filter `aria-pressed`
Add `aria-pressed` to the filter tab buttons and character filter pill
buttons in EpisodeTree.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`

---

### 26.4 Round 26 Tests
Write tests for CopyButton label, narrative pressed, and filter pressed.
