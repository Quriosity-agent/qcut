import { DraggableMediaItem } from "@/components/ui/draggable-item";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { usePlaybackStore } from "@/stores/playback-store";
import { useTimelineStore } from "@/stores/timeline-store";
import { type MarkdownElement, type TextElement } from "@/types/timeline";

const textData: TextElement = {
  id: "default-text",
  type: "text",
  name: "Default text",
  content: "Default text",
  fontSize: 48,
  fontFamily: "Arial",
  color: "#ffffff",
  backgroundColor: "transparent",
  textAlign: "center" as const,
  fontWeight: "normal" as const,
  fontStyle: "normal" as const,
  textDecoration: "none" as const,
  x: 0,
  y: 0,
  rotation: 0,
  opacity: 1,
  duration: TIMELINE_CONSTANTS.DEFAULT_TEXT_DURATION,
  startTime: 0,
  trimStart: 0,
  trimEnd: 0,
};

const markdownData: MarkdownElement = {
  id: "default-markdown",
  type: "markdown",
  name: "Default markdown",
  markdownContent: "# Title\n\nStart writing your markdown content...",
  duration: TIMELINE_CONSTANTS.MARKDOWN_DEFAULT_DURATION,
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
};

export function TextView() {
  const handleAddTextToTimeline = (currentTime?: number) => {
    const timeToUse = currentTime ?? usePlaybackStore.getState().currentTime;
    useTimelineStore.getState().addTextAtTime(textData, timeToUse);
  };

  const handleButtonClick = () => {
    handleAddTextToTimeline();
  };

  const handleAddMarkdownToTimeline = (currentTime?: number) => {
    const timeToUse = currentTime ?? usePlaybackStore.getState().currentTime;
    useTimelineStore.getState().addMarkdownAtTime(markdownData, timeToUse);
  };

  const handleMarkdownButtonClick = () => {
    handleAddMarkdownToTimeline();
  };

  // For the outer button element: prevent page scroll on Space; rely on native click for activation.
  const handleButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " ") e.preventDefault();
  };

  return (
    <div className="p-4 space-y-3" data-testid="text-panel">
      <button
        data-testid="text-overlay-button"
        aria-label="Add default text overlay"
        onClick={handleButtonClick}
        onKeyDown={handleButtonKeyDown}
        className="cursor-pointer bg-transparent border-0 p-0 w-full"
        type="button"
      >
        <DraggableMediaItem
          name="Default text"
          preview={
            <div className="flex items-center justify-center w-full h-full bg-accent rounded">
              <span className="text-xs select-none">Default text</span>
            </div>
          }
          dragData={{
            id: textData.id,
            type: textData.type,
            name: textData.name,
            content: textData.content,
          }}
          aspectRatio={1}
          onAddToTimeline={handleAddTextToTimeline}
          showLabel={false}
          stopPropagation={false}
        />
      </button>

      <button
        data-testid="markdown-overlay-button"
        aria-label="Add default markdown overlay"
        onClick={handleMarkdownButtonClick}
        onKeyDown={handleButtonKeyDown}
        className="cursor-pointer bg-transparent border-0 p-0 w-full"
        type="button"
      >
        <DraggableMediaItem
          name="Default markdown"
          preview={
            <div className="flex items-center justify-center w-full h-full bg-accent rounded p-2">
              <span className="text-xs select-none text-center">
                Markdown
              </span>
            </div>
          }
          dragData={{
            id: markdownData.id,
            type: markdownData.type,
            name: markdownData.name,
            markdownContent: markdownData.markdownContent,
          }}
          aspectRatio={1}
          onAddToTimeline={handleAddMarkdownToTimeline}
          showLabel={false}
          stopPropagation={false}
        />
      </button>
    </div>
  );
}
