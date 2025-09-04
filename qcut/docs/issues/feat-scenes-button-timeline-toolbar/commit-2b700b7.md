# Commit: feat: scenes button to timeline toolbar

**Commit Hash:** `2b700b7474ffc728f5318c178244e035c93716b5`  
**Message:** feat: scenes button to timeline toolbar  
**Date:** From OpenCut repository  

## Files Changed

### 1. Modified File: `apps/web/src/components/editor/timeline/timeline-toolbar.tsx`
- **Status:** Modified
- **Changes:** Significant restructuring with integration of scenes button functionality
- **Impact:** Enhanced timeline toolbar with new scenes detection capabilities

### 2. Added File: `apps/web/src/components/ui/split-button.tsx`
- **Status:** New file
- **Purpose:** New reusable split-button UI component
- **Usage:** Likely used for the scenes button implementation in timeline toolbar

## Code Changes Summary

**Lines Changed:**
- **Added:** 509 lines
- **Deleted:** 411 lines
- **Net Change:** +98 lines

## Description

This commit introduces a scenes detection button to the timeline toolbar, implementing it using a newly created split-button component. The changes include:

1. **New Split-Button Component**: A reusable UI component (`split-button.tsx`) that provides enhanced button functionality with dropdown or split behavior.

2. **Timeline Toolbar Enhancement**: Substantial modifications to the timeline toolbar component to integrate the new scenes button functionality.

3. **User Interface Improvement**: The addition allows users to access scenes detection features directly from the timeline toolbar, improving workflow efficiency.

## Implementation Details

The significant line changes (509 added, 411 deleted) suggest a comprehensive refactor of the timeline toolbar component structure, likely involving:
- Integration of the new split-button component
- Addition of scenes detection logic or UI elements
- Potential restructuring of existing toolbar elements
- Enhanced user interaction patterns

## Related Components

- `timeline-toolbar.tsx` - Main component receiving the enhancement
- `split-button.tsx` - New utility component for advanced button interactions
- Timeline ecosystem - Overall improvement to video editing workflow

---

**Note:** This commit represents a feature enhancement focused on improving the timeline editing experience through better scene detection accessibility.