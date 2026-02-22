# Moyin UI Gap Analysis — Round 53: Lang Attribute, Decorative Spacer, Delete Button Labels

## Overview
Round 53 adds `lang` attribute to prompt textareas for correct screen reader
pronunciation, `aria-hidden="true"` on decorative spacer in episode-tree, and
`aria-label` on icon-only delete buttons in edit forms.

## Subtasks

### 53.1 Prompt Textarea `lang` Attribute
Set `lang="en"` or `lang="zh"` on the `<Textarea>` in PromptSection based on
the active EN/ZH toggle, so screen readers use the correct pronunciation.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/prompt-editor.tsx`

---

### 53.2 Decorative Spacer `aria-hidden`
Add `aria-hidden="true"` to the empty `<span className="w-2.5" />` spacer in
episode-tree that visually aligns scenes without a chevron. This prevents
screen readers from encountering an empty element.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/episode-tree.tsx`

---

### 53.3 Icon-Only Delete Button `aria-label`
Add `aria-label="Delete character"` and `aria-label="Delete scene"` to the
icon-only Trash2Icon delete buttons in the edit forms of character-list and
scene-list.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`
