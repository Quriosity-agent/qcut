# Bug: Effects Track Shown by Default in Timeline

## Issue Description

The "Effects" track is currently visible by default in the timeline, which takes up unnecessary vertical space when no effects are applied to the timeline.

## Current Behavior

- Effects track is always visible in the timeline
- Shows as an empty purple-labeled track even when no effects are present
- Takes up vertical space in the timeline view

## Expected Behavior

- Effects track should be hidden by default
- Should only appear when:
  - User adds an effect to the timeline, OR
  - User manually toggles to show the effects track

## Screenshot

![Effects Track Visible](c:\Downloads\Screenshots\2025-10\electron_338CTDOxZP.png)

The screenshot shows the empty "Effects" track visible below the video track.

## Impact

- Reduces available vertical space in timeline
- Clutters the UI when effects are not in use
- Poor user experience for users who don't use effects frequently

## Proposed Solution

1. Hide effects track by default
2. Add toggle button/option to show/hide effects track
3. Automatically show effects track when an effect is added
4. Persist user preference for effects track visibility

## Branch

`bug-fix`

## Relevant Files

### Timeline Component
- **`apps/web/src/components/editor/timeline/index.tsx`**
  - Lines 875-885: Effects track label rendering in left sidebar
  - Lines 1007-1023: Effects timeline visualization in tracks area
  - Line 69: Imports `EFFECTS_ENABLED` from features config
  - Both sections controlled by `EFFECTS_ENABLED && tracks.length > 0` condition

### Effects Timeline Component
- **`apps/web/src/components/editor/timeline/effects-timeline.tsx`**
  - Entire file (109 lines): Renders effect visualization bars
  - Shows colored bars for each effect applied to timeline elements
  - Only renders bars for elements with effects (`effects.length === 0` returns null)

### Feature Configuration
- **`apps/web/src/config/features.ts`**
  - Line 5-10: `VIDEO_EFFECTS` feature flag definition (currently enabled: true)
  - Line 50: `EFFECTS_ENABLED` export used throughout the app
  - Supports localStorage overrides for testing

### State Management
- **`apps/web/src/stores/timeline-store.ts`**
  - Will need to add: `showEffectsTrack` boolean state
  - Will need to add: `toggleEffectsTrack()` action

- **`apps/web/src/stores/effects-store.ts`**
  - May need to check: Logic that determines if any effects exist

## Implementation Subtasks

### 1. Add State Management (Timeline Store)
**File**: `apps/web/src/stores/timeline-store.ts`

- [ ] Add `showEffectsTrack: boolean` state property (default: false)
- [ ] Add `toggleEffectsTrack: () => void` action
- [ ] Add `autoShowEffectsTrack: () => void` helper to show track when effects are added
- [ ] Persist `showEffectsTrack` preference to localStorage

#### Step 1.1: Update TimelineStore Interface (around line 55-76)

**Add to interface** after `rippleEditingEnabled` property (around line 76):

```typescript
  /** Whether the effects track is visible in the timeline */
  showEffectsTrack: boolean;
  /** Toggle effects track visibility */
  toggleEffectsTrack: () => void;
  /** Automatically show effects track (called when effects are applied) */
  autoShowEffectsTrack: () => void;
```

#### Step 1.2: Initialize State (around line 402-411)

**Modify the return object** after `snappingEnabled: true,` (around line 411):

```typescript
    // Snapping settings defaults
    snappingEnabled: true,

    // Effects track visibility - load from localStorage, default to false
    showEffectsTrack: typeof window !== 'undefined'
      ? localStorage.getItem('timeline-showEffectsTrack') === 'true'
      : false,
```

#### Step 1.3: Add Toggle Action (add after toggleRippleEditing, around line 450+)

**Add new function** after the `toggleRippleEditing` implementation:

```typescript
    toggleEffectsTrack: () => {
      const { showEffectsTrack } = get();
      const newValue = !showEffectsTrack;
      set({ showEffectsTrack: newValue });

      // Persist to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem('timeline-showEffectsTrack', String(newValue));
      }
    },

    autoShowEffectsTrack: () => {
      const { showEffectsTrack } = get();
      if (!showEffectsTrack) {
        set({ showEffectsTrack: true });

        // Persist to localStorage
        if (typeof window !== 'undefined') {
          localStorage.setItem('timeline-showEffectsTrack', 'true');
        }
      }
    },
```

**Estimated time**: 30 minutes

### 2. Update Timeline Component Logic
**File**: `apps/web/src/components/editor/timeline/index.tsx`

