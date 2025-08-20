# Panel Presets Integration Guide

## Overview
This guide breaks down the panel presets feature into small, manageable tasks that can be implemented in under 10 minutes each. Each task is designed to be non-breaking and can reuse existing code patterns.

## Prerequisites
- Existing `usePanelStore` with basic panel size management
- `ResizablePanelGroup` components already in use
- Basic dropdown menu components available

---

## Task 1: Add Panel Preset Types (5 minutes)

**Objective**: Add TypeScript types for panel presets to the existing panel store.

**Files to modify**:
- `apps/web/src/stores/panel-store.ts`

**Implementation**:
```typescript
// Add at the top of panel-store.ts after existing imports
export type PanelPreset = "default" | "media" | "inspector" | "vertical-preview";

// Add to existing PanelState interface
interface PanelState extends PanelSizes {
  // ... existing properties
  activePreset: PanelPreset;
  resetCounter: number;
  
  // ... existing methods
  setActivePreset: (preset: PanelPreset) => void;
  resetPreset: (preset: PanelPreset) => void;
}
```

**Testing**: TypeScript should compile without errors. No UI changes yet.

---

## Task 2: Add Preset Configurations (8 minutes)

**Objective**: Define default panel sizes for each preset layout.

**Files to modify**:
- `apps/web/src/stores/panel-store.ts`

**Implementation**:
```typescript
// Add before the store creation
const PRESET_CONFIGS: Record<PanelPreset, PanelSizes> = {
  default: {
    toolsPanel: 25,
    previewPanel: 50,
    propertiesPanel: 25,
    mainContent: 70,
    timeline: 30,
  },
  media: {
    toolsPanel: 30,
    previewPanel: 45,
    propertiesPanel: 25,
    mainContent: 100,
    timeline: 25,
  },
  inspector: {
    toolsPanel: 25,
    previewPanel: 50,
    propertiesPanel: 25,
    mainContent: 100,
    timeline: 25,
  },
  "vertical-preview": {
    toolsPanel: 25,
    previewPanel: 40,
    propertiesPanel: 35,
    mainContent: 100,
    timeline: 25,
  },
};

// Export for use in other components
export { PRESET_CONFIGS };
```

**Testing**: Import `PRESET_CONFIGS` in a test file to verify export works.

---

## Task 3: Add Basic Preset State Management (10 minutes)

**Objective**: Add preset state to the store without breaking existing functionality.

**Files to modify**:
- `apps/web/src/stores/panel-store.ts`

**Implementation**:
```typescript
// Add to store initialization (in the object passed to create())
{
  // ... existing state
  activePreset: "default" as PanelPreset,
  resetCounter: 0,
  
  // ... existing methods
  setActivePreset: (preset) => {
    const defaultSizes = PRESET_CONFIGS[preset];
    set({
      activePreset: preset,
      ...defaultSizes,
    });
  },
  
  resetPreset: (preset) => {
    const { activePreset, resetCounter } = get();
    const defaultSizes = PRESET_CONFIGS[preset];
    
    const updates: Partial<PanelState> = {
      resetCounter: resetCounter + 1,
    };
    
    if (preset === activePreset) {
      Object.assign(updates, defaultSizes);
    }
    
    set(updates);
  },
}
```

**Testing**: Check that existing panel resizing still works. Preset switching should work in browser dev tools.

---

## Task 4: Create Basic Preset Selector Component (10 minutes)

**Objective**: Create a simple dropdown component for preset selection.

**Files to create**:
- `apps/web/src/components/panel-preset-selector.tsx`

**Implementation**:
```typescript
"use client";

import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ChevronDown, LayoutPanelTop } from "lucide-react";
import { usePanelStore, type PanelPreset } from "@/stores/panel-store";

const PRESET_LABELS: Record<PanelPreset, string> = {
  default: "Default",
  media: "Media",
  inspector: "Inspector",
  "vertical-preview": "Vertical Preview",
};

export function PanelPresetSelector() {
  const { activePreset, setActivePreset } = usePanelStore();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="h-8 px-2 text-xs">
          <LayoutPanelTop className="h-4 w-4 mr-1" />
          {PRESET_LABELS[activePreset]}
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {(Object.keys(PRESET_LABELS) as PanelPreset[]).map((preset) => (
          <DropdownMenuItem
            key={preset}
            onClick={() => setActivePreset(preset)}
          >
            {PRESET_LABELS[preset]}
            {activePreset === preset && " ✓"}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

**Testing**: Import and render component in isolation. Dropdown should open and close.

---

## Task 5: Add Preset Selector to Header (3 minutes)

**Objective**: Integrate the preset selector into the existing editor header.

**Files to modify**:
- `apps/web/src/components/editor-header.tsx`

**Implementation**:
```typescript
// Add import at the top
import { PanelPresetSelector } from "./panel-preset-selector";

