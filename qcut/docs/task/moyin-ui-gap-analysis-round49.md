# Moyin UI Gap Analysis — Round 49: Emotion/SFX aria-pressed, Cinema Group Roles, Copy aria-live

## Overview
Round 49 adds `aria-pressed` to emotion tag and SFX preset toggle buttons,
`role="group"` with `aria-label` to cinema selector containers, and
`aria-live` to copy button feedback in prompt-editor.

## Subtasks

### 49.1 Emotion/SFX Toggle `aria-pressed`
Add `aria-pressed` to emotion tag buttons and SFX preset buttons in
shot-selectors.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-selectors.tsx`

---

### 49.2 Cinema Selector Group Roles
Add `role="group"` and `aria-label` to the button container divs in
EnumSelector and MultiEnumSelector components.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/cinema-selectors.tsx`

---

### 49.3 Copy Button `aria-live` Feedback
Wrap the copy feedback text in `aria-live="polite"` span in prompt-editor.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/prompt-editor.tsx`
