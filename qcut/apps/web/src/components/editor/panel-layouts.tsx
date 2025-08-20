"use client";

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
  } = usePanelStore();

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
            defaultSize={previewPanel}
            minSize={30}
            onResize={setPreviewPanel}
            className="min-w-0 min-h-0 flex-1"
          >
            <PreviewPanel />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel
            defaultSize={propertiesPanel}
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
        <ResizablePanelGroup direction="vertical" className="h-full w-full gap-[0.18rem]">
          <ResizablePanel
            defaultSize={mainContent}
            minSize={30}
            maxSize={85}
            onResize={setMainContent}
            className="min-h-0"
          >
            <ResizablePanelGroup direction="horizontal" className="h-full w-full gap-[0.19rem] px-2">
              <ResizablePanel
                defaultSize={previewPanel}
                minSize={30}
                onResize={setPreviewPanel}
                className="min-w-0 min-h-0 flex-1"
              >
                <PreviewPanel />
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel
                defaultSize={propertiesPanel}
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

  return (
    <ResizablePanelGroup
      key={`inspector-${resetCounter}`}
      direction="horizontal"
      className="h-full w-full gap-[0.18rem] px-3 pb-3"
    >
      <ResizablePanel defaultSize={100 - propertiesPanel} minSize={60}>
        <ResizablePanelGroup direction="vertical" className="h-full w-full gap-[0.18rem]">
          <ResizablePanel defaultSize={mainContent} minSize={30} onResize={setMainContent}>
            <ResizablePanelGroup direction="horizontal" className="h-full w-full gap-[0.19rem]">
              <ResizablePanel defaultSize={toolsPanel} minSize={15} maxSize={40} onResize={setToolsPanel}>
                <MediaPanel />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={previewPanel} minSize={30} onResize={setPreviewPanel}>
                <PreviewPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={timeline} minSize={15} maxSize={70} onResize={setTimeline}>
            <Timeline />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={propertiesPanel} minSize={15} maxSize={40} onResize={setPropertiesPanel}>
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

  return (
    <ResizablePanelGroup
      key={`vertical-preview-${resetCounter}`}
      direction="horizontal"
      className="h-full w-full gap-[0.18rem] px-3 pb-3"
    >
      <ResizablePanel defaultSize={100 - previewPanel} minSize={60}>
        <ResizablePanelGroup direction="vertical" className="h-full w-full gap-[0.18rem]">
          <ResizablePanel defaultSize={mainContent} minSize={30} onResize={setMainContent}>
            <ResizablePanelGroup direction="horizontal" className="h-full w-full gap-[0.19rem]">
              <ResizablePanel defaultSize={toolsPanel} minSize={15} maxSize={40} onResize={setToolsPanel}>
                <MediaPanel />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={propertiesPanel} minSize={15} maxSize={40} onResize={setPropertiesPanel}>
                <PropertiesPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={timeline} minSize={15} maxSize={70} onResize={setTimeline}>
            <Timeline />
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={previewPanel} minSize={30} onResize={setPreviewPanel}>
        <PreviewPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}