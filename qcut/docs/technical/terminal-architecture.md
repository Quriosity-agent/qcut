# Terminal System Architecture

This document describes QCut's integrated terminal system, which provides full PTY (pseudo-terminal) emulation for running shell commands and the Gemini CLI.

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              xterm.js Terminal                       │    │
│  │  - Renders ANSI output (colors, cursor, etc.)       │    │
│  │  - Captures keyboard input                          │    │
│  │  - Auto-fits to container via FitAddon              │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │           pty-terminal-store.ts (Zustand)           │    │
│  │  - sessionId, status, cols, rows                    │    │
│  │  - isGeminiMode, activeSkill                        │    │
│  └──────────────────────┬──────────────────────────────┘    │
└─────────────────────────┼───────────────────────────────────┘
                          │ IPC (preload.ts)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     Main Process                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              pty-handler.ts                          │    │
│  │  - Session management (Map<sessionId, PtySession>)  │    │
│  │  - Spawn, write, resize, kill operations            │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │              node-pty                                │    │
│  │  - Spawns shell (cmd.exe / bash / zsh)             │    │
│  │  - Manages PTY lifecycle                            │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. PTY Handler (`electron/pty-handler.ts`)

The main process handler that manages PTY sessions using `node-pty`.

**IPC Channels:**
| Channel | Direction | Description |
|---------|-----------|-------------|
| `pty:spawn` | invoke | Create new PTY session |
| `pty:write` | invoke | Send keystrokes to PTY |
| `pty:resize` | invoke | Update terminal dimensions |
| `pty:kill` | invoke | Terminate session |
| `pty:kill-all` | invoke | Cleanup all sessions |
| `pty:data` | send | Terminal output (main → renderer) |
| `pty:exit` | send | Session terminated (main → renderer) |

**Session Management:**
```typescript
interface PtySession {
  id: string;                    // Unique session ID
  process: IPty;                 // node-pty process
  webContentsId: number;         // Associated renderer
}

// Sessions stored in Map for quick lookup
const sessions = new Map<string, PtySession>();
```

**Shell Detection:**
- Windows: `process.env.COMSPEC` or `cmd.exe`
- Unix/Mac: `process.env.SHELL` or `/bin/bash`

### 2. Terminal Store (`apps/web/src/stores/pty-terminal-store.ts`)

Zustand store managing terminal UI state.

**State:**
```typescript
interface PtyTerminalState {
  sessionId: string | null;
  status: "disconnected" | "connecting" | "connected" | "error";
  exitCode: number | null;
  error: string | null;
  cols: number;              // Terminal width
  rows: number;              // Terminal height
  isGeminiMode: boolean;     // true = Gemini CLI, false = shell
  workingDirectory: string;
  activeSkill: ActiveSkillContext | null;  // For skill runner
}
```

**Key Actions:**
- `connect()` - Spawn new PTY session
- `disconnect()` - Kill current session
- `resize()` - Update PTY dimensions
- `setGeminiMode()` - Toggle between Gemini CLI and shell
- `setActiveSkill()` - Set skill context for Gemini CLI

### 3. Terminal Emulator (`apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx`)

React component wrapping xterm.js.

**Features:**
- ANSI color support (xterm-256color)
- Web link detection (WebLinksAddon)
- Auto-resize (FitAddon + ResizeObserver)
- Clipboard support (Ctrl+C/V handling)

**Theme:** One Dark inspired colors matching editor aesthetics.

## Data Flow

### 1. User Types in Terminal
```
[Keyboard Input] → xterm.onData() → pty:write IPC → node-pty.write()
```

### 2. Process Outputs Text
```
node-pty.onData() → pty:data IPC → store callback → xterm.write()
```

### 3. Terminal Resize
```
ResizeObserver → FitAddon.fit() → store.setDimensions() → pty:resize IPC → node-pty.resize()
```

### 4. Process Exits
```
node-pty.onExit() → pty:exit IPC → store.handleDisconnected() → UI update
```

## Operating Modes

### Shell Mode (`isGeminiMode: false`)
Launches the system shell directly:
- Windows: `cmd.exe`
- Unix/Mac: User's default shell with login flag (`-l`)

### Gemini CLI Mode (`isGeminiMode: true`)
Launches Google's Gemini CLI:
```bash
npx @google/gemini-cli@latest
```

Requires Google OAuth authentication on first use.

## Skill Runner Integration

Skills can be executed via Gemini CLI with context injection:

1. User clicks "Run" on a skill card
2. Store sets `activeSkill` with skill content
3. Terminal connects in Gemini mode
4. After 2s delay (CLI initialization), skill prompt is sent
5. Gemini CLI receives instructions and is ready to assist

```typescript
// Skill prompt format
`I'm using the "${skill.name}" skill. Here are the instructions:
${skill.content}
Please acknowledge and help with tasks using this skill.`
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| PTY not available | Show "only in desktop app" error |
| Spawn failure | Display error message, allow retry |
| Session lost | Auto-cleanup via `web-contents-created` listener |
| App quit | `cleanupPtySessions()` kills all sessions |

## Native Module Notes

`node-pty` requires native compilation:

```bash
# Rebuild for Electron
npx electron-rebuild -f -w node-pty
```

**Packaged App Loading:**
```typescript
// Try standard path first
pty = require("node-pty");

// Fallback to extraResources in packaged app
const modulePath = path.join(process.resourcesPath, "node_modules/node-pty");
pty = require(modulePath);
```

## Related Files

| File | Purpose |
|------|---------|
| `electron/pty-handler.ts` | Main process IPC handlers |
| `electron/preload.ts` | Exposes `window.electronAPI.pty` |
| `apps/web/src/stores/pty-terminal-store.ts` | Terminal state management |
| `apps/web/src/components/editor/media-panel/views/pty-terminal/` | UI components |
| `apps/web/src/types/electron.d.ts` | TypeScript definitions |
