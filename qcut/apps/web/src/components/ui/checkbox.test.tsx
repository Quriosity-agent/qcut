import { describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";

// Set up DOM immediately at module level before any imports
if (typeof document === "undefined") {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: "http://localhost:3000/"
  });
  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true });
  // location is now set in test/setup.ts
  Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, writable: true });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { value: dom.window.HTMLButtonElement, writable: true });
  Object.defineProperty(globalThis, 'Element', { value: dom.window.Element, writable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', { value: dom.window.getComputedStyle, writable: true });
}

import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Checkbox } from "@/components/ui/checkbox";

describe("Checkbox Component", () => {
  it("renders unchecked by default", () => {
    const { container } = render(<Checkbox />);
    const checkbox = container.querySelector('[role="checkbox"]');

    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toHaveAttribute("aria-checked", "false");
  });

  it("toggles checked state when clicked", () => {
    const handleChange = vi.fn();
    const { container } = render(<Checkbox onCheckedChange={handleChange} />);

    const checkbox = container.querySelector('[role="checkbox"]')!;
    fireEvent.click(checkbox);

    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it("renders as checked when controlled", () => {
    const { container, rerender } = render(<Checkbox checked={false} />);
    let checkbox = container.querySelector('[role="checkbox"]');

    expect(checkbox).toHaveAttribute("aria-checked", "false");

    rerender(<Checkbox checked={true} />);
    checkbox = container.querySelector('[role="checkbox"]');

    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });

  it("supports indeterminate state", () => {
    const { container } = render(<Checkbox checked="indeterminate" />);
    const checkbox = container.querySelector('[role="checkbox"]');

    expect(checkbox).toHaveAttribute("aria-checked", "mixed");
  });

  it("handles disabled state", () => {
    const handleChange = vi.fn();
    const { container } = render(
      <Checkbox disabled onCheckedChange={handleChange} />
    );

    const checkbox = container.querySelector('[role="checkbox"]')!;
    // Radix UI uses data-disabled instead of aria-disabled
    expect(checkbox).toHaveAttribute("data-disabled");

    fireEvent.click(checkbox);
    expect(handleChange).not.toHaveBeenCalled();
  });
});
