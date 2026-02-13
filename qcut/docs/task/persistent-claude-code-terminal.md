# Persistent Claude Code Terminal

> Keep Claude Code terminal sessions alive when switching between editor panels

**Created:** 2026-02-13
**Priority:** High — Current behavior kills active Claude Code agents on panel switch
**Estimated Effort:** ~25 minutes (3 subtasks)

---

## Problem

When a user switches from the Claude Code (PTY) panel to another panel (e.g., Media, AI), the terminal session is **destroyed**:

1. `PtyTerminalView` unmounts → `window.electronAPI.pty.kill(sessionId)` fires
2. `TerminalEmulator` unmounts → `terminal.dispose()` destroys xterm instance
3. All output, scroll history, and the running Claude Code process are lost

**Expected:** Switching back to the Claude Code panel should show the agent still running with full output history preserved.

---

## Root Cause

`MediaPanel` renders panels via conditional switching:

```tsx
// apps/web/src/components/editor/media-panel/index.tsx (line 86)
{viewMap[activeTab]}
```

Only the active tab's component is mounted. React unmounts the previous component, triggering cleanup effects that kill the PTY session and dispose xterm.

---

## Solution: CSS Visibility Toggle + Persistent Mount

Instead of conditional rendering (`viewMap[activeTab]`), mount the PTY terminal once and toggle visibility with CSS. Non-active panels use `display: none` which keeps the DOM alive, preserving xterm state and the PTY process.

**Why this approach:**
- xterm.js requires a live DOM node — it cannot serialize/restore terminal state
- PTY sessions are OS processes; reconnecting after kill requires protocol-level session management (overkill)
- CSS `display: none` is the standard approach used by VS Code, Hyper, and other terminal apps

---

## Subtasks

### Subtask 1: Keep PTY terminal mounted with CSS visibility toggle

**Files:**
- `apps/web/src/components/editor/media-panel/index.tsx` (lines 36-89)

**Changes:**
1. Extract the PTY terminal view out of the `viewMap` conditional render
2. Always render `<PtyTerminalView />` in a wrapper div
3. Toggle wrapper div visibility: `display: none` when `activeTab !== "pty"`, `display: flex` when active
4. Keep all other tabs in the existing `viewMap` conditional render (no behavior change for non-terminal panels)

```tsx
// Before (line 86):
{viewMap[activeTab]}

// After:
<div style={{ display: activeTab === 'pty' ? 'flex' : 'none', flex: 1 }}>
  <PtyTerminalView />
</div>
{activeTab !== 'pty' && viewMap[activeTab]}
```

**Test:**
- Switch from PTY to Media tab and back — terminal output should persist
- Verify no duplicate PTY sessions spawn

---

### Subtask 2: Remove PTY kill-on-unmount, add kill-on-explicit-disconnect only

**Files:**
- `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` (lines 52-61)
- `apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx` (lines 222-227)

**Changes:**
1. In `PtyTerminalView`, remove the cleanup effect that kills PTY on unmount (lines 52-61). The PTY should only be killed when the user explicitly disconnects or navigates away from the editor route entirely.
2. In `TerminalEmulator`, remove `terminal.dispose()` from unmount cleanup (line 226). The terminal instance should persist in the DOM.
3. Add a route-level cleanup: kill PTY when the editor route unmounts (user leaves the editor entirely), not on tab switch.

**Route-level cleanup location:**
- `apps/web/src/routes/editor.$project_id.tsx` or the lazy-loaded variant — add an effect that calls `pty.kill()` on route unmount

**Test:**
- Switch tabs repeatedly — no PTY processes should accumulate (check via `ps aux | grep claude`)
- Navigate away from editor entirely — PTY session should be cleaned up
- Close the Electron window — PTY session should be cleaned up

---

### Subtask 3: Handle terminal resize on re-show

**Files:**
- `apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx` (lines 61-228)
- `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx`

**Changes:**
1. When the PTY tab becomes active again (`display: none` → `display: flex`), xterm's FitAddon needs to recalculate dimensions since the container was hidden.
2. Add a `ResizeObserver` or listen to `activeTab` changes to call `fitAddon.fit()` when the terminal container becomes visible again.
3. After fitting, send the new dimensions to the PTY process via `window.electronAPI.pty.resize(cols, rows)`.

```tsx
// In TerminalEmulator or PtyTerminalView:
useEffect(() => {
  if (activeTab === 'pty' && fitAddonRef.current) {
    // Small delay to let the DOM layout recalculate after display change
    requestAnimationFrame(() => {
      fitAddonRef.current.fit();
    });
  }
}, [activeTab]);
```

**Test:**
- Switch away from terminal, resize the editor window, switch back — terminal should fit correctly
- Verify no visual glitches (blank areas, scrollbar issues) after re-show

---

## Files Summary

| File | Change |
|------|--------|
| `apps/web/src/components/editor/media-panel/index.tsx` | Always mount PTY, CSS visibility toggle |
| `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` | Remove kill-on-unmount cleanup |
| `apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx` | Remove dispose-on-unmount, add resize-on-show |
| `apps/web/src/routes/editor.$project_id.tsx` | Add route-level PTY cleanup |
| `apps/web/src/components/editor/media-panel/store.ts` | No changes needed (activeTab already available) |

---

## Unit Tests

| Test Case | File |
|-----------|------|
| PTY session survives tab switch | `apps/web/src/components/editor/media-panel/__tests__/persistent-terminal.test.tsx` |
| PTY session killed on editor route unmount | `apps/web/src/components/editor/media-panel/__tests__/persistent-terminal.test.tsx` |
| Terminal resizes correctly after re-show | `apps/web/src/components/editor/media-panel/__tests__/persistent-terminal.test.tsx` |
| No duplicate PTY sessions on rapid tab switching | `apps/web/src/components/editor/media-panel/__tests__/persistent-terminal.test.tsx` |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Memory usage from always-mounted xterm | xterm is lightweight (~2MB); acceptable tradeoff |
| Orphan PTY processes | Route-level cleanup + `beforeunload` handler in Electron main |
| Other terminals (Gemini) expecting same behavior | Only apply to PTY tab initially; extend to Gemini later if requested |

---

## Out of Scope

- Session persistence across page reloads (would require terminal session serialization)
- Multiple concurrent terminal tabs
- Detachable/floating terminal windows
