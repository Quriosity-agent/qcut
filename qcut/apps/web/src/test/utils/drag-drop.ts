import { fireEvent } from '@testing-library/react';

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
  const data = JSON.stringify({ elementId: element.id, trackId, position });
  const trackTarget = document.querySelector(`[data-track-id="${trackId}"]`);
  
  if (!trackTarget) {
    throw new Error(`Track with id ${trackId} not found`);
  }
  
  simulateDragDrop(element, trackTarget as HTMLElement, {
    getData: () => data,
    setData: () => {},
  } as any);
}