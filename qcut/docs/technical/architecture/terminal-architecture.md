# Terminal System Architecture

This document describes QCut's integrated terminal system, which provides full PTY (pseudo-terminal) emulation for running shell commands and multiple AI coding agents (Gemini CLI, Codex via OpenRouter, Claude Code).

## Overview

```text
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
│  │  - cliProvider, selectedModel, selectedClaudeModel  │    │
│  │  - activeSkill, skillPromptSent                     │    │
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
| `pty:data` | send | Terminal output (main -> renderer) |
| `pty:exit` | send | Session terminated (main -> renderer) |

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

**SpawnOptions:**
```typescript
interface SpawnOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  command?: string;                    // e.g., "npx @google/gemini-cli" or "claude --dangerously-skip-permissions"
  env?: Record<string, string>;        // Additional environment variables (e.g., OPENROUTER_API_KEY)
}
```

**Shell Detection:**
- Windows: `process.env.COMSPEC` or `cmd.exe`
- Unix/Mac: `process.env.SHELL` or `/bin/bash`

### 2. CLI Provider Type (`apps/web/src/types/cli-provider.ts`)

Defines the supported CLI providers and their configurations.

```typescript
type CliProvider = "gemini" | "codex" | "claude" | "shell";

interface CliProviderConfig {
  id: CliProvider;
  name: string;                    // Human-readable name
  description: string;
  command: string;                 // Command to spawn the CLI
  requiresApiKey: boolean;
  apiKeyEnvVar?: string;           // Environment variable name for API key
  supportsSkillFlag: boolean;      // Whether provider supports skill injection via flag
  skillFlagFormat?: string;        // e.g., "--project-doc" or "--append-system-prompt"
}
```

**Provider configurations:**
| Provider | Name | Command | API Key | Skill Injection |
|----------|------|---------|---------|-----------------|
| `gemini` | Gemini CLI | `npx @google/gemini-cli@latest` | No (OAuth) | Prompt injection (delayed write) |
| `codex` | Codex (OpenRouter) | `npx open-codex` | Yes (`OPENROUTER_API_KEY`) | `--project-doc` flag |
| `claude` | Claude Code | `claude` | Optional (`ANTHROPIC_API_KEY`) | `--append-system-prompt` flag |
| `shell` | Shell | (default shell) | No | N/A |

### 3. Terminal Store (`apps/web/src/stores/pty-terminal-store.ts`)

Zustand store managing terminal UI state.

**State:**
```typescript
interface PtyTerminalState {
  // Session state
  sessionId: string | null;
  status: "disconnected" | "connecting" | "connected" | "error";
  exitCode: number | null;
  error: string | null;

  // Terminal dimensions
  cols: number;                         // Terminal width (default 80)
  rows: number;                         // Terminal height (default 24)

  // CLI provider state
  cliProvider: CliProvider;             // Active provider (default "claude")
  selectedModel: string | null;         // For Codex/OpenRouter model selection
  selectedClaudeModel: string | null;   // For Claude Code model selection

  // Legacy compatibility
  isGeminiMode: boolean;               // Derived from cliProvider for backward compatibility

  // Project context
  projectId: string | null;
  workingDirectory: string;
  autoConnectOnLoad: boolean;           // Auto-connect terminal on project load
  hasUserDisconnected: boolean;         // Tracks if user manually disconnected
  autoConnectAttemptedProjectId: string | null;  // Prevents duplicate auto-connects

