import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTimelineStore } from "@/stores/timeline-store";
import type { MarkdownElement } from "@/types/timeline";
import {
  PropertyGroup,
  PropertyItem,
  PropertyItemLabel,
  PropertyItemValue,
} from "./property-item";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { clampMarkdownDuration } from "@/lib/markdown";

interface MarkdownPropertiesProps {
  element: MarkdownElement;
  trackId: string;
}

export function MarkdownProperties({
  element,
  trackId,
}: MarkdownPropertiesProps) {
  const updateMarkdownElement = useTimelineStore(
    (s) => s.updateMarkdownElement
  );

  const [durationInput, setDurationInput] = useState(
    element.duration.toString()
  );
  const [fontSizeInput, setFontSizeInput] = useState(
    element.fontSize.toString()
  );
  const [paddingInput, setPaddingInput] = useState(element.padding.toString());
  const [scrollSpeedInput, setScrollSpeedInput] = useState(
    element.scrollSpeed.toString()
  );

  useEffect(() => {
    setDurationInput(element.duration.toString());
    setFontSizeInput(element.fontSize.toString());
    setPaddingInput(element.padding.toString());
    setScrollSpeedInput(element.scrollSpeed.toString());
  }, [
    element.duration,
    element.fontSize,
    element.padding,
    element.scrollSpeed,
  ]);

  const applyUpdates = ({ updates }: { updates: Partial<MarkdownElement> }) => {
    try {
      updateMarkdownElement(trackId, element.id, updates);
    } catch (error) {
      console.error(
        "[MarkdownProperties] Failed to update markdown element:",
        error
      );
    }
  };

  const handleDurationBlur = () => {
    const parsed = Number.parseFloat(durationInput);
    const duration = clampMarkdownDuration({
      duration: Number.isFinite(parsed)
        ? parsed
        : TIMELINE_CONSTANTS.MARKDOWN_DEFAULT_DURATION,
    });
    setDurationInput(duration.toString());
    applyUpdates({ updates: { duration } });
  };

  const handleFontSizeBlur = () => {
    const parsed = Number.parseInt(fontSizeInput, 10);
    const nextFontSize = Math.max(
      10,
      Math.min(96, Number.isFinite(parsed) ? parsed : 18)
    );
    setFontSizeInput(nextFontSize.toString());
    applyUpdates({ updates: { fontSize: nextFontSize } });
  };

  const handlePaddingBlur = () => {
    const parsed = Number.parseInt(paddingInput, 10);
    const nextPadding = Math.max(
      0,
      Math.min(96, Number.isFinite(parsed) ? parsed : 16)
    );
    setPaddingInput(nextPadding.toString());
    applyUpdates({ updates: { padding: nextPadding } });
  };

  const handleScrollSpeedBlur = () => {
    const parsed = Number.parseInt(scrollSpeedInput, 10);
    const nextScrollSpeed = Math.max(
      0,
      Math.min(200, Number.isFinite(parsed) ? parsed : 30)
    );
    setScrollSpeedInput(nextScrollSpeed.toString());
    applyUpdates({ updates: { scrollSpeed: nextScrollSpeed } });
  };

  return (
    <div className="space-y-6 p-5">
      <div className="space-y-2">
        <Label
          htmlFor="markdown-content"
          className="text-xs text-muted-foreground"
        >
          Markdown content
        </Label>
        <Textarea
          id="markdown-content"
          value={element.markdownContent}
          className="min-h-40 resize-y bg-background/50"
          onChange={(e) => {
            applyUpdates({ updates: { markdownContent: e.target.value } });
          }}
        />
      </div>

      <PropertyGroup title="Duration" defaultExpanded={true}>
        <PropertyItem direction="column">
          <PropertyItemLabel>Duration (seconds)</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                data-testid="markdown-duration-slider"
                value={[element.duration]}
                min={TIMELINE_CONSTANTS.MARKDOWN_MIN_DURATION}
                max={TIMELINE_CONSTANTS.MARKDOWN_MAX_DURATION}
                step={1}
                onValueChange={([duration]) => {
                  const nextDuration = clampMarkdownDuration({ duration });
                  setDurationInput(nextDuration.toString());
                  applyUpdates({ updates: { duration: nextDuration } });
                }}
                className="w-full"
              />
              <Input
                data-testid="markdown-duration-input"
                type="number"
                value={durationInput}
                min={TIMELINE_CONSTANTS.MARKDOWN_MIN_DURATION}
                max={TIMELINE_CONSTANTS.MARKDOWN_MAX_DURATION}
                onChange={(e) => setDurationInput(e.target.value)}
                onBlur={handleDurationBlur}
                className="w-20 h-7"
              />
            </div>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>

      <PropertyGroup title="Appearance" defaultExpanded={true}>
        <PropertyItem direction="row">
          <PropertyItemLabel>Theme</PropertyItemLabel>
          <PropertyItemValue>
            <Select
              value={element.theme}
              onValueChange={(value: MarkdownElement["theme"]) => {
                applyUpdates({ updates: { theme: value } });
              }}
            >
              <SelectTrigger className="h-7 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="transparent">Transparent</SelectItem>
              </SelectContent>
            </Select>
          </PropertyItemValue>
        </PropertyItem>

        <PropertyItem direction="column">
          <PropertyItemLabel>Font size</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                data-testid="markdown-font-size-slider"
                value={[element.fontSize]}
                min={10}
                max={96}
                step={1}
                onValueChange={([fontSize]) => {
                  setFontSizeInput(fontSize.toString());
                  applyUpdates({ updates: { fontSize } });
                }}
                className="w-full"
              />
              <Input
                data-testid="markdown-font-size-input"
                type="number"
                value={fontSizeInput}
                min={10}
                max={96}
                onChange={(e) => setFontSizeInput(e.target.value)}
                onBlur={handleFontSizeBlur}
                className="w-16 h-7"
              />
            </div>
          </PropertyItemValue>
        </PropertyItem>

        <PropertyItem direction="column">
          <PropertyItemLabel>Padding</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                value={[element.padding]}
                min={0}
                max={96}
                step={1}
                onValueChange={([padding]) => {
                  setPaddingInput(padding.toString());
                  applyUpdates({ updates: { padding } });
                }}
                className="w-full"
              />
              <Input
                type="number"
                value={paddingInput}
                min={0}
                max={96}
                onChange={(e) => setPaddingInput(e.target.value)}
                onBlur={handlePaddingBlur}
                className="w-16 h-7"
              />
            </div>
          </PropertyItemValue>
        </PropertyItem>

        <PropertyItem direction="row">
          <PropertyItemLabel>Text color</PropertyItemLabel>
          <PropertyItemValue>
            <Input
              type="color"
              value={element.textColor}
              onChange={(e) => {
                applyUpdates({ updates: { textColor: e.target.value } });
              }}
              className="w-10 h-7 p-1"
            />
          </PropertyItemValue>
        </PropertyItem>

        <PropertyItem direction="row">
          <PropertyItemLabel>Background</PropertyItemLabel>
          <PropertyItemValue>
            <Input
              type="text"
              value={element.backgroundColor}
              onChange={(e) => {
                applyUpdates({ updates: { backgroundColor: e.target.value } });
              }}
              className="h-7 w-40 text-xs"
            />
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>

      <PropertyGroup title="Scroll" defaultExpanded={true}>
        <PropertyItem direction="row">
          <PropertyItemLabel>Mode</PropertyItemLabel>
          <PropertyItemValue>
            <Select
              value={element.scrollMode}
              onValueChange={(value: MarkdownElement["scrollMode"]) => {
                applyUpdates({ updates: { scrollMode: value } });
              }}
            >
              <SelectTrigger className="h-7 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="static">Static</SelectItem>
                <SelectItem value="auto-scroll">Auto-scroll</SelectItem>
              </SelectContent>
            </Select>
          </PropertyItemValue>
        </PropertyItem>

        <PropertyItem direction="column">
          <PropertyItemLabel>Scroll speed (px/s)</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                value={[element.scrollSpeed]}
                min={0}
                max={200}
                step={1}
                disabled={element.scrollMode !== "auto-scroll"}
                onValueChange={([scrollSpeed]) => {
                  setScrollSpeedInput(scrollSpeed.toString());
                  applyUpdates({ updates: { scrollSpeed } });
                }}
                className="w-full"
              />
              <Input
                type="number"
                value={scrollSpeedInput}
                min={0}
                max={200}
                disabled={element.scrollMode !== "auto-scroll"}
                onChange={(e) => setScrollSpeedInput(e.target.value)}
                onBlur={handleScrollSpeedBlur}
                className="w-16 h-7"
              />
            </div>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>
    </div>
  );
}
