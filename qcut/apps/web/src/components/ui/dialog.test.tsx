import "@/test/fix-radix-ui";
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

describe("Dialog Component", () => {
  it("renders dialog trigger", () => {
    const { getByText } = render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Dialog</DialogTitle>
            <DialogDescription>This is a test dialog</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );

    expect(getByText("Open Dialog")).toBeInTheDocument();
  });

  it("opens and closes with controlled state", async () => {
    const TestDialog = () => {
      const [open, setOpen] = React.useState(false);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>Open</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Test Title</DialogTitle>
              <DialogDescription>Test Description</DialogDescription>
            </DialogHeader>
            <button onClick={() => setOpen(false)}>Close</button>
          </DialogContent>
        </Dialog>
      );
    };

    const { getByText, queryByText, getByRole } = render(<TestDialog />);

    // Dialog should be closed initially
    expect(queryByText("Test Title")).not.toBeInTheDocument();

    // Open dialog
    const trigger = getByText("Open");
    trigger.click();

    // Wait for dialog to appear
    await waitFor(() => {
      expect(getByText("Test Title")).toBeInTheDocument();
    });

    // Close dialog
    const closeButton = getByText("Close");
    closeButton.click();

    // Wait for dialog to disappear
    await waitFor(() => {
      expect(queryByText("Test Title")).not.toBeInTheDocument();
    });
  });

  it("renders with correct ARIA attributes", () => {
    const { getByRole, getByText } = render(
      <Dialog defaultOpen>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accessible Dialog</DialogTitle>
            <DialogDescription>With proper ARIA labels</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );

    const dialog = getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });
});

// Add React import for the test
import React from "react";