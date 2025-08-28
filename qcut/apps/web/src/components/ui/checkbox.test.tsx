import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
