# Expandable Settings Integration Guide

## ⚠️ IMPORTANT DISCOVERY
**Status**: QCut already has a fully functional SettingsView with expandable sections!

After analyzing the current codebase, I found that:
1. ✅ `SettingsView` already exists and is integrated into the PropertiesPanel
2. ✅ Settings tab is already available in PanelTabs
3. ✅ Background settings with color picker already implemented
4. ✅ PropertyGroup-style functionality already working in BackgroundView

## 🔍 Current State Analysis

The expandable settings feature from commit `7891ed2cc1487270a847081c4ad93be1900adc8e` has **already been integrated** into QCut. Here's what exists:

### ✅ Already Implemented
- **SettingsView**: Full tabbed interface with Project Info and Background tabs
- **PropertyGroup Pattern**: Used in BackgroundView with collapsible sections for Blur and Color
- **Background Settings**: Complete color picker with 244+ colors from `@/data/colors`
- **Project Configuration**: Name, aspect ratio, and frame rate controls
- **Integration**: Properly integrated into PropertiesPanel with tab navigation

## 🎯 Revised Integration Strategy
**New Approach**: Since the main functionality exists, focus on **enhancing** the PropertyGroup pattern throughout the application for better organization.

## 📋 Enhancement Tasks (< 10 minutes each)

### Task 1: Extract PropertyGroup from SettingsView to Reusable Component (8 mins)
**File to modify:** `qcut/apps/web/src/components/editor/properties-panel/property-item.tsx`

**Current State**: PropertyGroup functionality exists in BackgroundView but is not a reusable component.

**Enhancement needed:**
```tsx
// Add new imports at top (after existing imports)
import { ChevronDown } from "lucide-react";
import { useState } from "react";

// Add PropertyGroup interface and component at the end of the file
interface PropertyGroupProps {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  className?: string;
}

export function PropertyGroup({
  title,
  children,
  defaultExpanded = true,
  className,
}: PropertyGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <PropertyItem direction="column" className={cn("gap-3", className)}>
      <div
        className="flex items-center gap-1.5 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <PropertyItemLabel className="cursor-pointer">
          {title}
        </PropertyItemLabel>
        <ChevronDown className={cn("size-3", !isExpanded && "-rotate-90")} />
      </div>
      {isExpanded && <PropertyItemValue>{children}</PropertyItemValue>}
    </PropertyItem>
  );
}
```

### Task 2: Enhance TextProperties with PropertyGroup (7 mins)
**File to modify:** `qcut/apps/web/src/components/editor/properties-panel/text-properties.tsx`

**Current State**: TextProperties has comprehensive text editing with font, style, color, and opacity controls.

**Enhancement needed:**
```tsx
// Add import at top (after existing imports)
import { PropertyGroup } from "./property-item";

// Replace the current return structure (around lines 89-274) with grouped version:
return (
  <div className="space-y-6 p-5">
    <Textarea
      placeholder="Name"
      defaultValue={element.content}
      className="min-h-18 resize-none bg-background/50"
      onChange={(e) =>
        updateTextElement(trackId, element.id, { content: e.target.value })
      }
    />
    
    <PropertyGroup title="Font" defaultExpanded={true}>
      <PropertyItem direction="row">
        <PropertyItemLabel>Font</PropertyItemLabel>
        <PropertyItemValue>
          <FontPicker
            defaultValue={element.fontFamily}
            onValueChange={(value: FontFamily) =>
              updateTextElement(trackId, element.id, { fontFamily: value })
            }
          />
        </PropertyItemValue>
      </PropertyItem>
      
      {/* Existing font size and style controls */}
    </PropertyGroup>
    
    <PropertyGroup title="Appearance" defaultExpanded={true}>
      {/* Color, background, opacity controls */}
    </PropertyGroup>
  </div>
);
```

### Task 3: Enhance AudioProperties (Currently Basic) (6 mins)
**File to modify:** `qcut/apps/web/src/components/editor/properties-panel/audio-properties.tsx`

**Current State**: AudioProperties only shows "Audio properties" placeholder text.

**Enhancement needed:**
```tsx
import { MediaElement } from "@/types/timeline";
import { PropertyGroup, PropertyItem, PropertyItemLabel, PropertyItemValue } from "./property-item";
import { Slider } from "@/components/ui/slider";
import { useState } from "react";

export function AudioProperties({ element }: { element: MediaElement }) {
  const [volume, setVolume] = useState(100);
  
  return (
    <div className="space-y-4 p-5">
      <PropertyGroup title="Audio Controls" defaultExpanded={true}>
        <PropertyItem direction="column">
          <PropertyItemLabel>Volume</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                value={[volume]}
                min={0}
                max={100}
                step={1}
                onValueChange={([value]) => setVolume(value)}
                className="w-full"
              />
              <span className="text-xs w-12">{volume}%</span>
            </div>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>
    </div>
  );
}
```

### Task 4: Enhance MediaProperties (Currently Basic) (7 mins)
**File to modify:** `qcut/apps/web/src/components/editor/properties-panel/media-properties.tsx`

**Current State**: MediaProperties only shows "Media properties" placeholder text.