- [ ] Import `showEffectsTrack` and `toggleEffectsTrack` from timeline store
- [ ] Update condition on line 876 from:
  ```tsx
  {EFFECTS_ENABLED && tracks.length > 0 && (
  ```
  to:
  ```tsx
  {EFFECTS_ENABLED && tracks.length > 0 && showEffectsTrack && (
  ```
- [ ] Update condition on line 1008 similarly
- [ ] Add logic to auto-show effects track when effects exist (check effects store)

#### Step 2.1: Add showEffectsTrack to Timeline Component (around line 90-98)

**Add** after the `toggleRippleEditing` selector (look for similar lines around 90-98):

```typescript
  const showEffectsTrack = useTimelineStore((s) => s.showEffectsTrack);
```

#### Step 2.2: Update Effects Track Label Condition (line 876)

**Find this code** (around line 875-885):

```tsx
                  {/* Effects Track Label */}
                  {EFFECTS_ENABLED && tracks.length > 0 && (
                    <div
                      className="flex items-center px-3 border-t-2 border-purple-500/30 group bg-purple-500/10"
                      style={{ height: "64px" }}
                    >
```

**Replace with**:

```tsx
                  {/* Effects Track Label */}
                  {EFFECTS_ENABLED && tracks.length > 0 && showEffectsTrack && (
                    <div
                      className="flex items-center px-3 border-t-2 border-purple-500/30 group bg-purple-500/10"
                      style={{ height: "64px" }}
                    >
```

#### Step 2.3: Update Effects Timeline Visualization Condition (line 1008)

**Find this code** (around line 1007-1023):

```tsx
                    {/* Effects Timeline Visualization */}
                    {EFFECTS_ENABLED && tracks.length > 0 && (
                      <div
                        className="absolute left-0 right-0 border-t-2 border-purple-500/30"
                        style={{
                          top: `${getTotalTracksHeight(tracks)}px`,
                          height: `${TIMELINE_CONSTANTS.TRACK_HEIGHT}px`,
                        }}
                      >
```

**Replace with**:

```tsx
                    {/* Effects Timeline Visualization */}
                    {EFFECTS_ENABLED && tracks.length > 0 && showEffectsTrack && (
                      <div
                        className="absolute left-0 right-0 border-t-2 border-purple-500/30"
                        style={{
                          top: `${getTotalTracksHeight(tracks)}px`,
                          height: `${TIMELINE_CONSTANTS.TRACK_HEIGHT}px`,
                        }}
                      >
```

#### Step 2.4: Update Timeline Height Calculation (line 924-932)

**Find this code** (around line 922-934):

```tsx
                style={{
                  height: `${Math.max(
                    200,
                    Math.min(
                      800,
                      getTotalTracksHeight(tracks) +
                        (EFFECTS_ENABLED && tracks.length > 0
                          ? TIMELINE_CONSTANTS.TRACK_HEIGHT
                          : 0)
                    )
                  )}px`,
                  width: `${dynamicTimelineWidth}px`,
                }}
```

**Replace with**:

```tsx
                style={{
                  height: `${Math.max(
                    200,
                    Math.min(
                      800,
                      getTotalTracksHeight(tracks) +
                        (EFFECTS_ENABLED && tracks.length > 0 && showEffectsTrack
                          ? TIMELINE_CONSTANTS.TRACK_HEIGHT
                          : 0)
                    )
                  )}px`,
                  width: `${dynamicTimelineWidth}px`,
                }}
```

**Estimated time**: 20 minutes

### 3. Add Toggle Button to Timeline Toolbar
**File**: `apps/web/src/components/editor/timeline/index.tsx` (TimelineToolbar function)

- [ ] Add toggle button in toolbar (around line 1476 near Magnet/Link buttons)
- [ ] Use an appropriate icon (e.g., `Sparkles` or `Wand2` from lucide-react)
- [ ] Add tooltip explaining "Show/Hide Effects Track"
- [ ] Highlight button when effects track is visible (similar to snapping toggle)
- [ ] Add conditional rendering: only show toggle when `EFFECTS_ENABLED === true`

#### Step 3.1: Import Sparkles Icon (line 7-27)

**Find the imports section** and add `Sparkles` to the lucide-react import:

```typescript
import {
  Scissors,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
  Snowflake,
  Copy,
  SplitSquareHorizontal,
  Pause,
  Play,
  Video,
  Music,
  TypeIcon,
  Magnet,
  Link,
  ZoomIn,
  ZoomOut,
  Bookmark,
  Sticker,
  LayersIcon,
  Sparkles,  // ADD THIS LINE
} from "lucide-react";
```

#### Step 3.2: Add State Selectors to TimelineToolbar (around line 1061-1090)

