# Moyin UI Gap Analysis — Round 35: Prompt Char Count, Copy Aria-live

## Overview
Round 35 adds character count hints below prompt textareas and
aria-live feedback for copy actions in context menus.

## Subtasks

### 35.1 Character Count on Prompt Textareas
Add a small live character count below the prompt textareas in
prompt-editor so users can gauge prompt length.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/prompt-editor.tsx`

---

### 35.2 Aria-live for Copy Feedback in Context Menus
Add `aria-live="polite"` to the "Copied!" text state in tree context
menu copy actions so screen readers announce the success.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/tree-context-menu.tsx`
