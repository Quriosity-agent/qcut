import { fireEvent } from '@testing-library/react';

export function openContextMenu(
  element: HTMLElement,
  position = { clientX: 100, clientY: 100 }
) {
  fireEvent.contextMenu(element, position);
}

export function selectContextMenuItem(menuText: string) {
  const menuItem = document.querySelector(
    `[role="menuitem"]:has-text("${menuText}")`
  );
  if (menuItem) {
    fireEvent.click(menuItem as HTMLElement);
  }
  return menuItem;
}

export function closeContextMenu() {
  fireEvent.keyDown(document.body, { key: 'Escape' });
}