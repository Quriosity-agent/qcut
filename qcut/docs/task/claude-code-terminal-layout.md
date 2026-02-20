# Claude Code Terminal Layout — Auto-Expand on Focus

## Problem

The terminal panel lives inside the MediaPanel (left sidebar), hard-capped at 15–40% width. On a 1440px editor that's ~288px — too narrow for CLI use.

## Solution Implemented (Option B)

Auto-expand the left panel when the user switches to the Terminal tab. Revert when switching away.

### How it works

1. User clicks **Terminal** tab (`"pty"`) in the Agents group
2. `media-panel/store.ts` detects the tab transition and calls `enterTerminalFocus()`
3. `panel-store.ts` saves the current preset, switches to the `"terminal"` preset (toolsPanel: 55%, previewPanel: 30%, propertiesPanel: 15%, mainContent: 85%), and bumps `resetCounter` to force panel re-mount
4. `panel-layouts.tsx` reads `activePreset` and sets `maxSize={70}` (instead of 40) for the toolsPanel when in terminal mode
5. When the user switches away from the Terminal tab, `exitTerminalFocus()` restores the previous preset and re-mounts the panels

### Files changed

| File | Change |
|------|--------|
| `stores/panel-store.ts` | Added `"terminal"` to `PanelPreset` type, `PRESET_CONFIGS`, `PRESET_LABELS`, `PRESET_DESCRIPTIONS`. Added `preTerminalPreset` state field. Added `enterTerminalFocus()` and `exitTerminalFocus()` actions. |
| `components/editor/panel-layouts.tsx` | `DefaultLayout` and `MediaLayout` now read `activePreset` and compute `maxToolsSize` dynamically (70 for terminal, 40 otherwise). The normalization function and `<ResizablePanel maxSize>` both use this value. |
| `components/editor/media-panel/store.ts` | `setActiveTab()` detects transitions to/from `"pty"` and calls `enterTerminalFocus()`/`exitTerminalFocus()` on the panel store. |
| `routes/editor.$project_id.lazy.tsx` | Added `terminal` key to the layouts map (maps to `DefaultLayout`). |

### Terminal preset sizes

```
toolsPanel:    55%  (was 20%)  — wide terminal
previewPanel:  30%  (was 55%)  — minimized preview
propertiesPanel: 15% (was 25%) — minimized properties
mainContent:   85%  (was 70%)  — more vertical space
timeline:      15%  (was 30%)  — shrunk timeline
```

### Edge cases handled

- **Already in terminal focus**: `enterTerminalFocus()` is a no-op if `activePreset === "terminal"`
- **User manually changed preset while in terminal**: `exitTerminalFocus()` checks `activePreset === "terminal"` before restoring; if user already switched away, it just clears `preTerminalPreset`
- **Panel re-mount**: `resetCounter` is bumped to force `react-resizable-panels` to re-mount with the new `defaultSize` values