**Add** after the `rippleEditingEnabled` and `toggleRippleEditing` selectors:

```typescript
  const showEffectsTrack = useTimelineStore((s) => s.showEffectsTrack);
  const toggleEffectsTrack = useTimelineStore((s) => s.toggleEffectsTrack);
```

#### Step 3.3: Add Toggle Button (around line 1446-1477)

**Find this code** (the section with Magnet and Link buttons around line 1446-1477):

```tsx
      <div className="flex items-center gap-1">
        <TooltipProvider delayDuration={500}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon" onClick={toggleSnapping}>
                {snappingEnabled ? (
                  <Magnet className="h-4 w-4 text-primary" />
                ) : (
                  <Magnet className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Auto snapping</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="text" size="icon" onClick={toggleRippleEditing}>
                <Link
                  className={`h-4 w-4 ${
                    rippleEditingEnabled ? "text-primary" : ""
                  }`}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {rippleEditingEnabled
                ? "Disable Ripple Editing"
                : "Enable Ripple Editing"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
```

**Add AFTER the ripple editing tooltip** (before the closing `</TooltipProvider>`):

```tsx
          {EFFECTS_ENABLED && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="text" size="icon" onClick={toggleEffectsTrack}>
                  <Sparkles
                    className={`h-4 w-4 ${
                      showEffectsTrack ? "text-primary" : ""
                    }`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {showEffectsTrack
                  ? "Hide Effects Track"
                  : "Show Effects Track"}
              </TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>
```

**Estimated time**: 30 minutes

### 4. Auto-Show Logic for Effects
**File**: `apps/web/src/components/editor/media-panel/views/effects.tsx`

- [ ] When user adds an effect via the effects panel, automatically call `autoShowEffectsTrack()`
- [ ] Import `autoShowEffectsTrack` from timeline store
- [ ] Call it in the `handleApplyEffect` function
- [ ] Consider: Should track hide when last effect is removed? (Answer: No, respect user preference)

#### Step 4.1: Import autoShowEffectsTrack (line 3)

**Find the import** for `useTimelineStore` (around line 3):

```typescript
import { useTimelineStore } from "@/stores/timeline-store";
```

