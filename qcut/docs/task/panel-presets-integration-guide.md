# Panel Presets Integration Guide

## Overview
This guide breaks down the panel presets feature into small, manageable tasks that can be implemented in under 10 minutes each. Each task is designed to be non-breaking and can reuse existing code patterns.

## Prerequisites
- ✅ Existing `usePanelStore` with complex state management, debug logging, and circuit breakers
- ✅ `ResizablePanelGroup` components already in use in vertical/horizontal layout
- ✅ Dropdown menu components available (Radix UI)
- ✅ Current panel state includes: `toolsPanel`, `previewPanel`, `propertiesPanel`, `mainContent`, `timeline`, `aiPanelWidth`, `aiPanelMinWidth`

## Current QCut Codebase Structure
- **Panel Store**: Complex Zustand store with circuit breaker, debug logging, normalization
- **Editor Layout**: Vertical split (main content + timeline) with horizontal split (tools + preview + properties)
- **Default Sizes**: tools: 20%, preview: 55%, properties: 25%, mainContent: 70%, timeline: 30%
- **Persistence**: Version 7 with migration and validation

---

## Task 1: Add Panel Preset Types (3 minutes)

**Objective**: Add TypeScript types for panel presets to the existing panel store.

**Files to modify**:
- `apps/web/src/stores/panel-store.ts`

**Implementation**:
```typescript
// Add at line 4 after debug imports
export type PanelPreset = "default" | "media" | "inspector" | "vertical-preview";

// Add to existing PanelState interface (around line 163)
interface PanelState {
  // ... existing properties (toolsPanel, previewPanel, etc.)
  activePreset: PanelPreset;
  presetCustomSizes: Record<PanelPreset, Partial<Pick<PanelState, 'toolsPanel' | 'previewPanel' | 'propertiesPanel' | 'mainContent' | 'timeline'>>>;
  resetCounter: number;

  // ... existing actions
  setActivePreset: (preset: PanelPreset) => void;
  resetPreset: (preset: PanelPreset) => void;
  getCurrentPresetSizes: () => Pick<PanelState, 'toolsPanel' | 'previewPanel' | 'propertiesPanel' | 'mainContent' | 'timeline'>;
}
```

**Testing**: TypeScript should compile without errors. No UI changes yet.

**⚠️ Breaking Changes**: None - only adds new optional properties.

---

## Task 2: Add Preset Configurations (5 minutes)

**Objective**: Define default panel sizes for each preset layout matching current QCut defaults.

**Files to modify**:
- `apps/web/src/stores/panel-store.ts`

**Implementation**:
```typescript
// Add after DEFAULT_PANEL_SIZES constant (around line 162)
interface PanelSizes {
  toolsPanel: number;
  previewPanel: number;
  propertiesPanel: number;
  mainContent: number;
  timeline: number;
  aiPanelWidth: number;
  aiPanelMinWidth: number;
}

const PRESET_CONFIGS: Record<PanelPreset, PanelSizes> = {
  default: {
    toolsPanel: 20,     // Match current DEFAULT_PANEL_SIZES
    previewPanel: 55,   // Match current DEFAULT_PANEL_SIZES  
    propertiesPanel: 25, // Match current DEFAULT_PANEL_SIZES
    mainContent: 70,    // Match current DEFAULT_PANEL_SIZES
    timeline: 30,       // Match current DEFAULT_PANEL_SIZES
    aiPanelWidth: 22,   // Match current DEFAULT_PANEL_SIZES
    aiPanelMinWidth: 4, // Match current DEFAULT_PANEL_SIZES
  },
  media: {
    toolsPanel: 30,     // Larger media panel focus
    previewPanel: 45,   
    propertiesPanel: 25,
    mainContent: 100,   // Full height layout
    timeline: 25,       // Smaller timeline
    aiPanelWidth: 22,
    aiPanelMinWidth: 4,
  },
  inspector: {
    toolsPanel: 20,
    previewPanel: 55,
    propertiesPanel: 25,
    mainContent: 100,   // Full height layout
    timeline: 25,       // Smaller timeline
    aiPanelWidth: 22,
    aiPanelMinWidth: 4,
  },
  "vertical-preview": {
    toolsPanel: 25,
    previewPanel: 40,   // Optimized for vertical videos
    propertiesPanel: 35, // Larger properties panel
    mainContent: 100,   // Full height layout
    timeline: 25,
    aiPanelWidth: 22,
    aiPanelMinWidth: 4,
  },
};

// Export for use in other components  
export { PRESET_CONFIGS };
```

