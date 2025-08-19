# Expandable Settings Integration Guide

## Overview
This guide outlines how to integrate the expandable settings functionality from commit `7891ed2cc1487270a847081c4ad93be1900adc8e` into the current QCut application without breaking existing features.

## 🎯 Integration Strategy
**Approach**: Enhance existing PropertyItem components by adding the PropertyGroup functionality while maintaining backward compatibility.

## 📋 Implementation Tasks (< 10 minutes each)

### Task 1: Add PropertyGroup to Existing PropertyItem Component (8 mins)
**File to modify:** `qcut/apps/web/src/components/editor/properties-panel/property-item.tsx`

**Changes needed:**
```tsx
// Add new imports at top
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

### Task 2: Test PropertyGroup Component (5 mins)
**File to modify:** `qcut/apps/web/src/components/editor/properties-panel/text-properties.tsx`

**Test integration by wrapping existing font settings:**
```tsx
// Add import at top
import { PropertyGroup } from "./property-item";

// Wrap the font-related properties (around lines 50-70) with PropertyGroup
<PropertyGroup title="Font Settings" defaultExpanded={true}>
  {/* Existing font family, size, weight properties */}
  <PropertyItem direction="column">
    <PropertyItemLabel>Font family</PropertyItemLabel>
    {/* ... existing font family content */}
  </PropertyItem>
  
  <PropertyItem direction="column">
    <PropertyItemLabel>Font size</PropertyItemLabel>
    {/* ... existing font size content */}
  </PropertyItem>
  
  {/* ... other font properties */}
</PropertyGroup>
```

### Task 3: Add PropertyGroup to Audio Properties (6 mins)
**File to modify:** `qcut/apps/web/src/components/editor/properties-panel/audio-properties.tsx`

**Group audio effects:**
```tsx
// Add import at top
import { PropertyGroup } from "./property-item";

// Wrap audio effect properties with PropertyGroup
<PropertyGroup title="Audio Effects" defaultExpanded={false}>
  {/* Existing volume, fade controls */}
  <PropertyItem direction="column">
    <PropertyItemLabel>Volume</PropertyItemLabel>
    {/* ... existing volume slider */}
  </PropertyItem>
  
  {/* ... other audio properties */}
</PropertyGroup>
```

### Task 4: Add PropertyGroup to Media Properties (7 mins)
**File to modify:** `qcut/apps/web/src/components/editor/properties-panel/media-properties.tsx`

**Group video effects and transforms:**
```tsx
// Add import at top
import { PropertyGroup } from "./property-item";

// Group transform properties
<PropertyGroup title="Transform" defaultExpanded={true}>
  {/* Position, scale, rotation properties */}
</PropertyGroup>

<PropertyGroup title="Effects" defaultExpanded={false}>
  {/* Opacity, blur, filters */}
</PropertyGroup>
```

### Task 5: Enhance Existing Settings with PropertyGroup (9 mins)
**File to modify:** `qcut/apps/web/src/components/editor/properties-panel/export-panel-content.tsx`

**Group export settings:**
```tsx
// Add import at top
import { PropertyGroup } from "./property-item";

// Group export format settings
<PropertyGroup title="Format Settings" defaultExpanded={true}>
  {/* Quality, format, resolution options */}
</PropertyGroup>

<PropertyGroup title="Advanced Options" defaultExpanded={false}>
  {/* Advanced export settings */}
</PropertyGroup>
```

### Task 6: Add Background Settings to Properties Panel (8 mins)
**File to create:** `qcut/apps/web/src/components/editor/properties-panel/background-properties.tsx`

**Create new background settings component:**
```tsx
"use client";

import { PropertyGroup, PropertyItem, PropertyItemLabel, PropertyItemValue } from "./property-item";
import { useProjectStore } from "@/stores/project-store";
import { colors } from "@/data/colors";
import { cn } from "@/lib/utils";
import { PipetteIcon } from "lucide-react";
import { useMemo, useCallback } from "react";

