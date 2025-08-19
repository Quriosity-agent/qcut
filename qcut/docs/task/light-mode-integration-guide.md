# Light Mode Integration Guide for QCut

## Overview
This guide breaks down the light mode implementation into manageable subtasks, each taking less than 10 minutes to complete.

## Prerequisites
- Working QCut development environment
- Bun package manager installed
- Git configured

---

## Phase 1: Theme Infrastructure (30 minutes total)

### Task 1.1: Update CSS Variables (8 minutes)
**Files to modify:**
- `apps/web/src/styles/globals.css`

**Changes:**
```css
/* Add light mode color variables */
:root {
  --background: 255 255 255;
  --foreground: 10 10 10;
  --muted-foreground: 115 115 115;
}

.dark {
  --background: 10 10 10;
  --foreground: 250 250 250;
  --muted-foreground: 161 161 170;
}
```

### Task 1.2: Create Theme Toggle Component (10 minutes)
**File to create:**
- `apps/web/src/components/ui/theme-toggle.tsx`

**Implementation:**
```typescript
import { Moon, Sun } from "lucide-react";
import { Button } from "./button";

export function ThemeToggle() {
  // Implementation here
}
```

### Task 1.3: Add Theme Provider (8 minutes)
**File to create:**
- `apps/web/src/components/providers/theme-provider.tsx`

**Files to modify:**
- `apps/web/src/routes/__root.tsx` - Wrap app with ThemeProvider

---

## Phase 2: Component Updates (40 minutes total)

### Task 2.1: Update Header Component (7 minutes)
**File to modify:**
- `apps/web/src/components/header.tsx`

**Changes:**
- Add `className="invert dark:invert-0"` to logo image
- Replace `bg-accent` with `bg-background`
- Update border colors to use theme variables

### Task 2.2: Update Editor Header (8 minutes)
**File to modify:**
- `apps/web/src/components/editor/editor-header.tsx`

**Changes:**
- Replace hardcoded colors with theme-aware classes
- Update button variants for theme compatibility

### Task 2.3: Update Timeline Components (10 minutes)
**Files to modify:**
- `apps/web/src/components/editor/timeline/timeline.tsx`
- `apps/web/src/components/editor/timeline/timeline-track.tsx`
- `apps/web/src/components/editor/timeline/timeline-element.tsx`

**Changes:**
- Replace `bg-zinc-900` with `bg-background`
- Update border colors from `border-zinc-700` to `border-border`
- Change text colors from `text-zinc-400` to `text-muted-foreground`

### Task 2.4: Update Properties Panel (8 minutes)
**File to modify:**
- `apps/web/src/components/editor/properties/properties-panel.tsx`

**Changes:**
- Update background colors to theme variables
- Fix contrast for input fields in light mode

### Task 2.5: Update Preview Canvas (7 minutes)
**File to modify:**
- `apps/web/src/components/editor/preview/preview-canvas.tsx`

**Changes:**
- Add theme-aware background for canvas area
- Update controls to be visible in both themes

---

## Phase 3: UI Components (25 minutes total)

### Task 3.1: Update Button Component (5 minutes)
**File to modify:**
- `apps/web/src/components/ui/button.tsx`

**Changes:**
- Ensure all variants work with light/dark themes
- Test hover states in both modes

### Task 3.2: Update Dialog Components (8 minutes)
**Files to modify:**
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/editor/export-dialog.tsx`

**Changes:**
- Update overlay background for light mode
- Fix dialog content background and borders

### Task 3.3: Update Form Controls (7 minutes)
**Files to modify:**
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/slider.tsx`

**Changes:**
- Update borders and backgrounds
- Ensure focus states are visible in both themes

### Task 3.4: Update Tooltips and Dropdowns (5 minutes)
**Files to modify:**
- `apps/web/src/components/ui/tooltip.tsx`
- `apps/web/src/components/ui/dropdown-menu.tsx`

**Changes:**
- Fix tooltip backgrounds for light mode
- Update dropdown shadows and borders

