# Light Mode Integration Guide for QCut (Revised)

## ⚠️ Critical Finding
**The application currently has `forcedTheme="dark"` in the ThemeProvider**, which prevents theme switching. This must be addressed first.

## Overview
This revised guide is based on the actual repository structure and ensures no existing features are broken. Each subtask is designed to take less than 10 minutes.

---

## Phase 0: Enable Theme Switching (REQUIRED FIRST) - 5 minutes

### Task 0.1: Remove Forced Dark Theme (5 minutes)
**File to modify:**
- `qcut/apps/web/src/routes/__root.tsx`

**Current code (line 10):**
```typescript
<ThemeProvider attribute="class" forcedTheme="dark">
```

**Change to:**
```typescript
<ThemeProvider attribute="class" defaultTheme="dark">
```

**Why:** Currently the app is forced to dark mode, preventing any theme switching.

---

## Phase 1: Theme Infrastructure (25 minutes total)

### Task 1.1: Verify CSS Variables (5 minutes)
**File to check:**
- `qcut/apps/web/src/app/globals.css`

**Status:** ✅ Already has light/dark mode CSS variables defined
- Light mode variables: lines 10-47
- Dark mode variables: lines 48+

**Action:** No changes needed - variables already exist!

### Task 1.2: Create Theme Toggle Component (10 minutes)
**File to create:**
- `qcut/apps/web/src/components/ui/theme-toggle.tsx`

**Implementation:**
```typescript
"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "./button";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  );
}
```

### Task 1.3: Add Theme Toggle to Header (10 minutes)
**File to modify:**
- `qcut/apps/web/src/components/header.tsx`

**Add import:**
```typescript
import { ThemeToggle } from "./ui/theme-toggle";
```

**Update rightContent (after line 16):**
```typescript
const rightContent = (
  <nav className="flex items-center gap-1">
    <ThemeToggle />
    <div className="flex items-center gap-4">
      {/* existing links */}
    </div>
    {/* existing button */}
  </nav>
);
```

---

## Phase 2: Fix Component Backgrounds (30 minutes total)

### Task 2.1: Update Header Component (5 minutes)
**File to modify:**
- `qcut/apps/web/src/components/header.tsx`

**Line 44 - Change:**
```typescript
className="bg-accent border rounded-2xl max-w-3xl mx-auto mt-4 pl-4 pr-[14px]"
```
**To:**
```typescript
className="bg-background border rounded-2xl max-w-3xl mx-auto mt-4 pl-4 pr-[14px]"
```

**Add to logo (line 11):**
```typescript
<img src="./logo.svg" alt="QCut Logo" width={32} height={32} className="dark:invert" />
```

### Task 2.2: Update Timeline Components (10 minutes)
**Files to modify:**
- `qcut/apps/web/src/components/editor/timeline/index.tsx`
- `qcut/apps/web/src/components/editor/timeline/timeline-track.tsx`
- `qcut/apps/web/src/components/editor/timeline/timeline-element.tsx`

**Common replacements:**
- `bg-zinc-900` → `bg-background`
- `bg-zinc-800` → `bg-card`
- `border-zinc-700` → `border-border`
- `text-zinc-400` → `text-muted-foreground`
- `text-zinc-500` → `text-muted-foreground`

### Task 2.3: Update Preview Panel (8 minutes)
**File to modify:**
- `qcut/apps/web/src/components/editor/preview-panel.tsx`

**Replace hardcoded colors:**
- `bg-black` → `bg-background`
- `bg-gray-900` → `bg-card`
- Any `text-white` → `text-foreground`

### Task 2.4: Update Properties Panel (7 minutes)
**Files to modify:**
- `qcut/apps/web/src/components/editor/properties-panel/index.tsx`
- `qcut/apps/web/src/components/editor/properties-panel/media-properties.tsx`
- `qcut/apps/web/src/components/editor/properties-panel/audio-properties.tsx`
- `qcut/apps/web/src/components/editor/properties-panel/text-properties.tsx`

**Replace colors to use theme variables**

---

## Phase 3: Fix Media Panel (20 minutes total)

### Task 3.1: Update Media Panel Tabs (8 minutes)
**File to modify:**
- `qcut/apps/web/src/components/editor/media-panel/tabbar.tsx`

**Update tab colors for light/dark mode compatibility**

