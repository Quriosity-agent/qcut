# PTY Terminal Implementation Plan

## Overview

Implement a full interactive PTY (pseudo-terminal) within QCut's media panel using `node-pty` for backend terminal emulation and `xterm.js` for frontend rendering. This enables users to run the Gemini CLI (`@google/gemini-cli`) directly within QCut with full terminal capabilities.

**Priority Hierarchy**: Long-term maintainability > scalability > performance > short-term gains

---

## Existing Patterns to Follow

The codebase already has a similar IPC streaming pattern in `geminiChat`:

**Handler Registration Pattern** (`electron/main.ts:66-74`):
```typescript
const { setupGeminiChatIPC } = require("./gemini-chat-handler.js");
// ... in app.whenReady():
setupGeminiChatIPC();
```

**Preload API Pattern** (`electron/preload.ts:313-324, 537-559`):
```typescript
// Interface
geminiChat: {
  send: (request) => Promise<{ success: boolean; error?: string }>;
  onStreamChunk: (callback) => void;
  onStreamComplete: (callback) => void;
  onStreamError: (callback) => void;
  removeListeners: () => void;
};

// Implementation uses ipcRenderer.invoke() and ipcRenderer.on()
```

**Handler IPC Pattern** (`electron/gemini-chat-handler.ts`):
- Uses `ipcMain.handle()` for request-response
- Uses `event.sender.send()` for streaming data to renderer
- Proper cleanup in `removeListeners()`

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                      Renderer Process                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              PTY Terminal Component                        │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │              xterm.js Terminal                       │  │  │
│  │  │  - Renders terminal output (ANSI colors, cursor)    │  │  │
│  │  │  - Captures keyboard input                          │  │  │
│  │  │  - Auto-fit to container                            │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                          │                                 │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │           pty-terminal-store.ts (Zustand)           │  │  │
│  │  │  - Session state (sessionId, isRunning, exitCode)   │  │  │
│  │  │  - Terminal dimensions (cols, rows)                 │  │  │
│  │  │  - Connection status                                │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │ IPC (via preload.ts)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Main Process                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              pty-handler.ts                                │  │
│  │  - spawn(): Create node-pty session                       │  │
│  │  - write(): Send keystrokes to PTY                        │  │
│  │  - resize(): Update terminal dimensions                   │  │
│  │  - kill(): Terminate session                              │  │
│  │                                                            │  │
│  │  Events (event.sender.send):                              │  │
│  │  - pty:data → Terminal output chunks                      │  │
│  │  - pty:exit → Session terminated                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              node-pty                                      │  │
│  │  - Spawns shell process (cmd.exe/bash/zsh)               │  │
│  │  - Manages PTY lifecycle                                  │  │
│  │  - Handles SIGTERM/SIGKILL                               │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Dependencies

### New Dependencies to Install

**Root package.json (Electron main process)**:
```json
{
  "dependencies": {
    "node-pty": "^1.0.0"
  }
}
```

**apps/web/package.json (Renderer process)**:
```json
{
  "dependencies": {
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-web-links": "^0.11.0"
  }
}
```

### Native Module Considerations

`node-pty` is a native Node.js addon that requires compilation:

```bash
# After installing node-pty, rebuild for Electron
npx electron-rebuild -f -w node-pty

# Or add to postinstall script in package.json
"postinstall": "electron-rebuild -f -w node-pty"
```

**electron-builder.json** additions:
```json
{
  "files": [
    "node_modules/node-pty/**/*"
  ],
  "asarUnpack": [
    "node_modules/node-pty/**/*"
  ]
}
```

---

## Subtasks

### Subtask 1: Install and Configure Dependencies

**Description**: Add node-pty and xterm.js packages with proper Electron native module support.

**Relevant Files**:
- `package.json` (ROOT - MODIFY, lines 234-246 for dependencies, lines 92-152 for build config)
- `apps/web/package.json` (MODIFY, lines 24-84 for dependencies)
- Note: No separate `electron-builder.json` - build config is inline in `package.json` under `"build"` key

**Implementation Steps**:

1. Install node-pty in root:
```bash
cd qcut/qcut
bun add node-pty
```

2. Install xterm in web app:
```bash
cd apps/web
bun add @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
```

3. Add electron-rebuild configuration:
```json
// package.json
{
  "scripts": {
    "postinstall": "electron-rebuild -f -w node-pty"
  }
}
```

