# Implementation Plan: Persistent Claude Code Terminal

> Keep PTY terminal sessions alive when switching between editor panels

**Source Task:** `docs/task/persistent-claude-code-terminal.md`
**Estimated Effort:** ~25 minutes (3 subtasks)

---

## Subtask 1: CSS visibility toggle for PTY tab in MediaPanel

**File:** `apps/web/src/components/editor/media-panel/index.tsx`

**What to change:**

1. Remove `pty` from the `viewMap` object (line 73)
2. Always render `<PtyTerminalView />` in a persistent wrapper div **outside** the conditional `viewMap` render
3. Toggle the wrapper with `display: none` / `display: flex` based on `activeTab`
4. Guard non-pty tabs so they don't render when `activeTab === "pty"`

**Code (lines 78-88):**

```tsx
return (
  <div className="h-full flex flex-col bg-panel rounded-lg overflow-hidden" data-testid="media-panel">
    <GroupBar />
    <TabBar />
    {/* PTY terminal is always mounted, visibility toggled via CSS */}
    <div
      className="flex-1 min-h-0"
      style={{ display: activeTab === "pty" ? "flex" : "none" }}
    >
      <PtyTerminalView />
    </div>
    {activeTab !== "pty" && (
      <div className="flex-1 overflow-y-auto">{viewMap[activeTab]}</div>
    )}
  </div>
);
```

**Why `min-h-0`:** The PTY wrapper needs `min-h-0` to prevent flex overflow — same pattern used by the existing overflow-y-auto container. `flex-1` alone isn't enough in a flex column.

---

## Subtask 2: Remove kill-on-unmount, add route-level cleanup

### 2a. Remove PTY kill on unmount

**File:** `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` (lines 52-61)

Delete the entire cleanup `useEffect`:

```tsx
// DELETE THIS BLOCK:
useEffect(() => {
  return () => {
    const currentSessionId = usePtyTerminalStore.getState().sessionId;
    if (currentSessionId) {
      window.electronAPI?.pty?.kill(currentSessionId);
    }
    window.electronAPI?.pty?.removeListeners();
  };
}, []);
```

The PTY should NOT be killed on component unmount because the component now stays mounted. Kill only happens on explicit disconnect (button click) or editor route unmount.

### 2b. Remove terminal.dispose() on unmount

**File:** `apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx` (line 226)

In the cleanup function (lines 222-227), remove `terminal.dispose()`:

```tsx
// Before:
return () => {
  clearInterval(textareaCheckInterval);
  terminal.textarea?.removeEventListener("paste", handlePaste, true);
  window.electronAPI?.pty?.removeListeners();
  terminal.dispose();  // <-- REMOVE THIS
};

// After:
return () => {
  clearInterval(textareaCheckInterval);
  terminal.textarea?.removeEventListener("paste", handlePaste, true);
  window.electronAPI?.pty?.removeListeners();
};
```

**Note:** Since the `TerminalEmulator` is conditionally rendered (only when `isConnected || isConnecting`), it will still unmount when the user explicitly disconnects. The `removeListeners()` call stays to clean up IPC listeners on disconnect. The xterm instance will be garbage-collected when the component unmounts naturally on disconnect.

### 2c. Add route-level PTY cleanup

**File:** `apps/web/src/routes/editor.$project_id.lazy.tsx`

Add a `useEffect` cleanup in `EditorPage` that kills the PTY session when the user navigates away from the editor entirely:

```tsx
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";

// Inside EditorPage(), add:
useEffect(() => {
  return () => {
    const { sessionId, disconnect } = usePtyTerminalStore.getState();
    if (sessionId) {
      disconnect();
    }
  };
}, []);
```

This ensures PTY processes don't leak when navigating to the home page or another route.

---

## Subtask 3: Handle terminal resize on re-show

**File:** `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx`

**What to change:**

Pass `activeTab` to `PtyTerminalView` so it can trigger a resize when the terminal becomes visible again. Since the media panel store is already a Zustand store, we can read it directly.

**In `PtyTerminalView`**, add a resize effect:

```tsx
import { useMediaPanelStore } from "../../store";

// Inside PtyTerminalView component:
const activeTab = useMediaPanelStore((s) => s.activeTab);
```

**File:** `apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx`

**What to change:**

1. Accept an optional `isVisible` prop
2. When `isVisible` transitions to `true`, call `fitAddon.fit()` after a `requestAnimationFrame` delay

```tsx
interface TerminalEmulatorProps {
  sessionId: string | null;
  onReady?: () => void;
  isVisible?: boolean;  // NEW
}

// Add effect:
useEffect(() => {
  if (isVisible && fitAddonRef.current && terminalRef.current) {
    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
        if (terminalRef.current) {
          setDimensions(terminalRef.current.cols, terminalRef.current.rows);
          resize();
        }
      } catch {
        // Ignore fit errors if terminal not ready
      }
    });
  }
}, [isVisible, setDimensions, resize]);
```

**Why `requestAnimationFrame`:** The `display: none` → `display: flex` transition doesn't immediately update layout metrics. `rAF` waits one frame so the container has real dimensions before `fitAddon.fit()` measures them.

**Note:** The existing `ResizeObserver` (lines 230-262) won't fire when toggling `display: none` because the element has zero dimensions while hidden. The explicit `isVisible` prop handles this gap.

---

## Files Summary

| File | Change |
|------|--------|
| `apps/web/src/components/editor/media-panel/index.tsx` | Always mount PTY, CSS visibility toggle |
| `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` | Remove kill-on-unmount, subscribe to activeTab, pass isVisible |
| `apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx` | Remove dispose-on-unmount, add isVisible resize effect |
| `apps/web/src/routes/editor.$project_id.lazy.tsx` | Add route-level PTY cleanup on unmount |

---

## Test Plan

| Test Case | How to Verify |
|-----------|---------------|
| PTY session survives tab switch | Start terminal, switch to Media tab, switch back — output preserved |
| No duplicate PTY sessions | Switch tabs rapidly, check `ps aux \| grep claude` — only 1 process |
| PTY killed on editor route exit | Navigate to home page — PTY process should terminate |
| Terminal resizes after re-show | Hide terminal, resize window, show terminal — fits correctly |
| Explicit disconnect still works | Click Stop — PTY killed, terminal shows exit message |
| Window close cleanup | Close Electron window — no orphan PTY processes |

---

## Unit Tests

**File:** `apps/web/src/components/editor/media-panel/__tests__/persistent-terminal.test.tsx`

| Test | What it asserts |
|------|----------------|
| PTY not killed on tab switch | Mock `pty.kill`, switch tabs, assert NOT called |
| PTY killed on route unmount | Mount editor, unmount, assert `disconnect()` called |
| Terminal resize on visibility change | Set `isVisible` true, assert `fitAddon.fit()` called |
| No duplicate sessions on rapid switching | Rapid tab toggles, assert single `connect()` call |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Memory from always-mounted xterm | xterm is ~2MB; acceptable. Only the PTY tab is always-mounted. |
| Orphan PTY processes | Route-level cleanup + Electron `before-quit` handler (already exists in main.ts) |
| `ResizeObserver` loop warnings | The existing observer already handles this with try/catch |