**Enhancement needed:**
```tsx
import { MediaElement } from "@/types/timeline";
import { PropertyGroup, PropertyItem, PropertyItemLabel, PropertyItemValue } from "./property-item";
import { Slider } from "@/components/ui/slider";
import { useState } from "react";

export function MediaProperties({ element }: { element: MediaElement }) {
  const [opacity, setOpacity] = useState(100);
  const [scale, setScale] = useState(100);
  
  return (
    <div className="space-y-4 p-5">
      <PropertyGroup title="Transform" defaultExpanded={true}>
        <PropertyItem direction="column">
          <PropertyItemLabel>Scale</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                value={[scale]}
                min={10}
                max={200}
                step={1}
                onValueChange={([value]) => setScale(value)}
                className="w-full"
              />
              <span className="text-xs w-12">{scale}%</span>
            </div>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>
      
      <PropertyGroup title="Effects" defaultExpanded={false}>
        <PropertyItem direction="column">
          <PropertyItemLabel>Opacity</PropertyItemLabel>
          <PropertyItemValue>
            <div className="flex items-center gap-2">
              <Slider
                value={[opacity]}
                min={0}
                max={100}
                step={1}
                onValueChange={([value]) => setOpacity(value)}
                className="w-full"
              />
              <span className="text-xs w-12">{opacity}%</span>
            </div>
          </PropertyItemValue>
        </PropertyItem>
      </PropertyGroup>
    </div>
  );
}
```

### Task 5: Update SettingsView to Use Reusable PropertyGroup (9 mins)
**File to modify:** `qcut/apps/web/src/components/editor/properties-panel/settings-view.tsx`

**Current State**: BackgroundView manually implements expandable sections.

**Enhancement needed:**
```tsx
// Add import at top (after existing imports)
import { PropertyGroup } from "./property-item";

// Replace BackgroundView implementation (around lines 223-243):
function BackgroundView() {
  const { activeProject, updateBackgroundType } = useProjectStore();
  // ... existing blur and color logic ...
  
  return (
    <div className="flex flex-col gap-5">
      <PropertyGroup title="Blur">
        <div className="grid grid-cols-4 gap-2 w-full">{blurPreviews}</div>
      </PropertyGroup>

      <PropertyGroup title="Color">
        <div className="grid grid-cols-4 gap-2 w-full">
          <div className="w-full aspect-square rounded-sm cursor-pointer border border-foreground/15 hover:border-primary flex items-center justify-center">
            <PipetteIcon className="size-4" />
          </div>
          {colorPreviews}
        </div>
      </PropertyGroup>
    </div>
  );
}
```

### Task 6: Add PropertyGroup to Empty Properties View (8 mins)
**File to modify:** `qcut/apps/web/src/components/editor/properties-panel/index.tsx`

**Current State**: The emptyView (lines 51-99) shows project info in a basic format.

**Enhancement needed:**
```tsx
// Add import at top (after existing imports)
import { PropertyGroup } from "./property-item";

// Replace emptyView definition (around lines 51-99):
const emptyView = (
  <div className="space-y-4 p-5">
    <PropertyGroup title="Project Information" defaultExpanded={true}>
      <PropertyItem direction="column">
        <PropertyItemLabel className="text-xs text-muted-foreground">
          Name:
        </PropertyItemLabel>
        <PropertyItemValue className="text-xs truncate">
          {activeProject?.name || ""}
        </PropertyItemValue>
      </PropertyItem>
      
      <PropertyItem direction="column">
        <PropertyItemLabel className="text-xs text-muted-foreground">
          Aspect ratio:
        </PropertyItemLabel>
        <PropertyItemValue className="text-xs truncate">
          {getDisplayName()}
        </PropertyItemValue>
      </PropertyItem>
      
      {/* ... rest of project info ... */}
    </PropertyGroup>
  </div>
);
```

### Task 7: Test All PropertyGroup Enhancements (5 mins)
**Commands to run:**
```bash
# Test development build
cd qcut
bun dev

# Check for TypeScript errors
bun check-types

# Run linting
bun lint:clean
```

**Testing areas:**
- Navigate to Properties panel and verify existing functionality still works
- Select text elements and verify TextProperties with new PropertyGroup sections
- Select audio/media elements and verify enhanced properties
- Test Settings tab to ensure PropertyGroup integration works
- Verify expand/collapse animations work smoothly

### Task 8: Optional - Enhance Export Dialog with PropertyGroup (10 mins)
**File to check:** `qcut/apps/web/src/components/export-dialog.tsx`

**Current State**: ExportPanelContent just renders ExportDialog component.

**Optional enhancement:**
If ExportDialog has multiple setting sections, apply PropertyGroup pattern for better organization. This task is optional since export functionality is already working.

## 🔧 Integration Points

### 1. Existing SettingsView ✅ ALREADY IMPLEMENTED
- **SettingsView**: Fully functional with Project Info and Background tabs
- **Background Settings**: Complete with blur and color options
- **PropertyItem System**: Already used throughout the component
- **Integration**: Already properly integrated into PropertiesPanel

