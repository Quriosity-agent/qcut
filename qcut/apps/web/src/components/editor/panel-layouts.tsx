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

  // Calculate relative sizes for nested panels
  // The right group contains preview + properties and its total width is (100 - toolsPanel)
  const rightGroupTotal = Math.max(1, 100 - toolsPanel);
  
  // Convert from global percentages to right group percentages
  const previewPanelRelative = (previewPanel / rightGroupTotal) * 100;
  const propertiesPanelRelative = (propertiesPanel / rightGroupTotal) * 100;
  
  // Convert from right group percentage back to global percentage
  const toGlobalPreview = (rightGroupPct: number) => (rightGroupPct * rightGroupTotal) / 100;
  const toGlobalProperties = (rightGroupPct: number) => (rightGroupPct * rightGroupTotal) / 100;


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
  
  // Convert from global percentages to left group percentages
  const toolsPanelRelative = (toolsPanel / leftGroupTotal) * 100;
  const previewPanelRelative = (previewPanel / leftGroupTotal) * 100;
  
  // Convert from left group percentage back to global percentage
  const toGlobalTools = (leftGroupPct: number) => (leftGroupPct * leftGroupTotal) / 100;
  const toGlobalPreview = (leftGroupPct: number) => (leftGroupPct * leftGroupTotal) / 100;

  return (
    <ResizablePanelGroup
      key={`inspector-${resetCounter}`}
      direction="horizontal"
      className="h-full w-full gap-[0.18rem] px-3 pb-3"
    >
      <ResizablePanel defaultSize={toolsPanel + previewPanel} minSize={60}>
        <ResizablePanelGroup direction="vertical" className="h-full w-full gap-[0.18rem]">
          <ResizablePanel defaultSize={mainContent} minSize={30} onResize={setMainContent}>
            <ResizablePanelGroup direction="horizontal" className="h-full w-full gap-[0.19rem]">
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
          <ResizablePanel defaultSize={timeline} minSize={15} onResize={setTimeline}>
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

  // Calculate relative sizes for nested panels
  // The left group contains tools + properties and its total width is (100 - previewPanel)
  const leftGroupTotal = Math.max(1, 100 - previewPanel);
  
  // Convert from global percentages to left group percentages
  const toolsPanelRelative = (toolsPanel / leftGroupTotal) * 100;
  const propertiesPanelRelative = (propertiesPanel / leftGroupTotal) * 100;
  
  // Convert from left group percentage back to global percentage
  const toGlobalTools = (leftGroupPct: number) => (leftGroupPct * leftGroupTotal) / 100;
  const toGlobalProperties = (leftGroupPct: number) => (leftGroupPct * leftGroupTotal) / 100;

  return (
    <ResizablePanelGroup
      key={`vertical-preview-${resetCounter}`}
      direction="horizontal"
      className="h-full w-full gap-[0.18rem] px-3 pb-3"
    >
      <ResizablePanel defaultSize={toolsPanel + propertiesPanel} minSize={60}>
        <ResizablePanelGroup direction="vertical" className="h-full w-full gap-[0.18rem]">
          <ResizablePanel defaultSize={mainContent} minSize={30} onResize={setMainContent}>
            <ResizablePanelGroup direction="horizontal" className="h-full w-full gap-[0.19rem]">
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
          <ResizablePanel defaultSize={timeline} minSize={15} onResize={setTimeline}>
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