---

## Phase 4: Assets and Icons (15 minutes total)

### Task 4.1: Prepare Theme-Specific Assets (8 minutes)
**Files to create:**
- `apps/web/public/assets/logo-light.svg`
- `apps/web/public/assets/logo-dark.svg`

**File to modify:**
- `apps/web/src/components/editor/toolbar.tsx` - Add conditional logo loading

### Task 4.2: Update Icon Components (7 minutes)
**Files to modify:**
- `apps/web/src/components/icons/index.tsx`

**Changes:**
- Add `currentColor` to all SVG icons
- Remove hardcoded fill/stroke colors

---

## Phase 5: Editor-Specific Updates (20 minutes total)

### Task 5.1: Update Toolbar (8 minutes)
**File to modify:**
- `apps/web/src/components/editor/toolbar.tsx`

**Changes:**
- Update tool button backgrounds
- Fix active/inactive states for both themes

### Task 5.2: Update Media Library (7 minutes)
**Files to modify:**
- `apps/web/src/components/editor/media-library.tsx`
- `apps/web/src/components/editor/media-item.tsx`

**Changes:**
- Update grid backgrounds
- Fix media item hover states

### Task 5.3: Update Playback Controls (5 minutes)
**File to modify:**
- `apps/web/src/components/editor/playback-controls.tsx`

**Changes:**
- Update control button styles
- Fix time display colors

---

## Phase 6: Testing and Polish (15 minutes total)

### Task 6.1: Create Theme Test Page (10 minutes)
**File to create:**
- `apps/web/src/routes/test-theme.tsx`

**Purpose:**
- Display all components in both themes
- Quick visual regression testing

### Task 6.2: Update Storybook (if exists) (5 minutes)
**Files to modify:**
- `.storybook/preview.js` - Add theme decorator
- `*.stories.tsx` files - Add theme variants

---

## Phase 7: Electron Integration (10 minutes total)

### Task 7.1: Update Electron Window (5 minutes)
**File to modify:**
- `electron/main.js`

**Changes:**
```javascript
// Add theme detection
const { nativeTheme } = require('electron');
// Pass theme to renderer
```

### Task 7.2: Add IPC Handlers (5 minutes)
**Files to modify:**
- `electron/main.js` - Add theme IPC handlers
- `electron/preload.js` - Expose theme API

**New IPC channels:**
- `theme:get` - Get current theme
- `theme:set` - Set theme preference
- `theme:toggle` - Toggle theme

---

## Verification Checklist

After each phase, verify:
- [ ] Components are visible in both light and dark modes
- [ ] Text has sufficient contrast (WCAG AA minimum)
- [ ] Interactive elements have visible focus states
- [ ] No hardcoded colors remain in modified files
- [ ] Theme toggle works correctly
- [ ] Theme preference persists across sessions

## Testing Commands

```bash
# Run development server
bun dev

# Test in Electron
bun run electron:dev

# Lint for any issues
bun lint:clean

# Build for production
bun build
```

## Common Issues and Solutions

### Issue 1: Text not visible in light mode
**Solution:** Replace `text-white` with `text-foreground`

### Issue 2: Borders too light in dark mode
**Solution:** Use `border-border` instead of `border-gray-200`

### Issue 3: Background colors not switching
**Solution:** Ensure parent has `bg-background` class

### Issue 4: Icons not visible
**Solution:** Use `currentColor` for SVG fill/stroke

## Next Steps

1. Implement theme persistence in localStorage
2. Add theme sync across multiple windows
3. Create theme customization options
4. Add high contrast mode support
5. Implement automatic theme detection based on OS

## Resources

- [Tailwind CSS Dark Mode](https://tailwindcss.com/docs/dark-mode)
- [Radix UI Themes](https://www.radix-ui.com/themes/docs/theme/dark-mode)
- [Electron nativeTheme API](https://www.electronjs.org/docs/latest/api/native-theme)
- [WCAG Contrast Guidelines](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum)