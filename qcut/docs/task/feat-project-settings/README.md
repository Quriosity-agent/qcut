# Project Settings Feature Files

This folder contains the actual implementation files for the project settings feature from commit `dd09bf2949b63d17b3e7311a688d7d84c5d6dc52`.

## Files Included

### 1. `index.tsx` 
**Source:** `apps/web/src/components/editor/media-panel/index.tsx`  
**Status:** Modified  
**Purpose:** Main media panel component that includes the new settings tab

**Key Changes:**
- Added import for `SettingsView` component
- Added "settings" entry to the `viewMap` with `<SettingsView />` component
- Enables settings tab in the media panel navigation

### 2. `store.ts`
**Source:** `apps/web/src/components/editor/media-panel/store.ts`  
**Status:** Modified  
**Purpose:** Media panel state management and tab definitions

**Key Changes:**
- Extended `Tab` type union to include "settings"
- Added settings tab configuration with `SettingsIcon` and "Settings" label
- Maintains type safety for the new settings tab

### 3. `settings.tsx`
**Source:** `apps/web/src/components/editor/media-panel/views/settings.tsx`  
**Status:** Created (New File)  
**Purpose:** Complete settings view implementation

**Features:**
- Tabbed interface with "Project info" and "Background" sections
- Project metadata configuration (name, aspect ratio, frame rate)
- Background and visual settings
- Integration with project and editor stores
- Responsive UI with proper styling

## Implementation Overview

### Component Hierarchy
```
SettingsView
└── ProjectSettingsTabs
    ├── Project info tab
    │   └── ProjectInfoView
    └── Background tab
        └── BackgroundView
```

### Dependencies
- UI Components: Select, Tabs, ScrollArea, Separator
- Stores: useProjectStore, useEditorStore
- Hooks: useAspectRatio
- Constants: FPS_PRESETS
- Utilities: cn (class name utility)

### Integration Points
- Media panel tab system
- Project state management
- Editor configuration
- Aspect ratio handling

## Usage

The settings view provides:
1. **Project Information**
   - Project name editing
   - Aspect ratio selection (16:9, 9:16, 1:1, 4:3)
   - Frame rate configuration (24fps, 30fps, 60fps)

2. **Background Settings**
   - Background color selection
   - Blur effects configuration
   - Visual customization options

## Development Notes

### File Structure
These files represent the core implementation of the project settings feature:
- `index.tsx`: Integration point with existing media panel
- `store.ts`: Type definitions and state management
- `settings.tsx`: Complete UI implementation

### Design Patterns
- Uses existing UI component library
- Follows established state management patterns
- Maintains consistency with other media panel views
- Implements proper TypeScript typing

## Documentation

For detailed analysis of this feature implementation, see:
- `commit-dd09bf29.md` - Comprehensive commit analysis

## Original Commit

**Repository:** [OpenCut-app/OpenCut](https://github.com/OpenCut-app/OpenCut)  
**Commit:** `dd09bf2949b63d17b3e7311a688d7d84c5d6dc52`  
**Message:** "feat: add project settings"  
**Date:** From OpenCut-app repository

---

*Files fetched on: 2025-08-19*