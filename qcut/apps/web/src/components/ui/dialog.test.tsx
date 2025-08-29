import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";

// Set up DOM immediately at module level before any imports  
if (typeof document === "undefined") {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: "http://localhost:3000/"
  });
  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true });
  Object.defineProperty(globalThis, 'location', { value: dom.window.location, writable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, writable: true });
  Object.defineProperty(globalThis, 'Element', { value: dom.window.Element, writable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', { value: dom.window.getComputedStyle, writable: true });
}

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
    const { rerender, queryByText } = render(
      <Dialog open={false}>
        <DialogContent>
          <DialogTitle>Test Dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    );

    // Dialog should not be visible initially
    expect(queryByText("Test Dialog")).not.toBeInTheDocument();

    // Open dialog
    rerender(
      <Dialog open={true}>
        <DialogContent>
          <DialogTitle>Test Dialog</DialogTitle>
        </DialogContent>
      </Dialog>
    );

    // Dialog should be visible
    await waitFor(() => {
      expect(queryByText("Test Dialog")).toBeInTheDocument();
    });
  });
});
