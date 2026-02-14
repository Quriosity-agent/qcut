import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownOverlay } from "@/components/editor/canvas/markdown-overlay";
import type { MarkdownElement } from "@/types/timeline";

function createMarkdownElement(
  overrides: Partial<MarkdownElement> = {}
): MarkdownElement {
  return {
    id: "markdown-1",
    type: "markdown",
    name: "Markdown",
    markdownContent: "# Heading\n\n- one\n- two\n\n`code`",
    duration: 300,
    startTime: 0,
    trimStart: 0,
    trimEnd: 0,
    theme: "dark",
    fontSize: 18,
    fontFamily: "Arial",
    padding: 16,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    textColor: "#ffffff",
    scrollMode: "static",
    scrollSpeed: 30,
    x: 0,
    y: 0,
    width: 720,
    height: 420,
    rotation: 0,
    opacity: 1,
    ...overrides,
  };
}

describe("MarkdownOverlay", () => {
  it("renders heading, list, and code content", () => {
    const element = createMarkdownElement();

    render(
      <MarkdownOverlay element={element} currentTime={0} canvasScale={1} />
    );

    expect(screen.getByText("Heading")).toBeInTheDocument();
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("code")).toBeInTheDocument();
  });

  it("applies auto-scroll transform based on playback time", () => {
    const element = createMarkdownElement({
      scrollMode: "auto-scroll",
      scrollSpeed: 20,
      startTime: 2,
    });

    render(
      <MarkdownOverlay element={element} currentTime={5} canvasScale={1} />
    );

    const overlay = screen.getByTestId("markdown-overlay");
    const scrollLayer = overlay.firstElementChild as HTMLElement | null;

    expect(scrollLayer).not.toBeNull();
    expect(scrollLayer?.style.transform).toContain("translateY(-60px)");
  });

  it("supports transparent theme styling", () => {
    const element = createMarkdownElement({
      theme: "transparent",
      backgroundColor: "transparent",
    });

    render(
      <MarkdownOverlay element={element} currentTime={0} canvasScale={1} />
    );

    const overlay = screen.getByTestId("markdown-overlay");
    expect(overlay).toHaveStyle({ backgroundColor: "transparent" });
  });

  it("handles empty markdown content gracefully", () => {
    const element = createMarkdownElement({ markdownContent: "" });

    render(
      <MarkdownOverlay element={element} currentTime={0} canvasScale={1} />
    );

    expect(screen.getByTestId("markdown-overlay")).toBeInTheDocument();
  });
});
