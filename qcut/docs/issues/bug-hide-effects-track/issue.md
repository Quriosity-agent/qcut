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
