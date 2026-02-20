# Claude Code Terminal Layout Issue

## Problem

The Claude Code terminal panel does not use the full horizontal width of the screen. The terminal lives inside the **MediaPanel** (left sidebar), which is hard-capped at **15–40%** of the editor width. The remaining 60–85% is consumed by the PreviewPanel and PropertiesPanel, making the terminal too narrow for comfortable CLI use.

## Architecture (from code)

### Panel hierarchy

```
editor.$project_id.lazy.tsx
└── DefaultLayout (panel-layouts.tsx:19)
    └── ResizablePanelGroup (vertical)
        ├── ResizablePanel (mainContent: 70%)
        │   └── ResizablePanelGroup (horizontal)
        │       ├── ResizablePanel (toolsPanel: 20%, min 15%, max 40%)  ← MediaPanel
        │       │   └── media-panel/index.tsx
        │       │       ├── GroupBar  [Create | Edit | Library | Agents]
        │       │       ├── TabBar   [Skills | Terminal | Remotion]
        │       │       └── PtyTerminalView  (when activeTab === "pty")
        │       ├── ResizableHandle
        │       ├── ResizablePanel (previewPanel: 55%, min 30%)         ← PreviewPanel
        │       ├── ResizableHandle
        │       └── ResizablePanel (propertiesPanel: 25%, min 15%, max 40%) ← PropertiesPanel
        ├── ResizableHandle
        └── ResizablePanel (timeline: 30%)
```

### Key constraints (from code)

| File | Line | Constraint |
|------|------|------------|
| `panel-layouts.tsx` | 144–152 | `<ResizablePanel defaultSize={normalizedTools} minSize={15} maxSize={40}>` — MediaPanel (contains terminal) |
| `panel-layouts.tsx` | 156–163 | `<ResizablePanel defaultSize={normalizedPreview} minSize={30}>` — PreviewPanel |
| `panel-layouts.tsx` | 167–175 | `<ResizablePanel defaultSize={normalizedProperties} minSize={15} maxSize={40}>` — PropertiesPanel |
| `panel-store.ts` | 159–167 | `DEFAULT_PANEL_SIZES`: toolsPanel=20, previewPanel=55, propertiesPanel=25 |
| `media-panel/store.ts` | 165–169 | Terminal tab is `"pty"` inside the `agents` group |
| `media-panel/index.tsx` | 80–86 | PtyTerminalView renders with `display: flex` only when `activeTab === "pty"` |

### Why the terminal is narrow

1. **Hard max 40%**: `panel-layouts.tsx:147` caps `toolsPanel` at `maxSize={40}`. Even dragging the handle all the way right stops at 40%.
2. **PreviewPanel min 30%**: `panel-layouts.tsx:158` forces preview to keep at least 30%, and PropertiesPanel keeps at least 15%. Together they claim a minimum of 45%, leaving at most 55% for toolsPanel — but `maxSize={40}` kicks in first.
3. **Default only 20%**: `panel-store.ts:160` starts toolsPanel at 20%. On a 1440px-wide editor, that's ~288px for the terminal.
4. **GroupBar + TabBar overhead**: `media-panel/index.tsx:78-79` renders the GroupBar and TabBar above the terminal, consuming ~80px of vertical space.

## Suggestions to Fix

### Option A: Add "Terminal" layout preset (recommended)

Add a new preset to `panel-store.ts` alongside "default", "media", "inspector", "vertical-preview":

```ts
// panel-store.ts — add to PRESET_CONFIGS
"terminal": {
  toolsPanel: 55,       // Terminal gets majority
  previewPanel: 30,     // Preview at minimum
  propertiesPanel: 15,  // Properties at minimum
  mainContent: 85,      // Maximize vertical space (shrink timeline)
  timeline: 15,
  aiPanelWidth: 22,
  aiPanelMinWidth: 4,
},
```

Also update `maxSize` in `panel-layouts.tsx` for the terminal layout to allow toolsPanel > 40%, or create a dedicated `TerminalLayout` component with relaxed constraints:

```tsx
// panel-layouts.tsx — TerminalLayout
<ResizablePanel defaultSize={55} minSize={30} maxSize={70}>  {/* toolsPanel */}
  <MediaPanel />
</ResizablePanel>
<ResizableHandle withHandle />
<ResizablePanel defaultSize={30} minSize={15}>               {/* previewPanel */}
  <PreviewPanel />
</ResizablePanel>
<ResizableHandle withHandle />
<ResizablePanel defaultSize={15} minSize={10} maxSize={30}>  {/* propertiesPanel */}
  <PropertiesPanel />
</ResizablePanel>
```

**Files to change**: `panel-store.ts` (add preset + label), `panel-layouts.tsx` (add TerminalLayout component), `editor.$project_id.lazy.tsx` (add to layouts map).

### Option B: Auto-expand on terminal focus

When the user switches to the `"pty"` tab, automatically widen toolsPanel and narrow the other panels. Revert when switching away.

```ts
// media-panel/store.ts — in setActiveTab action
if (tab === "pty") {
  usePanelStore.getState().applyPreset("terminal");
} else if (previousTab === "pty") {
  usePanelStore.getState().applyPreset(usePanelStore.getState().activePreset);
}
```

**Pros**: Zero user effort, seamless.
**Cons**: Jarring layout shift, need to track "previous preset" to restore.

### Option C: Raise maxSize for toolsPanel

Minimal change — just increase the cap in `panel-layouts.tsx:147`:

```tsx
// Before
<ResizablePanel defaultSize={normalizedTools} minSize={15} maxSize={40}>

// After
<ResizablePanel defaultSize={normalizedTools} minSize={15} maxSize={60}>
```

Also update the normalization in `panel-layouts.tsx:49` and `panel-store.ts` to allow `maxTools = 60`.

**Pros**: Simplest change, user can manually drag wider.
**Cons**: Doesn't auto-optimize for terminal use; preview gets squeezed.

### Option D: Full-width terminal overlay / focus mode

Add a "Focus" button to `pty-terminal-view.tsx` that renders the terminal as a full-width overlay above the panel layout (similar to a maximized terminal in VS Code):

```tsx
// pty-terminal-view.tsx — add focus mode state
const [isFocused, setIsFocused] = useState(false);

if (isFocused) {
  return createPortal(
    <div className="fixed inset-0 z-50 bg-[#1a1a1a]">
      <button onClick={() => setIsFocused(false)}>Exit Focus</button>
      <TerminalEmulator sessionId={sessionId} isVisible />
    </div>,
    document.body
  );
}
```

**Pros**: Full screen, no layout disruption.
**Cons**: Hides editor entirely; need keyboard shortcut (e.g., `Escape`) to exit.
