import { describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";

// Set up DOM immediately at module level before any imports
if (typeof document === "undefined") {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true });
  Object.defineProperty(globalThis, 'location', { value: dom.window.location, writable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, writable: true });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { value: dom.window.HTMLButtonElement, writable: true });
  Object.defineProperty(globalThis, 'Element', { value: dom.window.Element, writable: true });
}

import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Button } from "@/components/ui/button";
import { afterEach } from "vitest";

// Clean up after each test
afterEach(() => {
  cleanup();
});

describe("Button Component", () => {
  it("renders button with text", () => {
    const { getByText } = render(<Button>Click me</Button>);
    expect(getByText("Click me")).toBeInTheDocument();
  });

  it("applies variant classes", () => {
    const { container } = render(<Button variant="primary">Primary</Button>);
    const button = container.querySelector("button");
    expect(button?.className).toContain("bg-primary");
  });

  it("applies size classes", () => {
    const { container } = render(<Button size="sm">Small</Button>);
    const button = container.querySelector("button");
    expect(button?.className).toContain("h-8");
  });
});

describe("Button Events", () => {
  it("handles click event", async () => {
    const handleClick = vi.fn();
    const { getByText } = render(<Button onClick={handleClick}>Click</Button>);

    const button = getByText("Click");
    fireEvent.click(button);

    await waitFor(() => {
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  it("prevents click when disabled", () => {
    const handleClick = vi.fn();
    const { getByText } = render(
      <Button disabled onClick={handleClick}>
        Disabled
      </Button>
    );

    const button = getByText("Disabled");
    fireEvent.click(button);

    expect(handleClick).not.toHaveBeenCalled();
  });

  it("works as a link with asChild prop", () => {
    const { getByText } = render(
      <Button asChild>
        <a href="/test">Link Button</a>
      </Button>
    );

    const link = getByText("Link Button");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/test");
  });
});