### Task 3.2: Update Media Views (12 minutes)
**Files to modify:**
- `qcut/apps/web/src/components/editor/media-panel/views/media.tsx`
- `qcut/apps/web/src/components/editor/media-panel/views/audio.tsx`
- `qcut/apps/web/src/components/editor/media-panel/views/text.tsx`
- `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Ensure backgrounds and text are theme-aware**

---

## Phase 4: UI Components Already Compatible (0 minutes)

**Good news:** The UI components in `qcut/apps/web/src/components/ui/` already use CSS variables that support light/dark mode:
- ✅ Button
- ✅ Dialog
- ✅ Input
- ✅ Select
- ✅ Card
- ✅ Tooltip
- ✅ Dropdown Menu

**No changes needed for these components!**

---

## Phase 5: Electron Integration (15 minutes total)

### Task 5.1: Add Theme IPC Handlers (10 minutes)
**File to modify:**
- `qcut/electron/main.js`

**Add after other IPC handlers:**
```javascript
const { nativeTheme } = require('electron');

// Theme handlers
ipcMain.handle('theme:get', () => {
  return nativeTheme.themeSource;
});

ipcMain.handle('theme:set', (event, theme) => {
  nativeTheme.themeSource = theme; // 'light', 'dark', or 'system'
  return theme;
});

ipcMain.handle('theme:toggle', () => {
  const newTheme = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
  nativeTheme.themeSource = newTheme;
  return newTheme;
});
```

### Task 5.2: Expose Theme API in Preload (5 minutes)
**File to modify:**
- `qcut/electron/preload.js`

**Add to contextBridge.exposeInMainWorld:**
```javascript
theme: {
  get: () => ipcRenderer.invoke('theme:get'),
  set: (theme) => ipcRenderer.invoke('theme:set', theme),
  toggle: () => ipcRenderer.invoke('theme:toggle'),
},
```

---

## Phase 6: Testing & Verification (10 minutes total)

### Task 6.1: Test Theme Toggle (5 minutes)
**Commands:**
```bash
# Start development server
bun dev

# Test theme toggle in browser
# Click theme toggle button and verify:
# - Background changes
# - Text remains readable
# - Components update correctly
```

### Task 6.2: Test in Electron (5 minutes)
**Commands:**
```bash
# Test in Electron development mode
bun run electron:dev

# Verify theme persists across app restarts
```

---

## Common Issues & Solutions

### Issue 1: Theme not switching
**Solution:** Ensure `forcedTheme="dark"` is removed from ThemeProvider

### Issue 2: Components still dark in light mode
**Solution:** Check for hardcoded dark colors (bg-black, bg-gray-900, etc.)

### Issue 3: Poor contrast in light mode
**Solution:** Use semantic color variables (foreground, muted-foreground) instead of fixed colors

### Issue 4: Electron window frame doesn't match theme
**Solution:** Add `titleBarStyle: 'hidden'` or use native theme detection

---

## Files That DON'T Need Changes

These files/components already work with themes:
- ✅ All files in `qcut/apps/web/src/components/ui/` (use CSS variables)
- ✅ `qcut/apps/web/src/app/globals.css` (already has variables)
- ✅ Components using Tailwind's dark: prefix

---

## Verification Checklist

After implementation:
- [ ] Theme toggle button appears in header
- [ ] Clicking toggle switches between light/dark
- [ ] Editor timeline is visible in both themes
- [ ] Preview panel has proper contrast
- [ ] Properties panel is readable
- [ ] Media panel tabs are visible
- [ ] Text has sufficient contrast (WCAG AA)
- [ ] No console errors when switching themes
- [ ] Theme persists on page refresh
- [ ] Works in both browser and Electron

---

## Total Time Estimate

- Phase 0: 5 minutes (REQUIRED)
- Phase 1: 25 minutes
- Phase 2: 30 minutes
- Phase 3: 20 minutes
- Phase 4: 0 minutes (already done)
- Phase 5: 15 minutes
- Phase 6: 10 minutes

**Total: ~1 hour 45 minutes**

## Next Steps After Implementation

1. Add theme persistence to localStorage
2. Sync theme across multiple editor windows
3. Add "system" theme option (follows OS)
4. Create custom theme colors for branding
5. Add high contrast mode for accessibility