4. Update build config in `package.json` (lines 92-152):
```json
// In "build.files" array (around line 102):
"node_modules/node-pty/**/*",

// In "build.asarUnpack" array (around line 145):
"**/node_modules/node-pty/**/*",

// In "build.extraResources" array (around line 130):
{
  "from": "node_modules/node-pty",
  "to": "node_modules/node-pty"
}
```

**Test Cases**:
- `bun install` completes without errors
- `bun run build:electron` succeeds
- Native module loads in packaged app

---

### Subtask 2: PTY IPC Handler (Main Process)

**Description**: Create Electron IPC handler for PTY operations using node-pty.

**Relevant Files**:
- `electron/pty-handler.ts` (NEW)
- `electron/main.ts` (MODIFY - lines 66-74 for imports, lines 364-370 for registration, lines 1259-1274 for cleanup)

**Implementation**:

```typescript
// electron/pty-handler.ts
import { ipcMain, BrowserWindow } from "electron";
import * as pty from "node-pty";
import { platform } from "os";

// ============================================================================
// Types
// ============================================================================

interface PtySession {
  id: string;
  process: pty.IPty;
  webContentsId: number;
}

interface SpawnOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  command?: string; // e.g., "npx @google/gemini-cli"
}

// ============================================================================
// Session Management
// ============================================================================

const sessions = new Map<string, PtySession>();

function generateSessionId(): string {
  return `pty-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function getShell(): string {
  if (platform() === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

// ============================================================================
// IPC Handlers
// ============================================================================

export function setupPtyIPC(): void {
  // Spawn a new PTY session
  ipcMain.handle(
    "pty:spawn",
    async (
      event,
      options: SpawnOptions = {}
    ): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
      try {
        const sessionId = generateSessionId();
        const shell = options.command ? "npx" : getShell();
        const args = options.command
          ? options.command.split(" ").slice(1) // ["@google/gemini-cli", ...]
          : [];

        console.log(`[PTY] Spawning session ${sessionId}`);
        console.log(`[PTY] Shell: ${shell}, Args: ${args.join(" ")}`);
        console.log(`[PTY] CWD: ${options.cwd || process.cwd()}`);

        const ptyProcess = pty.spawn(shell, args, {
          name: "xterm-256color",
          cols: options.cols || 80,
          rows: options.rows || 24,
          cwd: options.cwd || process.cwd(),
          env: process.env as { [key: string]: string },
        });

        const session: PtySession = {
          id: sessionId,
          process: ptyProcess,
          webContentsId: event.sender.id,
        };

        sessions.set(sessionId, session);

        // Forward PTY output to renderer
        ptyProcess.onData((data) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("pty:data", { sessionId, data });
          }
        });

        // Handle PTY exit
        ptyProcess.onExit(({ exitCode, signal }) => {
          console.log(
            `[PTY] Session ${sessionId} exited with code ${exitCode}`
          );
          if (!event.sender.isDestroyed()) {
            event.sender.send("pty:exit", { sessionId, exitCode, signal });
          }
          sessions.delete(sessionId);
        });

        return { success: true, sessionId };
      } catch (error: any) {
        console.error("[PTY] Spawn error:", error.message);
        return { success: false, error: error.message };
      }
    }
  );

  // Write data to PTY
  ipcMain.handle(
    "pty:write",
    async (
      _,
      sessionId: string,
      data: string
    ): Promise<{ success: boolean; error?: string }> => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: "Session not found" };
      }

      try {
        session.process.write(data);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }
  );

  // Resize PTY
  ipcMain.handle(
    "pty:resize",
    async (
      _,
      sessionId: string,
      cols: number,
      rows: number
    ): Promise<{ success: boolean; error?: string }> => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: "Session not found" };
      }

      try {
        session.process.resize(cols, rows);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }
  );

  // Kill PTY session
  ipcMain.handle(
    "pty:kill",
    async (
      _,
      sessionId: string
    ): Promise<{ success: boolean; error?: string }> => {
      const session = sessions.get(sessionId);
      if (!session) {
        return { success: false, error: "Session not found" };
      }

      try {
        session.process.kill();
        sessions.delete(sessionId);
        console.log(`[PTY] Session ${sessionId} killed`);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    }
  );

  // Kill all sessions (for cleanup on app quit)
  ipcMain.handle("pty:kill-all", async (): Promise<{ success: boolean }> => {
    for (const [sessionId, session] of sessions) {
      try {
        session.process.kill();
        console.log(`[PTY] Session ${sessionId} killed (cleanup)`);
      } catch {
        // Ignore errors during cleanup
      }
    }
    sessions.clear();
    return { success: true };
  });

  console.log("[PTY] Handler registered");
}

