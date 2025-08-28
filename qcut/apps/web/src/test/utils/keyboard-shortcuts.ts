import { fireEvent } from "@testing-library/react";
import { shortcuts } from "./keyboard-events";

export function triggerShortcut(
  key: string,
  modifiers: {
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  } = {},
  target: HTMLElement | Document = document
) {
  fireEvent.keyDown(target, {
    key,
    code: `Key${key.toUpperCase()}`,
    ...modifiers,
  });
}

export const editorShortcuts = {
  save: () => triggerShortcut("s", { ctrlKey: true }),
  export: () => triggerShortcut("e", { ctrlKey: true, shiftKey: true }),
  import: () => triggerShortcut("i", { ctrlKey: true }),
  newProject: () => triggerShortcut("n", { ctrlKey: true }),

  // Timeline shortcuts (extending existing)
  splitAtPlayhead: () => triggerShortcut("s"),
  deleteSelected: () => shortcuts.delete(),
  rippleDelete: () => triggerShortcut("Delete", { shiftKey: true }),
};
