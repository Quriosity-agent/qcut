# Moyin UI Gap Analysis — Round 50: EN/ZH Labels, Generate aria-busy, Variation Button Label

## Overview
Round 50 adds `aria-label` to EN/ZH language toggle buttons,
`aria-busy` to generate buttons during generation, and `aria-label`
to the add-variation button.

## Subtasks

### 50.1 EN/ZH Toggle `aria-label`
Add descriptive `aria-label` to the language toggle buttons in
prompt-editor so screen readers announce "English prompt" / "Chinese prompt".

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/prompt-editor.tsx`

---

### 50.2 Generate Buttons `aria-busy`
Add `aria-busy="true"` to image, video, and end-frame generate buttons
when their respective generation is in progress.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/shot-detail.tsx`

---

### 50.3 Add Variation Button Label
Add `aria-label` to the "Add Variation" button in character-variations.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-variations.tsx`