export function BackgroundProperties() {
  const { activeProject, updateBackgroundType } = useProjectStore();

  const handleColorSelect = useCallback(
    async (color: string) => {
      await updateBackgroundType("color", { backgroundColor: color });
    },
    [updateBackgroundType]
  );

  const currentBackgroundColor = activeProject?.backgroundColor || "#000000";
  const isColorBackground = activeProject?.backgroundType === "color";

  const colorPreviews = useMemo(
    () =>
      colors.slice(0, 12).map((color) => ( // Limit to 12 colors for properties panel
        <div
          key={color}
          className={cn(
            "w-6 h-6 rounded-sm cursor-pointer hover:border-2 hover:border-primary",
            isColorBackground &&
              color === currentBackgroundColor &&
              "border-2 border-primary"
          )}
          style={{ backgroundColor: color }}
          onClick={() => handleColorSelect(color)}
        />
      )),
    [isColorBackground, currentBackgroundColor, handleColorSelect]
  );

  return (
    <PropertyGroup title="Background" defaultExpanded={false}>
      <PropertyItem direction="column">
        <PropertyItemLabel>Background Color</PropertyItemLabel>
        <PropertyItemValue>
          <div className="flex flex-wrap gap-2">
            <div className="w-6 h-6 rounded-sm cursor-pointer border border-foreground/15 hover:border-primary flex items-center justify-center">
              <PipetteIcon className="size-3" />
            </div>
            {colorPreviews}
          </div>
        </PropertyItemValue>
      </PropertyItem>
    </PropertyGroup>
  );
}
```

### Task 7: Integrate Background Properties (4 mins)
**File to modify:** `qcut/apps/web/src/components/editor/properties-panel/index.tsx`

**Add background properties to main properties panel:**
```tsx
// Add import at top
import { BackgroundProperties } from "./background-properties";

// Add BackgroundProperties component in the main properties rendering section
// (around line 140, after existing property components)
<BackgroundProperties />
```

### Task 8: Test Integration and Fix Issues (10 mins)
**Commands to run:**
```bash
# Test development build
cd qcut
bun dev

# Check for TypeScript errors
bun check-types

# Run linting
bun lint:clean

# Test specific components
# Navigate to editor and verify expandable sections work
```

## 🔧 Integration Points

### 1. Existing Property System ✅
- **Reuses**: Existing `PropertyItem`, `PropertyItemLabel`, `PropertyItemValue` components
- **Extends**: Adds `PropertyGroup` wrapper component
- **Maintains**: Backward compatibility with all existing properties

### 2. Store Dependencies ✅
- **useProjectStore**: Already available for background settings
- **Existing stores**: No modifications needed to current store structure

### 3. UI Components ✅
- **ChevronDown**: Available from `lucide-react` (already used in codebase)
- **Colors**: Reuses existing `@/data/colors` array
- **Styling**: Uses existing `cn()` utility and Tailwind classes

## 🚫 Non-Breaking Guarantees

1. **Existing Properties**: All current property panels continue to work unchanged
2. **Component API**: PropertyItem components maintain same interface
3. **State Management**: No changes to existing store methods
4. **Conditional Enhancement**: PropertyGroup is additive, not replacing existing functionality
5. **Gradual Adoption**: Can be applied incrementally to different property sections

## 📁 Files Modified

```
qcut/apps/web/src/components/editor/properties-panel/
├── property-item.tsx              # MODIFIED (adds PropertyGroup)
├── text-properties.tsx            # MODIFIED (test integration)
├── audio-properties.tsx           # MODIFIED (group audio effects)
├── media-properties.tsx           # MODIFIED (group video effects)
├── export-panel-content.tsx       # MODIFIED (group export settings)
├── background-properties.tsx      # NEW (background color picker)
└── index.tsx                     # MODIFIED (add background properties)
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

1. **Task 1** (PropertyGroup component) - Core functionality
2. **Task 2** (Test in text properties) - Verify basic functionality
3. **Tasks 3-5** (Apply to other properties) - Gradual enhancement
4. **Task 6** (Background properties) - New feature addition
5. **Task 7** (Integration) - Final connection
6. **Task 8** (Testing) - Verification and fixes

**Total estimated time**: ~57 minutes across 8 focused tasks

## 🎯 Success Metrics

- Expandable sections work smoothly in properties panel
- All existing functionality remains intact
- Background color picker provides additional functionality
- Clean TypeScript compilation
- Zero linting errors
- Enhanced organization without breaking changes
- User can collapse sections they don't actively use

## 💡 Future Enhancements

After successful integration:
- Add state persistence for expanded/collapsed preferences
- Implement keyboard navigation for accessibility
- Add search functionality that auto-expands relevant sections
- Consider adding PropertyGroup to timeline properties
- Extend background settings with blur options (following full settings.tsx pattern)