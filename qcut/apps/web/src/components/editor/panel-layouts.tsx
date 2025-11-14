"use client";

import React from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "../ui/resizable";
import { MediaPanel } from "./media-panel";
import { PropertiesPanel } from "./properties-panel";
import { Timeline } from "./timeline";
import { PreviewPanel } from "./preview-panel";
import { usePanelStore } from "@/stores/panel-store";

interface LayoutProps {
  resetCounter: number;
}

export function DefaultLayout({ resetCounter }: LayoutProps) {
  const {
    toolsPanel,
    previewPanel,
    mainContent,
    timeline,
    propertiesPanel,
    setToolsPanel,
    setPreviewPanel,
    setMainContent,
    setTimeline,
    setPropertiesPanel,
    normalizeHorizontalPanels,
  } = usePanelStore();

  // Normalize panel sizes to ensure they sum to 100%
  const total = toolsPanel + previewPanel + propertiesPanel;
  const normalizationFactor = total !== 0 ? 100 / total : 1;

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

  const normalizedTools = clamp(
    Math.round(toolsPanel * normalizationFactor * 100) / 100,
    15,
    40
  );
  const normalizedPreview = clamp(
    Math.round(previewPanel * normalizationFactor * 100) / 100,
    30,
    100
  );
  // Properties gets the remainder to ensure exact 100%
  const normalizedProperties = clamp(
    Math.round((100 - normalizedTools - normalizedPreview) * 100) / 100,
    15,
    40
  );

  // Panel size calculation completed

  // Trigger normalization if panels are off
  React.useEffect(() => {
    if (Math.abs(total - 100) > 0.1) {
      normalizeHorizontalPanels();
    }
  }, [total, normalizeHorizontalPanels]);

  return (
    <ResizablePanelGroup
      key={`default-${resetCounter}`}
      direction="vertical"
      className="h-full w-full gap-[0.18rem]"
    >
      <ResizablePanel
        defaultSize={mainContent}
        minSize={30}
        maxSize={85}
        onResize={setMainContent}
        className="min-h-0"
      >
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full w-full gap-[0.19rem] px-2"
        >
          <ResizablePanel
            defaultSize={normalizedTools}
            minSize={15}
            maxSize={40}
            onResize={setToolsPanel}
            className="min-w-0"
          >
            <MediaPanel />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            defaultSize={normalizedPreview}
            minSize={30}
            onResize={setPreviewPanel}
            className="min-w-0 min-h-0 flex-1"
          >
            <PreviewPanel />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            defaultSize={normalizedProperties}
            minSize={15}
            maxSize={40}
            onResize={setPropertiesPanel}
            className="min-w-0"
          >
            <PropertiesPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel
        defaultSize={timeline}
        minSize={15}
        maxSize={70}
        onResize={setTimeline}
        className="min-h-0 px-2 pb-2"
      >
        <Timeline />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export function MediaLayout({ resetCounter }: LayoutProps) {
  const {
    toolsPanel,
    previewPanel,
    mainContent,
    timeline,
    propertiesPanel,
    setToolsPanel,
    setPreviewPanel,
    setMainContent,
    setTimeline,
    setPropertiesPanel,
  } = usePanelStore();

  // Calculate relative sizes for nested panels
  // The right group contains preview + properties and its total width is (100 - toolsPanel)
  const rightGroupTotal = Math.max(1, 100 - toolsPanel);

  // Convert from global percentages to right group percentages and ensure they sum to 100%
  const rawPreviewRelative = (previewPanel / rightGroupTotal) * 100;
  const rawPropertiesRelative = (propertiesPanel / rightGroupTotal) * 100;
  const totalRaw = rawPreviewRelative + rawPropertiesRelative;

  // Normalize to ensure total is 100%
  const previewPanelRelative =
    totalRaw > 0 ? (rawPreviewRelative / totalRaw) * 100 : 60;
  const propertiesPanelRelative =
    totalRaw > 0 ? (rawPropertiesRelative / totalRaw) * 100 : 40;

  // Debug: Verify layout normalization fix
  if (import.meta.env.DEV) {
    const total = previewPanelRelative + propertiesPanelRelative;
    if (Math.abs(total - 100) > 0.01) {
      console.warn(
        `MediaLayout: Panel sizes don't sum to 100%: ${total.toFixed(2)}%`
      );
    } else {
      console.log(
        `✅ MediaLayout: Panel sizes normalized correctly: ${total.toFixed(2)}%`
      );
    }
  }

  // Convert from right group percentage back to global percentage
  const toGlobalPreview = (rightGroupPct: number) =>
    (rightGroupPct * rightGroupTotal) / 100;
  const toGlobalProperties = (rightGroupPct: number) =>
    (rightGroupPct * rightGroupTotal) / 100;

  return (
    <ResizablePanelGroup
      key={`media-${resetCounter}`}
      direction="horizontal"
      className="h-full w-full gap-[0.18rem]"
    >
      <ResizablePanel
        defaultSize={toolsPanel}
        minSize={15}
        maxSize={40}
        onResize={setToolsPanel}
        className="min-w-0"
      >
        <MediaPanel />
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel
        defaultSize={100 - toolsPanel}
        minSize={60}
        className="min-w-0 min-h-0"
      >
        <ResizablePanelGroup
          direction="vertical"
          className="h-full w-full gap-[0.18rem]"
        >
          <ResizablePanel
            defaultSize={mainContent}
            minSize={30}
            maxSize={85}
            onResize={setMainContent}
            className="min-h-0"
          >
            <ResizablePanelGroup
              direction="horizontal"
              className="h-full w-full gap-[0.19rem] px-2"
            >
              <ResizablePanel
                defaultSize={previewPanelRelative}
                minSize={30}
                onResize={(pct) => setPreviewPanel(toGlobalPreview(pct))}
                className="min-w-0 min-h-0 flex-1"
              >
                <PreviewPanel />
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                defaultSize={propertiesPanelRelative}
                minSize={15}
                maxSize={40}
                onResize={(pct) => setPropertiesPanel(toGlobalProperties(pct))}
                className="min-w-0"
              >
                <PropertiesPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            defaultSize={timeline}
            minSize={15}
            maxSize={70}
            onResize={setTimeline}
            className="min-h-0 px-2 pb-2"
          >
            <Timeline />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export function InspectorLayout({ resetCounter }: LayoutProps) {
  const {
    toolsPanel,
    previewPanel,
    mainContent,
    timeline,
    propertiesPanel,
    setToolsPanel,
    setPreviewPanel,
    setMainContent,
    setTimeline,
    setPropertiesPanel,
  } = usePanelStore();

  // Calculate relative sizes for nested panels
  // The left group contains tools + preview and its total width is (100 - propertiesPanel)
  const leftGroupTotal = Math.max(1, 100 - propertiesPanel);

  // Convert from global percentages to left group percentages and ensure they sum to 100%
  const rawToolsRelative = (toolsPanel / leftGroupTotal) * 100;
  const rawPreviewRelative = (previewPanel / leftGroupTotal) * 100;
  const totalRaw = rawToolsRelative + rawPreviewRelative;

  // Normalize to ensure total is 100%
  const toolsPanelRelative =
    totalRaw > 0 ? (rawToolsRelative / totalRaw) * 100 : 30;
  const previewPanelRelative =
    totalRaw > 0 ? (rawPreviewRelative / totalRaw) * 100 : 70;

  // Debug: Verify layout normalization fix
  if (import.meta.env.DEV) {
    const total = toolsPanelRelative + previewPanelRelative;
    if (Math.abs(total - 100) > 0.01) {
      console.warn(
        `InspectorLayout: Panel sizes don't sum to 100%: ${total.toFixed(2)}%`
      );
    } else {
      console.log(
        `✅ InspectorLayout: Panel sizes normalized correctly: ${total.toFixed(2)}%`
      );
    }
  }

  // Convert from left group percentage back to global percentage
  const toGlobalTools = (leftGroupPct: number) =>
    (leftGroupPct * leftGroupTotal) / 100;
  const toGlobalPreview = (leftGroupPct: number) =>
    (leftGroupPct * leftGroupTotal) / 100;

  return (
    <ResizablePanelGroup
      key={`inspector-${resetCounter}`}
      direction="horizontal"
      className="h-full w-full gap-[0.18rem] px-3 pb-3"
    >
      <ResizablePanel defaultSize={toolsPanel + previewPanel} minSize={60}>
        <ResizablePanelGroup
          direction="vertical"
          className="h-full w-full gap-[0.18rem]"
        >
          <ResizablePanel
            defaultSize={mainContent}
            minSize={30}
            onResize={setMainContent}
          >
            <ResizablePanelGroup
              direction="horizontal"
              className="h-full w-full gap-[0.19rem]"
            >
              <ResizablePanel
                defaultSize={toolsPanelRelative}
                minSize={15}
                onResize={(pct) => setToolsPanel(toGlobalTools(pct))}
              >
                <MediaPanel />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel
                defaultSize={previewPanelRelative}
                minSize={30}
                onResize={(pct) => setPreviewPanel(toGlobalPreview(pct))}
              >
                <PreviewPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={timeline}
            minSize={15}
            onResize={setTimeline}
          >
            <Timeline />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        defaultSize={propertiesPanel}
        minSize={15}
        maxSize={40}
        onResize={setPropertiesPanel}
      >
        <PropertiesPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export function VerticalPreviewLayout({ resetCounter }: LayoutProps) {
  const {
    toolsPanel,
    previewPanel,
    mainContent,
    timeline,
    propertiesPanel,
    setToolsPanel,
    setPreviewPanel,
    setMainContent,
    setTimeline,
    setPropertiesPanel,
  } = usePanelStore();

  // Calculate relative sizes for nested panels
  // The left group contains tools + properties and its total width is (100 - previewPanel)
  const leftGroupTotal = Math.max(1, 100 - previewPanel);

  // Convert from global percentages to left group percentages and ensure they sum to 100%
  const rawToolsRelative = (toolsPanel / leftGroupTotal) * 100;
  const rawPropertiesRelative = (propertiesPanel / leftGroupTotal) * 100;
  const totalRaw = rawToolsRelative + rawPropertiesRelative;

  // Normalize to ensure total is 100%
  const toolsPanelRelative =
    totalRaw > 0 ? (rawToolsRelative / totalRaw) * 100 : 50;
  const propertiesPanelRelative =
    totalRaw > 0 ? (rawPropertiesRelative / totalRaw) * 100 : 50;

  // Debug: Verify layout normalization fix
  if (import.meta.env.DEV) {
    const total = toolsPanelRelative + propertiesPanelRelative;
    if (Math.abs(total - 100) > 0.01) {
      console.warn(
        `VerticalPreviewLayout: Panel sizes don't sum to 100%: ${total.toFixed(2)}%`
      );
    } else {
      console.log(
        `✅ VerticalPreviewLayout: Panel sizes normalized correctly: ${total.toFixed(2)}%`
      );
    }
  }

  // Convert from left group percentage back to global percentage
  const toGlobalTools = (leftGroupPct: number) =>
    (leftGroupPct * leftGroupTotal) / 100;
  const toGlobalProperties = (leftGroupPct: number) =>
    (leftGroupPct * leftGroupTotal) / 100;

  return (
    <ResizablePanelGroup
      key={`vertical-preview-${resetCounter}`}
      direction="horizontal"
      className="h-full w-full gap-[0.18rem] px-3 pb-3"
    >
      <ResizablePanel defaultSize={toolsPanel + propertiesPanel} minSize={60}>
        <ResizablePanelGroup
          direction="vertical"
          className="h-full w-full gap-[0.18rem]"
        >
          <ResizablePanel
            defaultSize={mainContent}
            minSize={30}
            onResize={setMainContent}
          >
            <ResizablePanelGroup
              direction="horizontal"
              className="h-full w-full gap-[0.19rem]"
            >
              <ResizablePanel
                defaultSize={toolsPanelRelative}
                minSize={25}
                onResize={(pct) => setToolsPanel(toGlobalTools(pct))}
              >
                <MediaPanel />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel
                defaultSize={propertiesPanelRelative}
                minSize={25}
                onResize={(pct) => setPropertiesPanel(toGlobalProperties(pct))}
              >
                <PropertiesPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize={timeline}
            minSize={15}
            onResize={setTimeline}
          >
            <Timeline />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        defaultSize={previewPanel}
        minSize={30}
        onResize={setPreviewPanel}
      >
        <PreviewPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