// Cleanup on app quit
export function cleanupPtySessions(): void {
  for (const [, session] of sessions) {
    try {
      session.process.kill();
    } catch {
      // Ignore
    }
  }
  sessions.clear();
}
```

**Registration in main.ts**:

```typescript
// Add import (after line 73, with other handler imports)
const { setupPtyIPC, cleanupPtySessions } = require("./pty-handler.js");

// Add to app.whenReady() (after line 370, after registerAIVideoHandlers)
setupPtyIPC(); // Add PTY terminal support

// Add cleanup in app.on("window-all-closed") (around line 1262, after other cleanup)
// Clean up PTY sessions
cleanupPtySessions();
```

**Note**: The codebase uses `app.on("window-all-closed")` for cleanup (lines 1259-1274), not `before-quit`.

**Test Cases**:
- `electron/pty-handler.test.ts` (NEW)
  - Test session spawn with default shell
  - Test session spawn with custom command (Gemini CLI)
  - Test write to session
  - Test resize
  - Test kill session
  - Test cleanup on app quit

---

### Subtask 3: Preload Script API

**Description**: Expose PTY IPC methods to renderer process via preload script.

**Relevant Files**:
- `electron/preload.ts` (MODIFY - lines 155-328 for interface, lines 331-563 for implementation)
- `apps/web/src/types/electron.d.ts` (MODIFY - add after geminiChat interface around line 395)

**Implementation**:

Add to `electron/preload.ts` interface (after line 324, after geminiChat interface):
```typescript
// PTY Terminal operations
pty: {
  spawn: (options?: {
    cols?: number;
    rows?: number;
    cwd?: string;
    command?: string;
  }) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
  write: (
    sessionId: string,
    data: string
  ) => Promise<{ success: boolean; error?: string }>;
  resize: (
    sessionId: string,
    cols: number,
    rows: number
  ) => Promise<{ success: boolean; error?: string }>;
  kill: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
  killAll: () => Promise<{ success: boolean }>;
  onData: (callback: (data: { sessionId: string; data: string }) => void) => void;
  onExit: (
    callback: (data: { sessionId: string; exitCode: number; signal?: number }) => void
  ) => void;
  removeListeners: () => void;
};
```

Add implementation (after line 559, after geminiChat implementation):
```typescript
// PTY Terminal operations
pty: {
  spawn: (options) => ipcRenderer.invoke("pty:spawn", options),
  write: (sessionId, data) => ipcRenderer.invoke("pty:write", sessionId, data),
  resize: (sessionId, cols, rows) =>
    ipcRenderer.invoke("pty:resize", sessionId, cols, rows),
  kill: (sessionId) => ipcRenderer.invoke("pty:kill", sessionId),
  killAll: () => ipcRenderer.invoke("pty:kill-all"),
  onData: (callback) => {
    ipcRenderer.on("pty:data", (_, data) => callback(data));
  },
  onExit: (callback) => {
    ipcRenderer.on("pty:exit", (_, data) => callback(data));
  },
  removeListeners: () => {
    ipcRenderer.removeAllListeners("pty:data");
    ipcRenderer.removeAllListeners("pty:exit");
  },
},
```

Add to `apps/web/src/types/electron.d.ts` (around line 395):
```typescript
/**
 * PTY Terminal operations
 * Enables full terminal emulation via node-pty
 */
pty?: {
  /**
   * Spawn a new PTY session
   */
  spawn: (options?: {
    cols?: number;
    rows?: number;
    cwd?: string;
    command?: string; // e.g., "npx @google/gemini-cli"
  }) => Promise<{ success: boolean; sessionId?: string; error?: string }>;

  /**
   * Write data to PTY (keyboard input)
   */
  write: (
    sessionId: string,
    data: string
  ) => Promise<{ success: boolean; error?: string }>;

  /**
   * Resize PTY dimensions
   */
  resize: (
    sessionId: string,
    cols: number,
    rows: number
  ) => Promise<{ success: boolean; error?: string }>;

  /**
   * Kill a PTY session
   */
  kill: (sessionId: string) => Promise<{ success: boolean; error?: string }>;

  /**
   * Kill all PTY sessions (cleanup)
   */
  killAll: () => Promise<{ success: boolean }>;

  /**
   * Register callback for PTY output data
   */
  onData: (
    callback: (data: { sessionId: string; data: string }) => void
  ) => void;

  /**
   * Register callback for PTY exit
   */
  onExit: (
    callback: (data: {
      sessionId: string;
      exitCode: number;
      signal?: number;
    }) => void
  ) => void;

  /**
   * Remove all PTY event listeners
   */
  removeListeners: () => void;
};
```

**Test Cases**:
- Verify TypeScript compilation succeeds
- Verify API is accessible via `window.electronAPI.pty`

---

### Subtask 4: Zustand Store for Terminal State

**Description**: Create a Zustand store to manage PTY terminal UI state.

**Relevant Files**:
- `apps/web/src/stores/pty-terminal-store.ts` (NEW)
- `apps/web/src/stores/gemini-terminal-store.ts` (REFERENCE - pattern)

**Implementation**:

```typescript
// apps/web/src/stores/pty-terminal-store.ts
import { create } from "zustand";