  // Skill context (for running skills with CLI agents)
  activeSkill: ActiveSkillContext | null;
  skillPromptSent: boolean;            // Track if initial skill prompt was sent
}
```

**Key Actions:**
| Action | Description |
|--------|-------------|
| `connect(options?)` | Spawn new PTY session with optional `ConnectOptions` |
| `disconnect(options?)` | Kill current session, optionally mark as user-initiated |
| `ensureAutoConnected(options?)` | Auto-connect if enabled and not already connected |
| `setCliProvider(provider)` | Switch between CLI providers (also updates `isGeminiMode`) |
| `setSelectedModel(modelId)` | Set model for Codex/OpenRouter |
| `setSelectedClaudeModel(modelId)` | Set model for Claude Code CLI |
| `setProjectContext({projectId, workingDirectory?})` | Set project context, resets auto-connect on project change |
| `setAutoConnectOnLoad(enabled)` | Enable/disable auto-connect on project load |
| `resize()` | Update PTY dimensions |
| `setGeminiMode(enabled)` | Legacy: toggle between Gemini CLI and shell |
| `setActiveSkill(skill)` | Set skill context for CLI agents |
| `clearSkillContext()` | Clear active skill and reset prompt state |
| `sendSkillPrompt()` | Send skill prompt to Gemini CLI (prompt injection) |

### 4. Terminal Emulator (`apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx`)

React component wrapping xterm.js.

**Features:**
- ANSI color support (xterm-256color)
- Web link detection (WebLinksAddon)
- Auto-resize (FitAddon + ResizeObserver)
- Clipboard support (Ctrl+C/V handling)

**Theme:** One Dark inspired colors matching editor aesthetics.

## Data Flow

### 1. User Types in Terminal
```text
[Keyboard Input] → xterm.onData() → pty:write IPC → node-pty.write()
```

### 2. Process Outputs Text
```text
node-pty.onData() → pty:data IPC → store callback → xterm.write()
```

### 3. Terminal Resize
```text
ResizeObserver → FitAddon.fit() → store.setDimensions() → pty:resize IPC → node-pty.resize()
```

### 4. Process Exits
```text
node-pty.onExit() → pty:exit IPC → store.handleDisconnected() → UI update
```

## Operating Modes

The terminal supports four operating modes via the `CliProvider` type:

### Shell Mode (`cliProvider: "shell"`)
Launches the system shell directly:
- Windows: `cmd.exe`
- Unix/Mac: User's default shell with login flag (`-l`)

### Gemini CLI Mode (`cliProvider: "gemini"`)
Launches Google's Gemini CLI:
```bash
npx @google/gemini-cli@latest
```
Requires Google OAuth authentication on first use. Skills are injected via delayed prompt write (2s after connection).

### Codex Mode (`cliProvider: "codex"`)
Launches OpenRouter-backed Codex CLI:
```bash
npx open-codex --provider openrouter --model <selectedModel>
```
Requires an OpenRouter API key configured in Settings. Supports 300+ models. Skills are injected at spawn time via `--project-doc` flag pointing to the skill's markdown file.

### Claude Code Mode (`cliProvider: "claude"`)
Launches Anthropic's Claude Code CLI:
```bash
claude --dangerously-skip-permissions --model <selectedClaudeModel>
```
Uses Claude Pro/Max subscription by default (login authentication). An Anthropic API key is optional and will be passed as `ANTHROPIC_API_KEY` if configured. Sets `QCUT_PROJECT_ID`, `QCUT_PROJECT_ROOT`, and `QCUT_API_BASE_URL` environment variables for project context. Claude has direct access to read skill files from the project directory.

### Legacy Compatibility

The `isGeminiMode` boolean is derived from `cliProvider` for backward compatibility:
- `setGeminiMode(true)` maps to `setCliProvider("gemini")`
- `setGeminiMode(false)` maps to `setCliProvider("shell")`
- `setCliProvider(provider)` automatically updates `isGeminiMode` to `provider === "gemini"`

## Skill Runner Integration

Skills can be executed via CLI agents with provider-specific context injection:

### Gemini CLI (prompt injection)
1. User clicks "Run" on a skill card
2. Store sets `activeSkill` with skill content
3. Terminal connects in Gemini mode
4. After 2s delay (CLI initialization), skill prompt is sent via `pty:write`
5. `skillPromptSent` is set to `true` to prevent duplicate sends
6. Gemini CLI receives instructions and is ready to assist

### Codex (flag injection at spawn time)
1. User clicks "Run" on a skill card
2. Store sets `activeSkill` with skill content and `folderName`
3. Terminal connects in Codex mode
4. The `--project-doc` flag is appended to the spawn command, pointing to `<workingDirectory>/skills/<folderName>/Skill.md`
5. Codex receives the skill context as part of its project documentation

### Claude Code (project directory access)
1. Skills are not auto-injected for Claude
2. Claude has access to read skill files directly from the project directory
3. Environment variables (`QCUT_PROJECT_ID`, `QCUT_PROJECT_ROOT`) provide project context

```typescript
// Skill prompt format (Gemini only)
`I'm using the "${skill.name}" skill. Here are the instructions:
${skill.content}
Please acknowledge and help with tasks using this skill.`
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| PTY not available | Show "only in desktop app" error |
| Spawn failure | Display error message, allow retry |
| CLI binary missing | Provider-specific message (e.g., "Claude Code CLI is not installed") |
| Missing API key (Codex) | Prompt user to configure OpenRouter key in Settings |
| API key fetch failure | Display retrieval error, allow retry |
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
| `apps/web/src/types/cli-provider.ts` | CLI provider types and configurations |
| `apps/web/src/components/editor/media-panel/views/pty-terminal/` | UI components |
| `apps/web/src/types/electron.d.ts` | TypeScript definitions |
