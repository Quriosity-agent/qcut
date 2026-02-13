# Fix: Claude Code Terminal — posix_spawnp Failed + Bridge Not Connected

> Two issues preventing Claude Code integration from working in QCut

**Fixed:** 2026-02-13
**Files Changed:** 3

---

## Problem 1: posix_spawnp failed

**Symptom:** Clicking "Start" on the Claude Code terminal panel shows `posix_spawnp failed` error. The PTY session never spawns.

**Root Cause:** node-pty@1.1.0 ships prebuilt native binaries compiled for standard Node.js (ABI 141). Electron 37 uses a different internal Node.js ABI. When Electron tried to use the prebuilt `pty.node` binary, the `posix_spawnp()` C system call failed because the native addon was ABI-incompatible.

**Debug output confirming the issue:**
```
[PTY] Shell: /bin/zsh
[PTY] CWD exists: true (/Users/peter/Desktop/code/qcut/qcut)
[PTY] which claude: /Users/peter/.local/bin/claude
[PTY] ===== SPAWN ERROR =====
[PTY] Error message: posix_spawnp failed.
[PTY] Error stack: Error: posix_spawnp failed.
    at new UnixTerminal (node-pty/lib/unixTerminal.js:92:24)
```

Shell, CWD, and claude binary all exist — the failure was at the native C++ level before the shell even started.

**Fix:** Rebuild node-pty for Electron's Node.js ABI:

```bash
npx electron-rebuild -f -w node-pty
```

This compiles `node_modules/node-pty/build/Release/pty.node` against Electron 37's headers. node-pty loads `build/Release/` in preference over `prebuilds/`, so the Electron-compatible binary is used.

**Note:** This rebuild must be re-run after:
- Upgrading Electron version
- Running `bun install` (which may overwrite the build)
- Switching between Node.js versions

---

## Problem 2: Claude Bridge Not Initialized

**Symptom:** The Claude HTTP API at `http://127.0.0.1:8765` times out on timeline/project requests. Requests that need renderer data (timeline export, project stats) hang for 5 seconds then fail.

**Root Cause:** The renderer-side bridge functions `setupClaudeTimelineBridge()` and `setupClaudeProjectBridge()` were defined in `apps/web/src/lib/claude-timeline-bridge.ts` but never called anywhere during app startup. Without these listeners, the IPC flow was broken:

```
Claude Code → HTTP server → Main process → IPC to renderer → NO LISTENER → timeout
```

**Fix:** Added `ClaudeInitializer` component to `apps/web/src/routes/__root.tsx`:

```tsx
function ClaudeInitializer() {
  useEffect(() => {
    setupClaudeTimelineBridge();
    setupClaudeProjectBridge();
    return () => {
      cleanupClaudeTimelineBridge();
      cleanupClaudeProjectBridge();
    };
  }, []);
  return null;
}
```

Mounted alongside the existing `RemotionInitializer` in the root route. Follows the same initialization pattern already used in the codebase.

**Confirmed working:** Console now shows:
```
[ClaudeTimelineBridge] Setting up bridge...
[ClaudeTimelineBridge] Bridge setup complete
```

---

## Files Changed

| File | Change |
|------|--------|
| `apps/web/src/routes/__root.tsx` | Added `ClaudeInitializer` component that calls bridge setup on mount |
| `electron/pty-handler.ts` | Added debug logging for spawn (shell, CWD, PATH, `which` lookup, error code) |
| `node_modules/node-pty/build/Release/pty.node` | Rebuilt via `electron-rebuild` (not committed) |

---

## Debug Logging Added

The PTY handler now logs detailed spawn info to the Electron main process terminal:

```
[PTY] Spawning: shell="/bin/zsh" args=["-c","claude --dangerously-skip-permissions"]
[PTY] CWD exists: true (/path/to/project)
[PTY] PATH preview: /usr/local/bin:/usr/bin:...
[PTY] which claude: /Users/peter/.local/bin/claude
```

On error, it also logs `Error code`, `errno`, `SHELL env`, and `Platform` for faster diagnosis.
