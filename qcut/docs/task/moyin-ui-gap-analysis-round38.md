# Moyin UI Gap Analysis — Round 38: Modal Labels, SFX Hint, Variation Labels

## Overview
Round 38 adds download/close aria-labels in the media preview modal,
disabled-reason hints for SFX presets, and contextual variation
edit/remove labels.

## Subtasks

### 38.1 Media Preview Modal Button Labels
Add `aria-label` to Download and Close buttons with context.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/media-preview-modal.tsx`

---

### 38.2 SFX Preset Disabled Hint
Add `title` hint to SFX preset buttons when audio is disabled.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-selectors.tsx`

---

### 38.3 Character Variation Contextual Labels
Update edit/remove button aria-labels to include variation name.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-variations.tsx`