**Leave as-is** (we'll get `autoShowEffectsTrack` via the store in the component).

#### Step 4.2: Update EffectsView Component (around line 11-14)

**Find this code**:

```typescript
export default function EffectsView() {
  const { presets, selectedCategory, setSelectedCategory, applyEffect } =
    useEffectsStore();
  const { selectedElements } = useTimelineStore();
```

**Replace with**:

```typescript
export default function EffectsView() {
  const { presets, selectedCategory, setSelectedCategory, applyEffect } =
    useEffectsStore();
  const { selectedElements, autoShowEffectsTrack } = useTimelineStore();
```

#### Step 4.3: Update handleApplyEffect Function (around line 37-53)

**Find this code**:

```typescript
  const handleApplyEffect = (
    preset: EffectPreset & { isImplemented?: boolean }
  ) => {
    // Check if effect is implemented
    if (preset.isImplemented === false) {
      toast.info(`${preset.name} effect is coming soon!`);
      return;
    }

    // Get selected element from timeline store
    const selectedElementId = selectedElements[0]?.elementId;
    if (selectedElementId) {
      applyEffect(selectedElementId, preset);
      toast.success(`Applied ${preset.name} effect`);
```

**Replace with**:

```typescript
  const handleApplyEffect = (
    preset: EffectPreset & { isImplemented?: boolean }
  ) => {
    // Check if effect is implemented
    if (preset.isImplemented === false) {
      toast.info(`${preset.name} effect is coming soon!`);
      return;
    }

    // Get selected element from timeline store
    const selectedElementId = selectedElements[0]?.elementId;
    if (selectedElementId) {
      applyEffect(selectedElementId, preset);

      // Auto-show effects track when effect is applied
      autoShowEffectsTrack();

      toast.success(`Applied ${preset.name} effect`);
```

**Note**: We add `autoShowEffectsTrack()` call right after `applyEffect()` to automatically reveal the effects track.

**Estimated time**: 20 minutes

### 5. Update Tests
**Files**: Timeline component tests (likely in `apps/web/src/components/editor/timeline/__tests__/`)

- [ ] Update existing timeline tests to account for hidden effects track
- [ ] Add test: Effects track hidden by default
- [ ] Add test: Effects track visible when toggled
- [ ] Add test: Effects track auto-shows when effect added
- [ ] Verify no visual regression in test snapshots

#### Test Cases to Add/Update

```typescript
// Test 1: Effects track hidden by default
describe('Effects Track Visibility', () => {
  it('should hide effects track by default', () => {
    // Render timeline component
    // Assert that effects track is NOT in the DOM
    // Check localStorage is NOT set or set to 'false'
  });

  it('should show effects track when toggle button is clicked', () => {
    // Render timeline component
    // Click the effects track toggle button (Sparkles icon)
    // Assert that effects track IS in the DOM
    // Check localStorage is set to 'true'
  });

  it('should persist effects track visibility across sessions', () => {
    // Set localStorage to 'true'
    // Render timeline component
    // Assert that effects track IS visible
  });

  it('should auto-show effects track when effect is applied', () => {
    // Render timeline with effects track hidden
    // Apply an effect to an element
    // Assert that effects track becomes visible
    // Check localStorage is updated to 'true'
  });

  it('should hide effects track toggle when EFFECTS_ENABLED is false', () => {
    // Mock EFFECTS_ENABLED to false
    // Render timeline component
    // Assert that Sparkles toggle button is NOT in the DOM
  });
});
```

#### Manual Testing Checklist

- [ ] Effects track is hidden on fresh install (no localStorage)
- [ ] Click Sparkles button → track appears
- [ ] Click Sparkles button again → track disappears
- [ ] Refresh page → track visibility persists
- [ ] Apply effect to element → track auto-appears
- [ ] Timeline height adjusts correctly when track is hidden/shown
- [ ] No console errors during toggle
- [ ] Keyboard navigation works (if keyboard shortcut added)

**Estimated time**: 30 minutes

### 6. Documentation & UX Polish (Optional Enhancements)

- [ ] Add keyboard shortcut for toggle (e.g., `Ctrl+E` or `Shift+E`)
- [ ] Update user documentation if exists
- [ ] Consider adding first-time tooltip/hint about effects track toggle
- [ ] Test with screen readers for accessibility

#### Step 6.1: Add Keyboard Shortcut (Optional)

**File**: Look for keyboard event handler in Timeline component or create one

**Add a useEffect for keyboard shortcuts**:

```typescript
// Add this in the Timeline component after other useEffect hooks
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Ctrl+Shift+E to toggle effects track
    if (e.ctrlKey && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      const { toggleEffectsTrack } = useTimelineStore.getState();
      toggleEffectsTrack();
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);
```

**Update tooltip text** to include keyboard shortcut:

```tsx
<TooltipContent>
  {showEffectsTrack
    ? "Hide Effects Track (Ctrl+Shift+E)"
    : "Show Effects Track (Ctrl+Shift+E)"}
</TooltipContent>
```

#### Step 6.2: Accessibility Improvements

**Update the toggle button** with proper ARIA attributes:

```tsx
<Button
  variant="text"
  size="icon"
  onClick={toggleEffectsTrack}
  aria-label={showEffectsTrack ? "Hide effects track" : "Show effects track"}
  aria-pressed={showEffectsTrack}
>
  <Sparkles
    className={`h-4 w-4 ${showEffectsTrack ? "text-primary" : ""}`}
    aria-hidden="true"
  />
</Button>
```

#### Step 6.3: First-Time User Experience (Optional)

Consider adding a one-time tooltip that shows when:
- User applies their first effect
- Effects track auto-shows
- Inform user about the new toggle button

```typescript
// In the autoShowEffectsTrack function
autoShowEffectsTrack: () => {
  const { showEffectsTrack } = get();
  if (!showEffectsTrack) {
    set({ showEffectsTrack: true });

    // Persist to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('timeline-showEffectsTrack', 'true');

      // Show hint if first time showing effects track
      const hasSeenEffectsTrackHint = localStorage.getItem('has-seen-effects-track-hint');
      if (!hasSeenEffectsTrackHint) {
        // Show a toast with information
        // toast.info('Effects track is now visible! Use the ✨ button in the toolbar to toggle it.');
        localStorage.setItem('has-seen-effects-track-hint', 'true');
      }
    }
  }
},
```

#### Step 6.4: Documentation Updates

**If there's a user guide or README**, add a section:

```markdown
### Effects Track

The Effects track visualizes all applied effects across your timeline elements.

**Visibility:**
- Hidden by default to save space
- Automatically appears when you apply your first effect
- Toggle visibility using the ✨ (Sparkles) button in the timeline toolbar
- Keyboard shortcut: `Ctrl+Shift+E`

**Features:**
- Shows colored bars representing different effect types
- Effects are layered on top of timeline elements
- Hover over effect bars to see effect names
```

**Estimated time**: 20 minutes

## Technical Notes

### Current Rendering Logic

The effects track is rendered in two places:

1. **Left sidebar** (track labels):
```tsx
{EFFECTS_ENABLED && tracks.length > 0 && (
  <div className="flex items-center px-3 border-t-2 border-purple-500/30 group bg-purple-500/10"
       style={{ height: "64px" }}>
    <div className="flex items-center flex-1 min-w-0">
      <span className="text-sm text-purple-400">Effects</span>
    </div>
  </div>
)}
```

2. **Main timeline area** (effects visualization):
```tsx
{EFFECTS_ENABLED && tracks.length > 0 && (
  <div className="absolute left-0 right-0 border-t-2 border-purple-500/30"
       style={{ top: `${getTotalTracksHeight(tracks)}px`, height: `${TIMELINE_CONSTANTS.TRACK_HEIGHT}px` }}>
    <EffectsTimeline tracks={tracks} pixelsPerSecond={TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel} />
  </div>
)}
```

### Design Considerations

1. **Default State**: Hide by default to reduce clutter
2. **Auto-Show**: Automatically reveal when user adds their first effect
3. **Persistence**: Save user preference across sessions
4. **Discoverability**: Make toggle button visible/accessible in toolbar
5. **Accessibility**: Ensure keyboard navigation and screen reader support

### Edge Cases to Handle

- What if `VIDEO_EFFECTS` feature is disabled? (Toggle should not appear)
- What if user has effects but manually hides the track? (Respect user preference)
- What if user deletes all effects? (Keep track visible if manually shown)
- Timeline height calculations must account for hidden effects track

## Total Estimated Implementation Time

**2.5 - 3 hours** (including testing and polish)

---

## Summary of Code Changes

### Files to Modify (3 files)

#### 1. **`apps/web/src/stores/timeline-store.ts`**
   - **Lines to add**: ~50 lines
   - **Changes**:
     - Add `showEffectsTrack`, `toggleEffectsTrack`, `autoShowEffectsTrack` to interface
     - Initialize `showEffectsTrack` from localStorage (default: false)
     - Implement toggle and auto-show functions with localStorage persistence

#### 2. **`apps/web/src/components/editor/timeline/index.tsx`**
   - **Lines to modify**: ~15 lines
   - **Lines to add**: ~25 lines
   - **Changes**:
     - Import `Sparkles` icon
     - Add `showEffectsTrack` selector to Timeline component
     - Update 3 conditional checks to include `&& showEffectsTrack`
     - Add toggle button to TimelineToolbar with tooltip
     - Add keyboard shortcut handler (optional)

#### 3. **`apps/web/src/components/editor/media-panel/views/effects.tsx`**
   - **Lines to modify**: ~5 lines
   - **Changes**:
     - Destructure `autoShowEffectsTrack` from `useTimelineStore`
     - Call `autoShowEffectsTrack()` when effect is applied

### State Flow Diagram

```
User Action                    State Change                    UI Update
────────────────────────────────────────────────────────────────────────
1. App loads               →   localStorage → showEffectsTrack   →   Track hidden/shown
2. Click Sparkles button   →   toggleEffectsTrack()             →   Track toggles + localStorage
3. Apply effect            →   autoShowEffectsTrack()           →   Track appears (if hidden)
4. Page refresh            →   Load from localStorage           →   Persist user preference
```

### Testing Checklist

**Core Functionality:**
- [ ] Effects track hidden by default (fresh install)
- [ ] Toggle button shows/hides track
- [ ] Preference persists across page reloads
- [ ] Auto-shows when effect applied
- [ ] Timeline height adjusts correctly

**Edge Cases:**
- [ ] Toggle works when EFFECTS_ENABLED = true
- [ ] Toggle hidden when EFFECTS_ENABLED = false
- [ ] Multiple effects don't cause multiple auto-shows
- [ ] Works correctly with no tracks on timeline
- [ ] Works correctly with multiple tracks

**Accessibility:**
- [ ] Keyboard shortcut works (if implemented)
- [ ] Button has proper ARIA labels
- [ ] Screen reader announces state changes
- [ ] Focus management works correctly

### Rollback Plan

If issues arise:
1. Set `EFFECTS_ENABLED` to `false` in `apps/web/src/config/features.ts`
2. Or revert changes to the 3 files listed above
3. Clear localStorage: `localStorage.removeItem('timeline-showEffectsTrack')`

### Performance Considerations

- **Minimal impact**: Only adds one boolean check to render conditions
- **localStorage**: Synchronous but fast (single key read/write)
- **No re-renders**: Toggle doesn't cause timeline re-layout, just conditional render
- **Memory**: No additional memory overhead (single boolean state)