**Testing**: Import `PRESET_CONFIGS` in a test file to verify export works.

**⚠️ Breaking Changes**: None - only adds new constants.

---

## Task 3: Add Basic Preset State Management (10 minutes)

**Objective**: Add preset state to the store without breaking existing complex functionality.

**Files to modify**:
- `apps/web/src/stores/panel-store.ts`

**Implementation**:
```typescript
// Add to store initialization (around line 261, in the object passed to create())
{
  // ... existing state
  activePreset: "default" as PanelPreset,
  presetCustomSizes: {
    default: {},
    media: {},
    inspector: {},
    "vertical-preview": {},
  },
  resetCounter: 0,

  // ... existing actions (keep all existing setters)
  
  // Add new preset methods at the end, before the closing brace
  setActivePreset: (preset) => {
    const { 
      activePreset: currentPreset, 
      presetCustomSizes, 
      toolsPanel, 
      previewPanel, 
      propertiesPanel, 
      mainContent, 
      timeline,
      aiPanelWidth,
      aiPanelMinWidth
    } = get();
    
    // Save current preset sizes before switching
    const updatedPresetCustomSizes = {
      ...presetCustomSizes,
      [currentPreset]: {
        toolsPanel,
        previewPanel,
        propertiesPanel,
        mainContent,
        timeline,
        aiPanelWidth,
        aiPanelMinWidth,
      },
    };
    
    // Load new preset sizes
    const defaultSizes = PRESET_CONFIGS[preset];
    const customSizes = updatedPresetCustomSizes[preset] || {};
    const finalSizes = { ...defaultSizes, ...customSizes };
    
    set({
      activePreset: preset,
      presetCustomSizes: updatedPresetCustomSizes,
      ...finalSizes,
    });
  },
  
  resetPreset: (preset) => {
    const { presetCustomSizes, activePreset, resetCounter } = get();
    const defaultSizes = PRESET_CONFIGS[preset];
    
    const newPresetCustomSizes = {
      ...presetCustomSizes,
      [preset]: {},
    };
    
    const updates: Partial<PanelState> = {
      presetCustomSizes: newPresetCustomSizes,
      resetCounter: resetCounter + 1,
    };
    
    // If resetting the currently active preset, apply the default sizes
    if (preset === activePreset) {
      Object.assign(updates, defaultSizes);
    }
    
    set(updates);
  },
  
  getCurrentPresetSizes: () => {
    const { toolsPanel, previewPanel, propertiesPanel, mainContent, timeline, aiPanelWidth, aiPanelMinWidth } = get();
    return { toolsPanel, previewPanel, propertiesPanel, mainContent, timeline, aiPanelWidth, aiPanelMinWidth };
  },
}
```

**Testing**: Check that existing panel resizing still works. Preset switching should work in browser dev tools: `usePanelStore.getState().setActivePreset('media')`

**⚠️ Breaking Changes**: None - existing functionality preserved with circuit breaker and debug logging intact.

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

**Objective**: Implement the media preset layout with horizontal arrangement to match actual QCut structure.

**Files to modify**:
- `apps/web/src/app/editor/[project_id]/page.tsx`

**Implementation**:
```typescript
// Update imports (activePreset and resetCounter already imported via usePanelStore)
const {
  toolsPanel,
  previewPanel,
  mainContent,
  timeline,
  setToolsPanel,
  setPreviewPanel,
  setMainContent,
  setTimeline,
  propertiesPanel,
  setPropertiesPanel,
  activePreset, // Add this
  resetCounter, // Add this
} = usePanelStore();

// Replace the existing <div className="flex-1 min-h-0 min-w-0"> content with:
<div className="flex-1 min-h-0 min-w-0">
  {activePreset === "media" ? (
    <ResizablePanelGroup
      key={`media-${resetCounter}`}
      direction="horizontal"
      className="h-full w-full gap-[0.18rem]"
    >
      {/* Full-height media panel on left */}
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

      {/* Right side: preview + properties + timeline */}
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
  ) : (
    // Keep existing default layout (copy the current layout exactly)
    <ResizablePanelGroup
      direction="vertical"
      className="h-full w-full gap-[0.18rem]"
    >
      {/* ... copy existing layout exactly as fallback ... */}
    </ResizablePanelGroup>
  )}
</div>
```

