# Project Settings Integration Guide

## Overview
This guide outlines how to integrate the new project settings component into the main QCut application without breaking existing functionality. The settings component provides tabbed interface for project configuration including project info and background settings.

## Implementation Strategy
**Non-breaking approach**: Add settings as a new tab/panel option in the existing PropertiesPanel using the established panel system.

## 📋 Revised Implementation Subtasks (< 10 minutes each)

### Task 1: Add Settings to Panel Types (2 mins)
**Files to modify:**
- `qcut/apps/web/src/types/panel.ts`

```tsx
export const PanelView = {
  PROPERTIES: "properties",
  EXPORT: "export",
  SETTINGS: "settings", // Add this line
} as const;
```

### Task 2: Update Export Store Panel View Type (3 mins)
**Files to modify:**  
- `qcut/apps/web/src/stores/export-store.ts`

```tsx
// Change line 27 from:
panelView: "properties" | "export";

// To:
panelView: "properties" | "export" | "settings";

// Change line 43 from:
setPanelView: (view: "properties" | "export") => void;

// To:
setPanelView: (view: "properties" | "export" | "settings") => void;
```

### Task 3: Add Settings Tab to PanelTabs (4 mins)
**Files to modify:**
- `qcut/apps/web/src/components/editor/properties-panel/panel-tabs.tsx`

```tsx
// Add after the Export button (around line 48):
<button
  type="button"
  onClick={() => onTabChange(PanelView.SETTINGS)}
  className={cn(
    "px-3 py-2 text-sm font-medium border-b-2 transition-colors",
    activeTab === PanelView.SETTINGS
      ? "border-primary text-primary"
      : "border-transparent text-muted-foreground hover:text-foreground"
  )}
>
  Settings
</button>
```

### Task 4: Create Settings Component (8 mins)
**Files to create:**
- `qcut/apps/web/src/components/editor/properties-panel/settings-view.tsx`

```tsx
"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PropertyItem,
  PropertyItemLabel,
  PropertyItemValue,
} from "./property-item";
import { FPS_PRESETS } from "@/constants/timeline-constants";
import { useProjectStore } from "@/stores/project-store";
import { useEditorStore } from "@/stores/editor-store";
import { useAspectRatio } from "@/hooks/use-aspect-ratio";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { colors } from "@/data/colors";
import { PipetteIcon } from "lucide-react";
import { useMemo, memo, useCallback } from "react";

export function SettingsView() {
  return <ProjectSettingsTabs />;
}

// Copy full implementation from prototype settings.tsx
// ProjectSettingsTabs, ProjectInfoView, BlurPreview, BackgroundView functions
```

### Task 5: Update PropertiesPanel Router (5 mins)
**Files to modify:**
- `qcut/apps/web/src/components/editor/properties-panel/index.tsx`

```tsx
// Add import at top:
import { SettingsView } from "./settings-view";
import { PanelView } from "@/types/panel";

// Update the conditional rendering around line 134-136:
{panelView === PanelView.EXPORT ? (
  <ExportPanelContent />
) : panelView === PanelView.SETTINGS ? (
  <SettingsView />
) : (
  // existing properties content...
)}
```

### Task 6: Test Integration (8 mins)
**Commands to run:**
```bash
# Test development build
bun dev

# Check for TypeScript errors  
bun check-types

# Run linting
bun lint:clean
```

## 🔧 Key Integration Points

### 1. Properties Panel Architecture ✅ VERIFIED
**Current**: `PropertiesPanel` → `PanelTabs` → `ExportPanelContent` | Properties
**New**: `PropertiesPanel` → `PanelTabs` → `SettingsView` | `ExportPanelContent` | Properties

### 2. Store Dependencies ✅ VERIFIED
- **useProjectStore**: ✅ Available for project data and FPS updates
- **useEditorStore**: ✅ Available for canvas size and presets  
- **useAspectRatio**: ✅ Available for aspect ratio management

### 3. UI Components Used ✅ VERIFIED
All required UI components already exist in the codebase:
- `Select`, `Tabs`, `ScrollArea`, `Separator` from `@/components/ui/*`
- `PropertyItem` components from `./property-item`

### 4. Colors Data ✅ ALREADY EXISTS
- `colors` array is already available at `@/data/colors` with 244 color options

## 📁 File Structure After Integration

```
qcut/apps/web/src/components/editor/properties-panel/
├── index.tsx                    # Main PropertiesPanel (MODIFIED)
├── panel-tabs.tsx              # Tab navigation (MODIFIED)  
├── settings-view.tsx           # New settings component (NEW)
├── property-item.tsx           # Existing property components
├── audio-properties.tsx        # Existing audio properties
├── media-properties.tsx        # Existing media properties
├── text-properties.tsx         # Existing text properties
└── export-panel-content.tsx    # Existing export panel

qcut/apps/web/src/data/
└── colors.ts                   # Color constants (✅ EXISTS)

qcut/apps/web/src/stores/
└── export-store.ts             # Panel view types (MODIFIED)

qcut/apps/web/src/types/
└── panel.ts                    # Panel types (MODIFIED)
```

## 🚫 Non-Breaking Guarantees ✅ VERIFIED

1. **Existing tabs remain unchanged**: Properties and Export panels work as before
2. **Store compatibility**: Uses existing store methods, no new store methods required  
3. **Component isolation**: Settings component is self-contained with no side effects
4. **Conditional rendering**: Settings only renders when explicitly selected
5. **Fallback behavior**: If settings fails, other tabs continue to work
6. **Type safety**: Uses established `PanelView` constants instead of magic strings

## 🧪 Testing Checklist

- [ ] All existing properties panel tabs still work
- [ ] Project settings tab renders without errors  
- [ ] FPS changes update project correctly
- [ ] Aspect ratio changes work properly
- [ ] Background blur/color changes work
- [ ] TypeScript compilation passes
- [ ] Linting passes
- [ ] No console errors in development

## 🔄 Rollback Plan

If integration causes issues:
1. Remove `SETTINGS` from `PanelView` object in `types/panel.ts`
2. Remove "settings" from export-store.ts types  
3. Remove settings tab from panel-tabs.tsx
4. Remove settings case from PropertiesPanel render method
5. Remove `settings-view.tsx`

## 📋 Implementation Order ✅ REVISED

1. **Task 1** (Panel types) - Foundation, no dependencies
2. **Task 2** (Export store types) - Type definitions
3. **Task 3** (Panel tabs UI) - Navigation component
4. **Task 4** (Settings component) - Core functionality  
5. **Task 5** (Properties router) - Integration logic
6. **Task 6** (Testing) - Verification

**Total estimated time**: ~30 minutes across 6 focused subtasks

## 🎯 Success Metrics

- Settings panel loads without breaking existing functionality
- All project configuration options work correctly
- Clean TypeScript compilation  
- Zero linting errors
- Smooth user experience transitioning between tabs
- Background settings work identically to existing BackgroundSettings component