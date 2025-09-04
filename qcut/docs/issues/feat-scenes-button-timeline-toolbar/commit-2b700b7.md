# Integration Plan: Scenes Button to Timeline Toolbar

**Source Commit:** `2b700b7474ffc728f5318c178244e035c93716b5`  
**Feature:** Add scenes button to timeline toolbar using split-button component  

## Analysis Summary

After analyzing the source commit and current codebase, here's the integration strategy:

## Current Codebase Structure

### **Timeline Architecture in Our Repo:**
- **Main File:** `qcut/apps/web/src/components/editor/timeline/index.tsx`
- **Timeline Toolbar:** Embedded as `TimelineToolbar` function within `index.tsx` (lines ~1000+)
- **No separate:** `timeline-toolbar.tsx` file exists (integrated approach)

### **Missing Components:**
- **Split Button:** No `qcut/apps/web/src/components/ui/split-button.tsx` exists
- **LayersIcon:** Already imported in `index.tsx` (line 24: `Sticker` - need to add `LayersIcon`)

## Integration Plan

### Phase 1: Create Split-Button Component ✅ READY TO IMPLEMENT
**Source:** `docs/issues/feat-scenes-button-timeline-toolbar/split-button.tsx`  
**Target:** `qcut/apps/web/src/components/ui/split-button.tsx`  

**Dependencies Check:**
- ✅ `@/components/ui/button` - exists
- ✅ `@/components/ui/separator` - exists  
- ✅ `@/lib/utils` (cn function) - exists
- ✅ `ReactNode, forwardRef` from react - standard

**Action:** Direct copy with minimal modifications needed.

### Phase 2: Update Timeline Toolbar ✅ READY TO IMPLEMENT  
**Source:** Lines 358-366 from `docs/issues/feat-scenes-button-timeline-toolbar/timeline-toolbar.tsx`  
**Target:** `qcut/apps/web/src/components/editor/timeline/index.tsx` TimelineToolbar function

**Required Changes:**
1. **Add imports:**
   ```typescript
   // Add LayersIcon to existing lucide-react import (line ~24)
   import { ..., LayersIcon } from "lucide-react";
   
   // Add new import for split-button components
   import {
     SplitButton,
     SplitButtonLeft, 
     SplitButtonRight,
     SplitButtonSeparator,
   } from "@/components/ui/split-button";
   ```

2. **Add scenes button to toolbar:**
   Insert between existing middle section and right section in `TimelineToolbar` return statement:
   ```typescript
   // Around line where the middle div should be added
   <div>
     <SplitButton>
       <SplitButtonLeft>Main scene</SplitButtonLeft>
       <SplitButtonSeparator />
       <SplitButtonRight onClick={() => {}}>
         <LayersIcon />
       </SplitButtonRight>
     </SplitButton>
   </div>
   ```

## File Path Mapping

| Source (From Commit) | Current Repo Target | Status |
|---------------------|--------------------|---------| 
| `apps/web/src/components/ui/split-button.tsx` | `qcut/apps/web/src/components/ui/split-button.tsx` | ✅ Create New |
| `apps/web/src/components/editor/timeline/timeline-toolbar.tsx` (lines 358-366) | `qcut/apps/web/src/components/editor/timeline/index.tsx` (TimelineToolbar function) | ✅ Integrate |

## Code Reusability Assessment

### ✅ **Highly Reusable:**
- **Split-Button Component:** 100% reusable - clean, dependency-compliant component
- **Scenes Button JSX:** 95% reusable - only needs onClick handler implementation

### ⚠️ **Minor Adaptations Needed:**
- **Import path adjustment:** Already using `@/` aliases (compatible)
- **Icon import:** Add `LayersIcon` to existing lucide-react import 
- **Layout integration:** Insert in correct position within existing TimelineToolbar

## Implementation Steps

1. **Create split-button component** from fetched reference
2. **Update timeline imports** to include LayersIcon and split-button components  
3. **Add scenes button JSX** to TimelineToolbar function
4. **Implement scenes functionality** (onClick handler - future scope)
5. **Test integration** with existing timeline functionality

## Risk Assessment

- **Low Risk:** Split-button is self-contained with standard dependencies
- **Low Risk:** Timeline modification is additive (non-breaking)
- **Medium Risk:** Need to ensure proper positioning doesn't break responsive layout

## Next Actions

Ready to proceed with implementation using the fetched reference files as templates.