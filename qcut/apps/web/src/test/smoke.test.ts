import { describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";

// Set up DOM immediately at module level before any imports
if (typeof document === "undefined") {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  Object.defineProperty(globalThis, "window", {
    value: dom.window,
    writable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: dom.window.document,
    writable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    writable: true,
  });
  // location is now set in test/setup.ts
  Object.defineProperty(globalThis, "HTMLElement", {
    value: dom.window.HTMLElement,
    writable: true,
  });
  Object.defineProperty(globalThis, "Element", {
    value: dom.window.Element,
    writable: true,
  });
}

describe("QCut Test Infrastructure", () => {
  it("should run basic arithmetic test", () => {
    expect(2 + 2).toBe(4);
  });

  it("should have test utilities available", () => {
    expect(typeof describe).toBe("function");
    expect(typeof it).toBe("function");
    expect(typeof expect).toBe("function");
  });

  it("should have DOM testing utilities", () => {
    const element = document.createElement("div");
    element.textContent = "Test";
    expect(element.textContent).toBe("Test");
  });

  it("should have mock functions available", () => {
    const mockFn = vi.fn();
    mockFn("test");
    expect(mockFn).toHaveBeenCalledWith("test");
  });
});
