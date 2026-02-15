import { MarkdownProperties } from "@/components/editor/properties-panel/markdown-properties";
import type { MarkdownElement } from "@/types/timeline";

interface MarkdownEditorPanelProps {
  element: MarkdownElement;
  trackId: string;
}

export function MarkdownEditorPanel({
  element,
  trackId,
}: MarkdownEditorPanelProps) {
  return <MarkdownProperties element={element} trackId={trackId} />;
}
