import { fireEvent } from "@testing-library/react";

export function fireClickEvent(element: HTMLElement) {
  fireEvent.mouseDown(element);
  fireEvent.mouseUp(element);
  fireEvent.click(element);
}

export function fireDoubleClickEvent(element: HTMLElement) {
  fireClickEvent(element);
  fireEvent.dblClick(element);
}

export function fireHoverEvent(element: HTMLElement) {
  fireEvent.mouseEnter(element);
  fireEvent.mouseOver(element);
}

export function fireUnhoverEvent(element: HTMLElement) {
  fireEvent.mouseLeave(element);
  fireEvent.mouseOut(element);
}