// Find the rightContent or navigation section and add:
const rightContent = (
  <nav className="flex items-center gap-2">
    <PanelPresetSelector />
    {/* ... existing components like KeyboardShortcutsHelp */}
  </nav>
);
```

**Testing**: Preset selector should appear in header. Switching presets should change panel sizes.

---

## Task 6: Add Media Preset Layout (10 minutes)

**Objective**: Implement the media preset layout with horizontal arrangement.

**Files to modify**:
- `apps/web/src/app/editor/[project_id]/page.tsx`

**Implementation**:
```typescript
// Add to imports
import { usePanelStore } from "@/stores/panel-store";

// Get activePreset from store
const { activePreset, resetCounter } = usePanelStore();

// Replace existing ResizablePanelGroup with conditional rendering
{activePreset === "media" ? (
  <ResizablePanelGroup
    key={`media-${resetCounter}`}
    direction="horizontal"
    className="h-full w-full gap-[0.18rem] px-3 pb-3"
  >
    <ResizablePanel defaultSize={toolsPanel} minSize={15} maxSize={40}>
      <MediaPanel />
    </ResizablePanel>
    <ResizableHandle withHandle />
    <ResizablePanel defaultSize={100 - toolsPanel} minSize={60}>
      <ResizablePanelGroup direction="vertical" className="h-full w-full gap-[0.18rem]">
        <ResizablePanel defaultSize={mainContent} minSize={30}>
          <ResizablePanelGroup direction="horizontal" className="h-full w-full gap-[0.19rem]">
            <ResizablePanel defaultSize={previewPanel} minSize={30}>
              <PreviewPanel />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={propertiesPanel} minSize={15} maxSize={40}>
              <PropertiesPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={timeline} minSize={15} maxSize={70}>
          <Timeline />
        </ResizablePanel>
      </ResizablePanelGroup>
    </ResizablePanel>
  </ResizablePanelGroup>
) : (
  // Keep existing default layout here as fallback
  <ResizablePanelGroup direction="vertical" className="h-full w-full gap-[0.18rem]">
    {/* ... existing layout */}
  </ResizablePanelGroup>
)}
```

**Testing**: Media preset should show full-height media panel on left. Default should work unchanged.

---

## Task 7: Add Inspector Preset Layout (8 minutes)

**Objective**: Add inspector preset with full-height properties panel on right.

**Files to modify**:
- `apps/web/src/app/editor/[project_id]/page.tsx`

**Implementation**:
```typescript
// Add before the existing fallback
: activePreset === "inspector" ? (
  <ResizablePanelGroup
    key={`inspector-${resetCounter}`}
    direction="horizontal"
    className="h-full w-full gap-[0.18rem] px-3 pb-3"
  >
    <ResizablePanel defaultSize={100 - propertiesPanel} minSize={60}>
      <ResizablePanelGroup direction="vertical" className="h-full w-full gap-[0.18rem]">
        <ResizablePanel defaultSize={mainContent} minSize={30}>
          <ResizablePanelGroup direction="horizontal" className="h-full w-full gap-[0.19rem]">
            <ResizablePanel defaultSize={toolsPanel} minSize={15} maxSize={40}>
              <MediaPanel />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={previewPanel} minSize={30}>
              <PreviewPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={timeline} minSize={15} maxSize={70}>
          <Timeline />
        </ResizablePanel>
      </ResizablePanelGroup>
    </ResizablePanel>
    <ResizableHandle withHandle />
    <ResizablePanel defaultSize={propertiesPanel} minSize={15} maxSize={40}>
      <PropertiesPanel />
    </ResizablePanel>
  </ResizablePanelGroup>
)
```

**Testing**: Inspector preset should show full-height properties panel on right.

---

## Task 8: Add Vertical Preview Preset Layout (8 minutes)

**Objective**: Add vertical preview preset optimized for vertical videos.

**Files to modify**:
- `apps/web/src/app/editor/[project_id]/page.tsx`

**Implementation**:
```typescript
// Add before the fallback
: activePreset === "vertical-preview" ? (
  <ResizablePanelGroup
    key={`vertical-preview-${resetCounter}`}
    direction="horizontal"
    className="h-full w-full gap-[0.18rem] px-3 pb-3"
  >
    <ResizablePanel defaultSize={100 - previewPanel} minSize={60}>
      <ResizablePanelGroup direction="vertical" className="h-full w-full gap-[0.18rem]">
        <ResizablePanel defaultSize={mainContent} minSize={30}>
          <ResizablePanelGroup direction="horizontal" className="h-full w-full gap-[0.19rem]">
            <ResizablePanel defaultSize={toolsPanel} minSize={15} maxSize={40}>
              <MediaPanel />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={propertiesPanel} minSize={15} maxSize={40}>
              <PropertiesPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={timeline} minSize={15} maxSize={70}>
          <Timeline />
        </ResizablePanel>
      </ResizablePanelGroup>
    </ResizablePanel>
    <ResizableHandle withHandle />
    <ResizablePanel defaultSize={previewPanel} minSize={30}>
      <PreviewPanel />
    </ResizablePanel>
  </ResizablePanelGroup>
)
```

**Testing**: Vertical preview preset should show full-height preview panel on right.

---

## Task 9: Add Enhanced Preset Descriptions (5 minutes)

**Objective**: Add helpful descriptions to the preset selector.

**Files to modify**:
- `apps/web/src/components/panel-preset-selector.tsx`

**Implementation**:
```typescript
// Add descriptions
const PRESET_DESCRIPTIONS: Record<PanelPreset, string> = {
  default: "Media, preview, and inspector on top row, timeline on bottom",
  media: "Full height media on left, preview and inspector on top row",
  inspector: "Full height inspector on right, media and preview on top row",
  "vertical-preview": "Full height preview on right for vertical videos",
};

