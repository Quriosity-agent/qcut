# Moyin UI Gap Analysis — Round 25: Prompt Toggle, Script Tabs, Progress Labels

## Overview
Round 25 adds `aria-pressed` to the EN/ZH language toggle in the prompt
editor, applies the WAI-ARIA tab pattern to the import/create tabs in
script input, and adds `aria-label` to progress bars in generate actions.

## Subtasks

### 25.1 Language Toggle `aria-pressed`
Add `aria-pressed` to the EN/ZH buttons in PromptSection and
`aria-expanded` to the section header button.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/prompt-editor.tsx`

---

### 25.2 Script Input Tab ARIA Pattern
Add `role="tablist"`, `role="tab"`, and `aria-selected` to the
import/create tab buttons in ScriptInput.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/script-input.tsx`

---

### 25.3 Progress Bar `aria-label`
Add `aria-label` to the image/video progress bars and the generation
progress bar in GenerateActions.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx`

---

### 25.4 Round 25 Tests
Write tests for toggle, tabs, and progress bar labels.