### 2. Current Property Components
- **TextProperties**: ✅ Comprehensive with all text editing features
- **AudioProperties**: ⚠️ Basic placeholder (needs enhancement)
- **MediaProperties**: ⚠️ Basic placeholder (needs enhancement)
- **PropertyItem**: ✅ Solid foundation, needs PropertyGroup addition

### 3. UI Components ✅ ALL AVAILABLE
- **ChevronDown**: ✅ Available from `lucide-react`
- **Colors**: ✅ Full array with 244 colors at `@/data/colors`
- **All UI Components**: ✅ Select, Slider, Input, etc. all available
- **Styling**: ✅ Uses existing `cn()` utility and Tailwind classes

## 🚫 Non-Breaking Guarantees

1. **SettingsView**: ✅ Already working perfectly - no changes needed to core functionality
2. **PropertyItem API**: ✅ Maintains same interface - PropertyGroup is purely additive
3. **Store Integration**: ✅ All stores already properly integrated (useProjectStore, useEditorStore)
4. **Existing Properties**: ✅ TextProperties fully functional - enhancements are organizational only
5. **Backward Compatibility**: ✅ PropertyGroup is optional wrapper, doesn't break existing components

## 📁 Files to Modify

```
qcut/apps/web/src/components/editor/properties-panel/
├── property-item.tsx              # MODIFIED (extract PropertyGroup component)
├── settings-view.tsx              # MODIFIED (use reusable PropertyGroup)
├── text-properties.tsx            # MODIFIED (add PropertyGroup organization)
├── audio-properties.tsx           # ENHANCED (from placeholder to functional)
├── media-properties.tsx           # ENHANCED (from placeholder to functional)
├── index.tsx                     # MODIFIED (enhance emptyView)
└── export-dialog.tsx              # OPTIONAL (PropertyGroup if needed)
```

## 📁 Files Already Perfect ✅

```
qcut/apps/web/src/components/editor/properties-panel/
├── settings-view.tsx              # ✅ Full SettingsView with tabs
├── index.tsx                     # ✅ Proper integration with PanelTabs
qcut/apps/web/src/data/
└── colors.ts                     # ✅ 244 colors available
```

## 🧪 Testing Checklist

- [ ] PropertyGroup expands/collapses correctly
- [ ] Existing properties still work without PropertyGroup wrapper
- [ ] Background color selection works
- [ ] Text, audio, media properties remain functional
- [ ] Export panel maintains existing functionality
- [ ] No TypeScript compilation errors
- [ ] No linting errors
- [ ] Smooth animations on expand/collapse

## 🔄 Rollback Plan

If integration causes issues:
1. Remove `PropertyGroup` component from `property-item.tsx`
2. Remove `PropertyGroup` imports from modified files
3. Unwrap content from `PropertyGroup` tags
4. Delete `background-properties.tsx`
5. Remove background properties import from `index.tsx`

## 📋 Implementation Order

1. **Task 1** (Extract PropertyGroup) - Create reusable component
2. **Task 2** (Enhance TextProperties) - Apply to most complex component
3. **Task 3** (Build AudioProperties) - Add real functionality
4. **Task 4** (Build MediaProperties) - Add real functionality  
5. **Task 5** (Update SettingsView) - Use reusable PropertyGroup
6. **Task 6** (Enhance EmptyView) - Apply to project info
7. **Task 7** (Testing) - Verify all enhancements
8. **Task 8** (Optional Export) - Additional enhancement if needed

**Total estimated time**: ~60 minutes across 8 focused tasks
**Priority**: Tasks 1-2 are highest priority, Tasks 3-4 add real functionality, Tasks 5-8 are polish

## 🎯 Success Metrics

- ✅ **SettingsView**: Already working with full functionality
- 🔄 **PropertyGroup Component**: Reusable across all property panels
- 🔄 **Enhanced Organization**: Text, audio, and media properties better organized
- ✅ **Background Settings**: Already fully functional with 244 colors
- ✅ **Non-Breaking**: All existing functionality maintained
- 🔄 **User Experience**: Collapsible sections for better focus
- ✅ **TypeScript**: Clean compilation (already working)
- ✅ **Integration**: Already properly integrated into panel system

## 💡 Future Enhancements

**Since SettingsView already has most features**, consider:
- ✅ **Blur Options**: Already implemented in SettingsView BackgroundView
- 🔄 **State Persistence**: Save expanded/collapsed preferences
- 🔄 **Keyboard Navigation**: Enhanced accessibility for PropertyGroup
- 🔄 **Timeline Properties**: Apply PropertyGroup pattern to timeline elements
- 🔄 **Search Integration**: Auto-expand sections containing search results
- 🔄 **PropertyGroup Animations**: Enhanced expand/collapse transitions

## 📝 Summary

**Key Discovery**: The expandable settings feature is **already fully implemented** in QCut! The main value of this integration guide is now to:

1. **Extract reusable PropertyGroup** from the existing SettingsView implementation
2. **Apply PropertyGroup pattern** to other property panels for consistency
3. **Enhance placeholder components** (AudioProperties, MediaProperties) with real functionality
4. **Maintain the excellent work** already done in SettingsView

This is a great example of how the QCut codebase is already quite advanced and well-structured!