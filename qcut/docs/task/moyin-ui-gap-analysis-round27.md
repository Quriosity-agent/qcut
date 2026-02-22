# Moyin UI Gap Analysis — Round 27: Clear Search Labels, Form Label Associations

## Overview
Round 27 adds `aria-label` to clear-search buttons in character and scene
lists, and associates form `<Label>` elements with their inputs via
`htmlFor` / `id`.

## Subtasks

### 27.1 Clear Search Button `aria-label`
Add `aria-label="Clear search"` to the X-icon clear buttons in
character-list and scene-list search bars.

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`

---

### 27.2 Character Edit Form Label Associations
Add `htmlFor` to `<Label>` and `id` to `<Input>`/`<Textarea>` in the
character edit form (Name, Gender, Age, Role, Appearance).

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx`

---

### 27.3 Scene Edit Form Label Associations
Add `htmlFor` to `<Label>` and `id` to `<Input>`/`<Textarea>` in the
scene edit form (Name, Location, Atmosphere, Visual Prompt).

**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx`

---

### 27.4 Round 27 Tests
Write tests for clear search labels and form label associations.
