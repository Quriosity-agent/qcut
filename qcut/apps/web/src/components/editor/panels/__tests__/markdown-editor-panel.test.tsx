import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarkdownElement } from "@/types/timeline";
import { MarkdownEditorPanel } from "../markdown-editor-panel";

const updateMarkdownElement = vi.fn();

vi.mock("@/stores/timeline-store", () => ({
  useTimelineStore: (selector: (state: { updateMarkdownElement: typeof updateMarkdownElement }) => unknown) =>
    selector({ updateMarkdownElement }),
}));

function createElement(overrides: Partial<MarkdownElement> = {}): MarkdownElement {
  return {
    id: "markdown-1",
    type: "markdown",
    name: "Markdown",
    markdownContent: "# Hello",
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

describe("MarkdownEditorPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates markdown content", () => {
    render(<MarkdownEditorPanel element={createElement()} trackId="track-1" />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "# Updated" } });

    expect(updateMarkdownElement).toHaveBeenCalledWith("track-1", "markdown-1", {
      markdownContent: "# Updated",
    });
  });

  it("clamps duration to minimum", () => {
    render(<MarkdownEditorPanel element={createElement()} trackId="track-1" />);

    const durationInput = screen.getByTestId("markdown-duration-input");
    fireEvent.change(durationInput, { target: { value: "10" } });
    fireEvent.blur(durationInput);

    expect(updateMarkdownElement).toHaveBeenCalledWith("track-1", "markdown-1", {
      duration: 120,
    });
  });

  it("clamps duration to maximum", () => {
    render(<MarkdownEditorPanel element={createElement()} trackId="track-1" />);

    const durationInput = screen.getByTestId("markdown-duration-input");
    fireEvent.change(durationInput, { target: { value: "8000" } });
    fireEvent.blur(durationInput);

    expect(updateMarkdownElement).toHaveBeenCalledWith("track-1", "markdown-1", {
      duration: 7200,
    });
  });
});
