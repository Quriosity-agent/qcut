import { fireEvent } from "@testing-library/react";

export function simulateDragDrop(
  source: HTMLElement,
  target: HTMLElement,
  dataTransfer?: Partial<DataTransfer>
) {
  const transfer = {
    data: {} as Record<string, string>,
    setData(format: string, data: string) {
      this.data[format] = data;
    },
    getData(format: string) {
      return this.data[format];
    },
    ...dataTransfer,
  };

  fireEvent.dragStart(source, { dataTransfer: transfer });
  fireEvent.dragEnter(target, { dataTransfer: transfer });
  fireEvent.dragOver(target, { dataTransfer: transfer });
  fireEvent.drop(target, { dataTransfer: transfer });
  fireEvent.dragEnd(source, { dataTransfer: transfer });
}

export function simulateTimelineDrag(
  element: HTMLElement,
  trackId: string,
  position: number
) {
  const payload = JSON.stringify({ elementId: element.id, trackId, position });
  const trackTarget = document.querySelector(
    `[data-track-id="${trackId.replace(/"/g, '\\"')}"]`
  );

  if (!trackTarget) {
    throw new Error(`Track with id ${trackId} not found`);
  }

  const dtOverrides: Partial<DataTransfer> = {
    types: ["application/json"],
    getData: (t: string) => (t === "application/json" ? payload : ""),
    setData: () => {}, // consumers shouldn't call this during drop in tests
  };
  simulateDragDrop(element, trackTarget as HTMLElement, dtOverrides);
}
