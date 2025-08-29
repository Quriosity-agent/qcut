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

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Button } from "@/components/ui/button";
import React from "react";
import { afterEach } from "vitest";

// Clean up after each test
afterEach(() => {
  cleanup();
});

describe("Button Component", () => {
  it("renders with default props", () => {
    const { getByRole } = render(<Button type="button">Click me</Button>);
    const button = getByRole("button", { name: "Click me" });
    expect(button).toBeInTheDocument();
  });

  it("renders children correctly", () => {
    const { getByText } = render(
      <Button type="button">
        <span>Icon</span>
        <span>Text</span>
      </Button>
    );

    expect(getByText("Icon")).toBeInTheDocument();
    expect(getByText("Text")).toBeInTheDocument();
  });

  it("applies variant classes", () => {
    const { rerender, getByRole } = render(
      <Button type="button" variant="default">
        Default
      </Button>
    );
    let button = getByRole("button");
    expect(button).toHaveClass("bg-foreground", "text-background");

    rerender(
      <Button type="button" variant="primary">
        Primary
      </Button>
    );
    button = getByRole("button");
    expect(button).toHaveClass("bg-primary", "text-primary-foreground");

    rerender(
      <Button type="button" variant="destructive">
        Destructive
      </Button>
    );
    button = getByRole("button");
    expect(button).toHaveClass("bg-destructive", "text-destructive-foreground");

    rerender(
      <Button type="button" variant="outline">
        Outline
      </Button>
    );
    button = getByRole("button");
    expect(button).toHaveClass("border", "border-input");

    rerender(
      <Button type="button" variant="secondary">
        Secondary
      </Button>
    );
    button = getByRole("button");
    expect(button).toHaveClass("bg-secondary", "text-secondary-foreground");

    rerender(
      <Button type="button" variant="text">
        Text
      </Button>
    );
    button = getByRole("button");
    expect(button).toHaveClass("bg-transparent", "p-0");

    rerender(
      <Button type="button" variant="link">
        Link
      </Button>
    );
    button = getByRole("button");
    expect(button).toHaveClass("text-primary", "underline-offset-4");
  });

  it("applies size classes", () => {
    const { rerender, getByRole } = render(
      <Button type="button" size="default">
        Default
      </Button>
    );
    let button = getByRole("button");
    expect(button).toHaveClass("h-9", "px-4");

    rerender(
      <Button type="button" size="sm">
        Small
      </Button>
    );
    button = getByRole("button");
    expect(button).toHaveClass("h-8", "px-3", "text-xs");

    rerender(
      <Button type="button" size="lg">
        Large
      </Button>
    );
    button = getByRole("button");
    expect(button).toHaveClass("h-10", "px-8");

    rerender(
      <Button type="button" size="icon">
        Icon
      </Button>
    );
    button = getByRole("button");
    expect(button).toHaveClass("h-7", "w-7");
  });

  it("handles click events", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <Button type="button" onClick={onClick}>
        Click me
      </Button>
    );

    const button = getByRole("button");
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("handles multiple clicks", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <Button type="button" onClick={onClick}>
        Multi-click
      </Button>
    );

    const button = getByRole("button");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("disables button when disabled prop is true", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <Button type="button" disabled onClick={onClick}>
        Disabled
      </Button>
    );
    const button = getByRole("button");

    expect(button).toBeDisabled();
    expect(button).toHaveClass(
      "disabled:opacity-50",
      "disabled:pointer-events-none"
    );

    // Click should not work when disabled
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies custom className", () => {
    const { getByRole } = render(
      <Button type="button" className="custom-class another-class">
        Custom
      </Button>
    );
    const button = getByRole("button");

    expect(button).toHaveClass("custom-class", "another-class");
    // Should still have default classes
    expect(button).toHaveClass("inline-flex", "items-center");
  });

  it("renders as child component when asChild is true", () => {
    const { getByRole } = render(
      <Button asChild>
        <a href="/test">Link Button</a>
      </Button>
    );

    const link = getByRole("link", { name: "Link Button" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/test");
    // Button classes should be applied to the child
    expect(link).toHaveClass("inline-flex", "items-center");
  });

  it("forwards ref correctly", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(
      <Button type="button" ref={ref}>
        Ref Button
      </Button>
    );

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.textContent).toBe("Ref Button");
  });

  it("handles type attribute", () => {
    const { rerender, getByRole } = render(<Button type="button">Button Type</Button>);
    let button = getByRole("button");
    expect(button).toHaveAttribute("type", "button");

    rerender(<Button type="submit">Submit Type</Button>);
    button = getByRole("button");
    expect(button).toHaveAttribute("type", "submit");

    rerender(<Button type="reset">Reset Type</Button>);
    button = getByRole("button");
    expect(button).toHaveAttribute("type", "reset");
  });

  it("handles aria attributes", () => {
    const { getByRole } = render(
      <Button
        type="button"
        aria-label="Custom label"
        aria-pressed="true"
        aria-disabled="false"
      >
        Aria Button
      </Button>
    );

    const button = getByRole("button");
    expect(button).toHaveAttribute("aria-label", "Custom label");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("aria-disabled", "false");
  });

  it("handles data attributes", () => {
    const { getByTestId } = render(
      <Button type="button" data-testid="test-button" data-custom="value">
        Data Button
      </Button>
    );

    const button = getByTestId("test-button");
    expect(button).toHaveAttribute("data-custom", "value");
  });

  it("combines variant and size props correctly", () => {
    const { getByRole } = render(
      <Button type="button" variant="primary" size="lg">
        Primary Large
      </Button>
    );

    const button = getByRole("button");
    expect(button).toHaveClass("bg-primary", "h-10", "px-8");
  });

  it("handles focus and hover states", () => {
    const { getByRole } = render(<Button type="button">Interactive</Button>);
    const button = getByRole("button");

    // Check for focus classes
    expect(button).toHaveClass(
      "focus-visible:outline-hidden",
      "focus-visible:ring-1"
    );

    // Check for hover classes (variant-dependent)
    expect(button).toHaveClass("hover:bg-foreground/90");
  });

  it("handles SVG icon styling", () => {
    const { getByRole } = render(
      <Button type="button">
        <svg className="test-svg" role="img" aria-label="Icon">
          <title>Icon</title>
          <rect />
        </svg>
        Icon Button
      </Button>
    );

    const button = getByRole("button");
    // Button should have SVG-specific classes
    expect(button).toHaveClass(
      "[&_svg]:pointer-events-none",
      "[&_svg]:size-4",
      "[&_svg]:shrink-0"
    );
  });
});
