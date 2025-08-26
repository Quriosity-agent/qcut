import { waitFor } from '@testing-library/react';

export async function waitForElement(
  selector: string,
  options = { timeout: 3000 }
) {
  return waitFor(
    () => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Element ${selector} not found`);
      return element;
    },
    options
  );
}

export async function waitForElements(
  selector: string,
  count: number,
  options = { timeout: 3000 }
) {
  return waitFor(
    () => {
      const elements = document.querySelectorAll(selector);
      if (elements.length < count) {
        throw new Error(`Expected ${count} elements, found ${elements.length}`);
      }
      return Array.from(elements);
    },
    options
  );
}