// ============================================================================
// Types
// ============================================================================

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface PtyTerminalState {
  // Session state
  sessionId: string | null;
  status: ConnectionStatus;
  exitCode: number | null;
  error: string | null;

  // Terminal dimensions
  cols: number;
  rows: number;

  // UI state
  isGeminiMode: boolean; // true = launch Gemini CLI, false = launch shell
  workingDirectory: string;
}

interface PtyTerminalActions {
  // Session management
  connect: (options?: { command?: string; cwd?: string }) => Promise<void>;
  disconnect: () => Promise<void>;

  // Dimension management
  setDimensions: (cols: number, rows: number) => void;
  resize: () => Promise<void>;

  // Mode management
  setGeminiMode: (enabled: boolean) => void;
  setWorkingDirectory: (dir: string) => void;

  // Internal state updates (called by IPC listeners)
  handleConnected: (sessionId: string) => void;
  handleDisconnected: (exitCode: number) => void;
  handleError: (error: string) => void;

  // Reset
  reset: () => void;
}

type PtyTerminalStore = PtyTerminalState & PtyTerminalActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: PtyTerminalState = {
  sessionId: null,
  status: "disconnected",
  exitCode: null,
  error: null,
  cols: 80,
  rows: 24,
  isGeminiMode: true,
  workingDirectory: "",
};

// ============================================================================
// Store
// ============================================================================

export const usePtyTerminalStore = create<PtyTerminalStore>((set, get) => ({
  ...initialState,

  connect: async (options = {}) => {
    const { isGeminiMode, workingDirectory, cols, rows } = get();

    set({ status: "connecting", error: null, exitCode: null });

    try {
      const command = isGeminiMode ? "npx @google/gemini-cli" : undefined;

      const result = await window.electronAPI?.pty?.spawn({
        cols,
        rows,
        cwd: options.cwd || workingDirectory || undefined,
        command: options.command || command,
      });

      if (result?.success && result.sessionId) {
        set({ sessionId: result.sessionId, status: "connected" });
      } else {
        set({
          status: "error",
          error: result?.error || "Failed to spawn PTY session",
        });
      }
    } catch (error: any) {
      set({ status: "error", error: error.message });
    }
  },

  disconnect: async () => {
    const { sessionId } = get();
    if (sessionId) {
      await window.electronAPI?.pty?.kill(sessionId);
    }
    set({ sessionId: null, status: "disconnected" });
  },

  setDimensions: (cols, rows) => {
    set({ cols, rows });
  },

  resize: async () => {
    const { sessionId, cols, rows } = get();
    if (sessionId) {
      await window.electronAPI?.pty?.resize(sessionId, cols, rows);
    }
  },

  setGeminiMode: (enabled) => {
    set({ isGeminiMode: enabled });
  },

  setWorkingDirectory: (dir) => {
    set({ workingDirectory: dir });
  },

  handleConnected: (sessionId) => {
    set({ sessionId, status: "connected" });
  },

  handleDisconnected: (exitCode) => {
    set({ sessionId: null, status: "disconnected", exitCode });
  },

  handleError: (error) => {
    set({ status: "error", error });
  },

  reset: () => {
    set(initialState);
  },
}));
```

**Test Cases**:
- `apps/web/src/stores/__tests__/pty-terminal-store.test.ts` (NEW)
  - Test initial state
  - Test connect/disconnect flow
  - Test dimension changes
  - Test mode switching
  - Test error handling

---

### Subtask 5: xterm.js Terminal Component

**Description**: Create React component wrapper for xterm.js terminal emulator.

**Relevant Files**:
- `apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx` (NEW)
- `apps/web/src/components/editor/media-panel/views/pty-terminal/index.tsx` (NEW)

**Implementation**:

```typescript
// apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx
"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";

interface TerminalEmulatorProps {
  sessionId: string | null;
  onReady?: () => void;
}