**Testing**: Media preset should show full-height media panel on left. Default should work unchanged.

**⚠️ Breaking Changes**: None - wraps existing layout in conditional rendering.

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

## Missing Features Analysis

After comparing with the actual source files, the integration guide now accounts for:

### ✅ **Included in Guide**
- Complex panel store with debug logging and circuit breakers
- Current QCut panel size defaults (20%, 55%, 25%, 70%, 30%)
- `aiPanelWidth` and `aiPanelMinWidth` properties
- Proper state management with custom size persistence per preset
- Actual editor layout structure (vertical → horizontal split)
- Existing normalization and validation logic

### ⚠️ **Advanced Features from Source (Optional)**
- Enhanced preset selector with `DropdownMenuSeparator`
- Visual active state indicators (colored dot)
- More sophisticated preset size persistence
- Individual preset custom size tracking
- Advanced event propagation handling

### 🔧 **QCut-Specific Considerations**
- Must preserve existing circuit breaker functionality
- Must not interfere with debug logging
- Must respect panel size tolerance and validation
- Must work with current Zustand persistence version 7

## Implementation Checklist

- [ ] Task 1: Panel preset types (3min)
- [ ] Task 2: Preset configurations (5min)  
- [ ] Task 3: Basic preset state management (10min)
- [ ] Task 4: Basic preset selector component (10min)
- [ ] Task 5: Add selector to header (3min)
- [ ] Task 6: Media preset layout (10min)
- [ ] Task 7: Inspector preset layout (8min)
- [ ] Task 8: Vertical preview preset layout (8min)
- [ ] Task 9: Enhanced descriptions (5min)
- [ ] Task 10: Reset functionality (10min)

**Total estimated time**: 72 minutes across 10 tasks

## Safety Guidelines

1. **Test after each task** - Ensure existing panel resizing, debug logging, and circuit breakers still work
2. **Preserve QCut complexity** - Don't simplify existing debug/validation logic
3. **Match current defaults** - Default preset must use exact current panel sizes (20%, 55%, 25%, 70%, 30%)
4. **Respect circuit breakers** - Don't bypass existing update throttling and tolerance checking
5. **Incremental rollout** - Can wrap entire feature behind feature flag: `if (enablePresets)`
6. **Fallback handling** - Always have exact copy of current layout as default case
7. **Persistence compatibility** - Work with existing Zustand version 7 persistence

## QCut-Specific Testing

After each task, test:
- ✅ **Panel resizing works** - Drag panel boundaries
- ✅ **Debug logging works** - Check browser console for panel traces
- ✅ **Circuit breaker active** - Rapid resizing should trigger protection
- ✅ **Normalization works** - Panel percentages should add to 100%
- ✅ **Persistence works** - Refresh browser, sizes should restore
- ✅ **Existing editor features** - Timeline, preview, media panel functionality

## Troubleshooting

**Issue**: Panel sizes don't persist
- **Solution**: Check Zustand persist middleware version 7 compatibility

**Issue**: Circuit breaker triggers constantly
- **Solution**: Ensure preset switching doesn't trigger rapid update detection

**Issue**: Layout breaks on preset switch  
- **Solution**: Ensure `key` prop includes `resetCounter` for forced re-render

**Issue**: Debug logging breaks
- **Solution**: Don't modify `tracePanelUpdate` or debug imports

**Issue**: Normalization fails
- **Solution**: Ensure preset configs total 100% for horizontal panels

**Issue**: TypeScript errors
- **Solution**: Match existing `PanelState` interface structure exactly

**Issue**: UI components missing
- **Solution**: QCut already has Radix UI and Lucide React installed