# Sliding Tab Indicator — Media Panel TabBar

## Overview

A horizontal sliding blue indicator bar under the Media Panel tab bar that animates between tabs when switching panels.

## Visual Design

### Layout Structure

```
+----------------------------------------------------------------------+
|  < | Media | AI Images | Adjustment | AI Video | Nano Edit | ... | > |  <- Tab Bar (h-12)
+----------------------------------------------------------------------+
|         ============                                                  |  <- Sliding Bar (2px)
+----------------------------------------------------------------------+
|                                                                      |
|                        Panel Content                                 |
|                                                                      |
+----------------------------------------------------------------------+
```

### States

**Idle — "Media" active:**
```
  Media    AI Images    Adjustment    AI Video    Nano Edit
  =====
  (blue)
```

**After clicking "AI Images":**
```
  Media    AI Images    Adjustment    AI Video    Nano Edit
           =========
             (blue, slides right with 300ms ease-in-out)
```

**After clicking "AI Video":**
```
  Media    AI Images    Adjustment    AI Video    Nano Edit
                                     ========
                                      (blue)
```

### Indicator Specs

| Property        | Value                              |
|-----------------|------------------------------------|
| Height          | `2px`                              |
| Color           | `#3b82f6` (blue-500)               |
| Glow            | `0 0 6px rgba(59,130,246,0.5)`     |
| Border radius   | `rounded-full` (pill shape)        |
| Width           | Matches active tab element width   |
| Position        | Flush below tab bar, no gap        |
| Animation       | `transition-all 300ms ease-in-out` |
| Track bg        | Transparent (no visible track)     |

### Color Contrast

```
  Dark panel background (#1a1a2e ~)
  ┌─────────────────────────────────┐
  │  Tab text: muted-foreground     │
  │  Active tab text: primary       │
  ├─────────────────────────────────┤
  │  ████  <- #3b82f6 + glow       │  High contrast against dark bg
  └─────────────────────────────────┘
```

## Component Architecture

```
TabBar (relative wrapper)
├── flex row
│   ├── ScrollButton (left, conditional)
│   ├── Scroll Container (overflow-x-auto, scrollbar hidden)
│   │   ├── Tab "Media"        ← ref tracked
│   │   ├── Tab "AI Images"    ← ref tracked
│   │   ├── Tab "Adjustment"   ← ref tracked
│   │   ├── Tab "AI Video"     ← ref tracked
│   │   ├── Tab "Nano Edit"    ← ref tracked
│   │   └── ... more tabs
│   └── ScrollButton (right, conditional)
└── Indicator Track (h-[2px], full width, relative)
    └── Sliding Indicator (absolute, positioned by JS)
```

### Why the indicator is outside the scroll container

The scroll container has `overflow-x: auto` which clips absolutely-positioned children. Placing the indicator in a separate `div` below ensures it is always visible regardless of scroll state.

## Position Calculation

```
indicator.left = tab.getBoundingClientRect().left
               - container.getBoundingClientRect().left
               + container.scrollLeft

indicator.width = tab.getBoundingClientRect().width
```

The `scrollLeft` offset ensures the indicator aligns correctly even when the tab bar is scrolled.

### Update Triggers

| Trigger             | Mechanism                          |
|---------------------|------------------------------------|
| Tab click           | `useEffect` on `activeTab` change  |
| Container resize    | `ResizeObserver` on scroll container|
| Scroll              | Scroll event listener              |

## File Modified

`apps/web/src/components/editor/media-panel/tabbar.tsx`