export function TerminalEmulator({ sessionId, onReady }: TerminalEmulatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const { setDimensions, resize } = usePtyTerminalStore();

  // Handle terminal output
  const handleData = useCallback(
    (data: { sessionId: string; data: string }) => {
      if (data.sessionId === sessionId && terminalRef.current) {
        terminalRef.current.write(data.data);
      }
    },
    [sessionId]
  );

  // Handle terminal exit
  const handleExit = useCallback(
    (data: { sessionId: string; exitCode: number }) => {
      if (data.sessionId === sessionId && terminalRef.current) {
        terminalRef.current.write(
          `\r\n\x1b[90m[Process exited with code ${data.exitCode}]\x1b[0m\r\n`
        );
      }
    },
    [sessionId]
  );

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    // Create terminal instance
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      theme: {
        background: "#1a1a1a",
        foreground: "#e0e0e0",
        cursor: "#ffffff",
        cursorAccent: "#000000",
        selectionBackground: "#5c5c5c",
        black: "#000000",
        red: "#e06c75",
        green: "#98c379",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#abb2bf",
        brightBlack: "#5c6370",
        brightRed: "#e06c75",
        brightGreen: "#98c379",
        brightYellow: "#e5c07b",
        brightBlue: "#61afef",
        brightMagenta: "#c678dd",
        brightCyan: "#56b6c2",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
    });

    // Load addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    // Open terminal in container
    terminal.open(containerRef.current);
    fitAddon.fit();

    // Store refs
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Update store with dimensions
    setDimensions(terminal.cols, terminal.rows);

    // Handle user input
    terminal.onData((data) => {
      if (sessionId) {
        window.electronAPI?.pty?.write(sessionId, data);
      }
    });

    // Setup IPC listeners
    window.electronAPI?.pty?.onData(handleData);
    window.electronAPI?.pty?.onExit(handleExit);

    // Notify ready
    onReady?.();

    // Cleanup
    return () => {
      window.electronAPI?.pty?.removeListeners();
      terminal.dispose();
    };
  }, [sessionId, handleData, handleExit, setDimensions, onReady]);

  // Handle resize
  useEffect(() => {
    if (!containerRef.current || !fitAddonRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit();
        setDimensions(terminalRef.current.cols, terminalRef.current.rows);
        resize();
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [setDimensions, resize]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      role="application"
      aria-label="Terminal emulator"
    />
  );
}
```

**Test Cases**:
- `apps/web/src/components/editor/media-panel/views/pty-terminal/__tests__/terminal-emulator.test.tsx` (NEW)
  - Test terminal initialization
  - Test data rendering
  - Test user input forwarding
  - Test resize handling
  - Test cleanup on unmount

---

### Subtask 6: PTY Terminal View Component

**Description**: Create the main view component that integrates terminal with controls.

**Relevant Files**:
- `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` (NEW)
- `apps/web/src/components/editor/media-panel/views/pty-terminal/index.tsx` (MODIFY)

**Implementation**:

```typescript
// apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx
"use client";

import { useEffect } from "react";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";
import { TerminalEmulator } from "./terminal-emulator";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Play,
  Square,
  RotateCcw,
  Terminal as TerminalIcon,
  Sparkles,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function PtyTerminalView() {
  const {
    sessionId,
    status,
    exitCode,
    error,
    isGeminiMode,
    connect,
    disconnect,
    setGeminiMode,
    reset,
  } = usePtyTerminalStore();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionId) {
        window.electronAPI?.pty?.kill(sessionId);
      }
      window.electronAPI?.pty?.removeListeners();
    };
  }, [sessionId]);

  const handleStart = async () => {
    await connect();
  };

  const handleStop = async () => {
    await disconnect();
  };

  const handleRestart = async () => {
    await disconnect();
    await connect();
  };

  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <div className="flex flex-col h-full">
      {/* Header Controls */}
      <div className="flex items-center justify-between p-2 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          {/* Mode Toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="gemini-mode"
              checked={isGeminiMode}
              onCheckedChange={setGeminiMode}
              disabled={isConnected || isConnecting}
              aria-label="Toggle Gemini CLI mode"
            />
            <Label
              htmlFor="gemini-mode"
              className="text-sm flex items-center gap-1"
            >
              {isGeminiMode ? (
                <>
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  Gemini CLI
                </>
              ) : (
                <>
                  <TerminalIcon className="h-3 w-3" aria-hidden="true" />
                  Shell
                </>
              )}
            </Label>
          </div>

          {/* Status Indicator */}
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                status === "connected" && "bg-green-500",
                status === "connecting" && "bg-yellow-500 animate-pulse",
                status === "disconnected" && "bg-gray-400",
                status === "error" && "bg-red-500"
              )}
              aria-hidden="true"
            />
            <span className="text-xs text-muted-foreground capitalize">
              {status}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          {!isConnected && !isConnecting && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleStart}
              aria-label="Start terminal session"
            >
              <Play className="h-4 w-4 mr-1" aria-hidden="true" />
              Start
            </Button>
          )}

          {isConnecting && (
            <Button type="button" variant="outline" size="sm" disabled>
              <Loader2
                className="h-4 w-4 mr-1 animate-spin"
                aria-hidden="true"
              />
              Connecting...
            </Button>
          )}

          {isConnected && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRestart}
                aria-label="Restart terminal session"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleStop}
                aria-label="Stop terminal session"
              >
                <Square className="h-4 w-4 mr-1" aria-hidden="true" />
                Stop
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-2 bg-destructive/10 border-b border-destructive/20">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Exit Code Display */}
      {exitCode !== null && status === "disconnected" && (
        <div className="p-2 bg-muted/50 border-b">
          <p className="text-sm text-muted-foreground">
            Process exited with code {exitCode}
          </p>
        </div>
      )}

      {/* Terminal Area */}
      <div className="flex-1 bg-[#1a1a1a] overflow-hidden">
        {isConnected || isConnecting ? (
          <TerminalEmulator sessionId={sessionId} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <TerminalIcon className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-sm">
              {isGeminiMode
                ? "Click Start to launch Gemini CLI"
                : "Click Start to open a terminal"}
            </p>
            {isGeminiMode && (
              <p className="text-xs mt-1 opacity-70">
                Requires Google account authentication
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Barrel export**:
```typescript
// apps/web/src/components/editor/media-panel/views/pty-terminal/index.tsx
export { PtyTerminalView } from "./pty-terminal-view";
export { TerminalEmulator } from "./terminal-emulator";
```

**Test Cases**:
- `apps/web/src/components/editor/media-panel/views/pty-terminal/__tests__/pty-terminal-view.test.tsx` (NEW)
  - Test start/stop buttons
  - Test mode toggle
  - Test status indicator
  - Test error display
  - Test accessibility attributes

---

### Subtask 7: Media Panel Tab Registration

**Description**: Register PTY Terminal as a new tab in the media panel (separate from existing Gemini chat).

**Relevant Files**:
- `apps/web/src/components/editor/media-panel/store.ts` (MODIFY - lines 24-42 for Tab type, lines 44-117 for tabs object)
- `apps/web/src/components/editor/media-panel/index.tsx` (MODIFY - lines 1-21 for imports, lines 35-70 for viewMap)

**Note**: The "gemini" tab already exists (lines 42, 113-116). The PTY terminal will be a separate "pty" tab.

**Implementation**:

1. Add to Tab type in `store.ts` (line 42, before the semicolon):
```typescript
export type Tab =
  | "media"
  // ... existing tabs ...
  | "gemini"
  | "pty";  // NEW - add after "gemini"
```

2. Add icon import in `store.ts` (line 20, with other lucide imports):
```typescript
import {
  // ... existing imports ...
  TerminalSquareIcon,  // NEW
} from "lucide-react";
```

3. Add to tabs object in `store.ts` (after line 116, after gemini):
```typescript
  pty: {
    icon: TerminalSquareIcon,
    label: "Terminal",
  },
```

4. Add import in `index.tsx` (after line 19, after GeminiTerminalView):
```typescript
import { PtyTerminalView } from "./views/pty-terminal";
```

5. Add to viewMap in `index.tsx` (after line 69, after gemini):
```typescript
  pty: <PtyTerminalView />,
```

**Test Cases**:
- Verify new tab appears in tabbar
- Verify tab icon displays correctly
- Verify switching to tab renders PtyTerminalView

---

### Subtask 8: CSS Styles for xterm.js

**Description**: Add necessary CSS imports and custom styles for terminal appearance.

**Relevant Files**:
- `apps/web/src/index.css` (MODIFY)
- `apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx` (VERIFY import)

**Implementation**:

Add to `apps/web/src/index.css`:
```css
/* xterm.js terminal styles */
.xterm {
  height: 100%;
  width: 100%;
}

.xterm-viewport {
  overflow-y: auto !important;
}

/* Custom scrollbar for terminal */
.xterm-viewport::-webkit-scrollbar {
  width: 8px;
}

.xterm-viewport::-webkit-scrollbar-track {
  background: #1a1a1a;
}

.xterm-viewport::-webkit-scrollbar-thumb {
  background: #3a3a3a;
  border-radius: 4px;
}

.xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: #4a4a4a;
}
```

**Note**: The main xterm.css is imported directly in the component file.

---

### Subtask 9: Unit Tests

**Description**: Create comprehensive unit tests for all new components.

**Relevant Files**:
- `apps/web/src/stores/__tests__/pty-terminal-store.test.ts` (NEW)
- `apps/web/src/components/editor/media-panel/views/pty-terminal/__tests__/pty-terminal-view.test.tsx` (NEW)
- `apps/web/src/components/editor/media-panel/views/pty-terminal/__tests__/terminal-emulator.test.tsx` (NEW)

**Test Implementation**:

```typescript
// apps/web/src/stores/__tests__/pty-terminal-store.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePtyTerminalStore } from "../pty-terminal-store";

// Mock window.electronAPI
const mockPty = {
  spawn: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  killAll: vi.fn(),
  onData: vi.fn(),
  onExit: vi.fn(),
  removeListeners: vi.fn(),
};

vi.stubGlobal("window", {
  electronAPI: { pty: mockPty },
});

describe("usePtyTerminalStore", () => {
  beforeEach(() => {
    usePtyTerminalStore.getState().reset();
    vi.clearAllMocks();
  });

  it("should have correct initial state", () => {
    const state = usePtyTerminalStore.getState();
    expect(state.sessionId).toBeNull();
    expect(state.status).toBe("disconnected");
    expect(state.isGeminiMode).toBe(true);
  });

  it("should connect and update status", async () => {
    mockPty.spawn.mockResolvedValue({
      success: true,
      sessionId: "test-session-123",
    });

    await usePtyTerminalStore.getState().connect();

    expect(usePtyTerminalStore.getState().status).toBe("connected");
    expect(usePtyTerminalStore.getState().sessionId).toBe("test-session-123");
  });

  it("should handle connection error", async () => {
    mockPty.spawn.mockResolvedValue({
      success: false,
      error: "Failed to spawn",
    });

    await usePtyTerminalStore.getState().connect();

    expect(usePtyTerminalStore.getState().status).toBe("error");
    expect(usePtyTerminalStore.getState().error).toBe("Failed to spawn");
  });

  it("should disconnect and cleanup", async () => {
    usePtyTerminalStore.setState({ sessionId: "test-session", status: "connected" });

    await usePtyTerminalStore.getState().disconnect();

    expect(mockPty.kill).toHaveBeenCalledWith("test-session");
    expect(usePtyTerminalStore.getState().status).toBe("disconnected");
  });

  it("should toggle Gemini mode", () => {
    expect(usePtyTerminalStore.getState().isGeminiMode).toBe(true);

    usePtyTerminalStore.getState().setGeminiMode(false);

    expect(usePtyTerminalStore.getState().isGeminiMode).toBe(false);
  });
});
```

```typescript
// apps/web/src/components/editor/media-panel/views/pty-terminal/__tests__/pty-terminal-view.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PtyTerminalView } from "../pty-terminal-view";
import { usePtyTerminalStore } from "@/stores/pty-terminal-store";

// Mock xterm.js
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    cols: 80,
    rows: 24,
  })),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  })),
}));

describe("PtyTerminalView", () => {
  beforeEach(() => {
    usePtyTerminalStore.getState().reset();
  });

  it("should render start button when disconnected", () => {
    render(<PtyTerminalView />);
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
  });

  it("should show Gemini CLI mode by default", () => {
    render(<PtyTerminalView />);
    expect(screen.getByText(/gemini cli/i)).toBeInTheDocument();
  });

  it("should toggle mode when switch is clicked", () => {
    render(<PtyTerminalView />);
    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);
    expect(screen.getByText(/shell/i)).toBeInTheDocument();
  });

  it("should show stop button when connected", () => {
    usePtyTerminalStore.setState({ status: "connected", sessionId: "test" });
    render(<PtyTerminalView />);
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });

  it("should display error message", () => {
    usePtyTerminalStore.setState({ status: "error", error: "Connection failed" });
    render(<PtyTerminalView />);
    expect(screen.getByText(/connection failed/i)).toBeInTheDocument();
  });
});
```

---

### Subtask 10: Documentation Update

**Description**: Update project documentation with PTY terminal usage.

**Relevant Files**:
- `CLAUDE.md` (MODIFY)
- `docs/issues/gemini-terminal-ui-implementation.md` (MODIFY)

**Documentation to add**:

```markdown
## PTY Terminal

QCut includes a full PTY (pseudo-terminal) that can run:
- **Gemini CLI**: Google's AI coding assistant (`@google/gemini-cli`)
- **System Shell**: Direct terminal access (cmd.exe/bash)

### Usage

1. Open the **Terminal** tab in the media panel
2. Toggle between **Gemini CLI** or **Shell** mode
3. Click **Start** to launch the session
4. Interact with the terminal as normal
5. Click **Stop** to terminate the session

### Technical Details

- Uses `node-pty` for PTY emulation in Electron main process
- Uses `xterm.js` for terminal rendering in React
- Full ANSI color and escape sequence support
- Automatic terminal resizing
```

---

## Implementation Order

1. **Subtask 1**: Dependencies (foundation)
2. **Subtask 2**: PTY Handler (backend)
3. **Subtask 3**: Preload Script (IPC bridge)
4. **Subtask 4**: Zustand Store (state management)
5. **Subtask 5**: Terminal Emulator Component (xterm.js)
6. **Subtask 8**: CSS Styles (visual polish)
7. **Subtask 6**: PTY Terminal View (main UI)
8. **Subtask 7**: Tab Registration (integration)
9. **Subtask 9**: Unit Tests (quality assurance)
10. **Subtask 10**: Documentation (maintainability)

---

## Estimated Effort

| Subtask | Estimated Time |
|---------|----------------|
| 1. Dependencies | 15 min |
| 2. PTY Handler | 45 min |
| 3. Preload Script | 20 min |
| 4. Zustand Store | 30 min |
| 5. Terminal Emulator | 45 min |
| 6. PTY Terminal View | 40 min |
| 7. Tab Registration | 10 min |
| 8. CSS Styles | 10 min |
| 9. Unit Tests | 60 min |
| 10. Documentation | 15 min |
| **Total** | **~5 hours** |

---

## Risk Mitigation

### Native Module Compilation

**Risk**: `node-pty` requires native compilation which may fail on some systems.

**Mitigation**:
- Use `electron-rebuild` in postinstall script
- Add prebuild binaries via `prebuild-install` if needed
- Document Windows Build Tools requirement for Windows users

### Gemini CLI Authentication

**Risk**: Gemini CLI requires OAuth flow which opens browser.

**Mitigation**:
- Document first-run OAuth requirement
- Handle auth failures gracefully with clear error messages
- Offer fallback to SDK mode (existing implementation)

### Performance

**Risk**: High-frequency terminal output may cause UI lag.

**Mitigation**:
- xterm.js handles buffering internally
- Use `requestAnimationFrame` for batched updates if needed
- Terminal viewport virtualization (built into xterm.js)

---

## Future Enhancements

1. **Multiple Sessions**: Tab-based terminal management
2. **Session Persistence**: Restore terminal state on app restart
3. **Custom Themes**: User-configurable terminal colors
4. **Copy/Paste**: Clipboard integration with Ctrl+C/V
5. **Search**: Find text in terminal history (xterm-addon-search)
6. **Split View**: Side-by-side terminals
7. **Media Integration**: Drag media files into terminal for Gemini analysis

---

## Related Files Summary

| File | Action | Key Lines | Purpose |
|------|--------|-----------|---------|
| `package.json` | MODIFY | 234-246 (deps), 92-152 (build) | Add node-pty dependency, configure bundling |
| `apps/web/package.json` | MODIFY | 24-84 | Add xterm.js dependencies |
| `electron/pty-handler.ts` | NEW | - | PTY IPC handlers |
| `electron/main.ts` | MODIFY | 66-74, 364-370, 1259-1274 | Import, register, cleanup |
| `electron/preload.ts` | MODIFY | 155-328 (interface), 331-563 (impl) | Expose PTY API |
| `apps/web/src/types/electron.d.ts` | MODIFY | after ~395 | TypeScript definitions |
| `apps/web/src/stores/pty-terminal-store.ts` | NEW | - | Terminal state management |
| `apps/web/src/components/editor/media-panel/views/pty-terminal/` | NEW | - | UI components |
| `apps/web/src/components/editor/media-panel/store.ts` | MODIFY | 20-21, 42, 116-117 | Import icon, add Tab type, add tabs entry |
| `apps/web/src/components/editor/media-panel/index.tsx` | MODIFY | 19-20, 69-70 | Import view, add to viewMap |
| `apps/web/src/index.css` | MODIFY | end of file | Terminal styles |