// Update DropdownMenuItem to show descriptions
<DropdownMenuItem
  key={preset}
  onClick={() => setActivePreset(preset)}
  className="flex flex-col items-start py-2"
>
  <div className="font-medium">{PRESET_LABELS[preset]}</div>
  <div className="text-xs text-muted-foreground">
    {PRESET_DESCRIPTIONS[preset]}
  </div>
</DropdownMenuItem>
```

**Testing**: Dropdown should show helpful descriptions for each preset.

---

## Task 10: Add Reset Functionality (10 minutes)

**Objective**: Add individual reset buttons for each preset.

**Files to modify**:
- `apps/web/src/components/panel-preset-selector.tsx`

**Implementation**:
```typescript
// Add import
import { RotateCcw } from "lucide-react";

// Add reset handler
const handleResetPreset = (preset: PanelPreset, event: React.MouseEvent) => {
  event.stopPropagation();
  resetPreset(preset);
};

// Update DropdownMenuItem
<DropdownMenuItem
  key={preset}
  onClick={() => setActivePreset(preset)}
  className="flex items-start justify-between gap-2 py-2"
>
  <div className="flex-1">
    <div className="font-medium">{PRESET_LABELS[preset]}</div>
    <div className="text-xs text-muted-foreground">
      {PRESET_DESCRIPTIONS[preset]}
    </div>
  </div>
  <Button
    variant="secondary"
    size="icon"
    className="h-6 w-6 opacity-60 hover:opacity-100"
    onClick={(e) => handleResetPreset(preset, e)}
    title={`Reset ${PRESET_LABELS[preset]} preset`}
  >
    <RotateCcw className="h-3 w-3" />
  </Button>
</DropdownMenuItem>
```

**Testing**: Reset buttons should restore preset to default sizes.

---

## Implementation Checklist

- [ ] Task 1: Panel preset types (5min)
- [ ] Task 2: Preset configurations (8min)  
- [ ] Task 3: Basic preset state management (10min)
- [ ] Task 4: Basic preset selector component (10min)
- [ ] Task 5: Add selector to header (3min)
- [ ] Task 6: Media preset layout (10min)
- [ ] Task 7: Inspector preset layout (8min)
- [ ] Task 8: Vertical preview preset layout (8min)
- [ ] Task 9: Enhanced descriptions (5min)
- [ ] Task 10: Reset functionality (10min)

**Total estimated time**: 77 minutes across 10 tasks

## Safety Guidelines

1. **Test after each task** - Ensure existing functionality still works
2. **Use feature flags** - Wrap new code in conditionals if needed
3. **Preserve existing layouts** - Default preset should match current behavior
4. **Incremental rollout** - Can enable presets gradually
5. **Fallback handling** - Always have a default case in conditional rendering

## Troubleshooting

**Issue**: Panel sizes don't persist
- **Solution**: Check Zustand persist middleware is working

**Issue**: Layout breaks on preset switch  
- **Solution**: Ensure `key` prop includes `resetCounter` for forced re-render

**Issue**: TypeScript errors
- **Solution**: Update interface exports and imports

**Issue**: UI components missing
- **Solution**: Install required Lucide React icons or use alternatives