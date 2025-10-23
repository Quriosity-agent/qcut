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

**Estimated time**: 20 minutes

### 3. Add Toggle Button to Timeline Toolbar
**File**: `apps/web/src/components/editor/timeline/index.tsx` (TimelineToolbar function)

- [ ] Add toggle button in toolbar (around line 1476 near Magnet/Link buttons)
- [ ] Use an appropriate icon (e.g., `Sparkles` or `Wand2` from lucide-react)
- [ ] Add tooltip explaining "Show/Hide Effects Track"
- [ ] Highlight button when effects track is visible (similar to snapping toggle)
- [ ] Add conditional rendering: only show toggle when `EFFECTS_ENABLED === true`

**Estimated time**: 30 minutes

### 4. Auto-Show Logic for Effects
**File**: Multiple files

- [ ] When user adds an effect via the effects panel, automatically call `autoShowEffectsTrack()`
- [ ] Check `apps/web/src/components/editor/effects-panel.tsx` or similar
- [ ] Ensure effects track appears when first effect is applied
- [ ] Consider: Should track hide when last effect is removed?

**Estimated time**: 20 minutes

### 5. Update Tests
**Files**: Timeline component tests

- [ ] Update existing timeline tests to account for hidden effects track
- [ ] Add test: Effects track hidden by default
- [ ] Add test: Effects track visible when toggled
- [ ] Add test: Effects track auto-shows when effect added
- [ ] Verify no visual regression in test snapshots

**Estimated time**: 30 minutes

### 6. Documentation & UX Polish
- [ ] Add keyboard shortcut for toggle (e.g., `Ctrl+E` or `Shift+E`)
- [ ] Update user documentation if exists
- [ ] Consider adding first-time tooltip/hint about effects track toggle
- [ ] Test with screen readers for accessibility

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
