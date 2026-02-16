# Claude Code + MCP Apps Integration Plan

## Goal

When QCut opens, a Claude Code terminal is open by default (next to Remotion panels). Claude Code runs with an MCP server that can generate **interactive HTML UIs** — buttons for image ratio, video length, etc. The interactive HTML renders in the **Preview Panel** (to the right of the Terminal tab), so the user sees the Terminal on the left and the MCP app UI on the right. After configuration, a button in the preview sends the settings to QCut for processing.

## Current State

| Component | Status | File |
|-----------|--------|------|
| PTY Terminal | Exists | `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` |
| Terminal Emulator (xterm.js) | Exists | `apps/web/src/components/editor/media-panel/views/pty-terminal/terminal-emulator.tsx` |
| PTY Store | Exists | `apps/web/src/stores/pty-terminal-store.ts` |
| PTY Handler (Electron) | Exists | `electron/pty-handler.ts` |
| Claude HTTP API | Exists | `electron/claude/claude-http-server.ts` (port 8765) |
| Claude IPC Handlers | Exists | `electron/claude/` (media, timeline, project, export, diagnostics) |
| MCP Apps | Not implemented | Reference docs only at `docs/task/mcp-apps-guide.md` |
| Auto-open terminal | Not implemented | Terminal only opens when user clicks Terminal tab |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ QCut Editor                                                          │
│ ┌──────────────┐ ┌───────────────────────┐ ┌──────────────────────┐ │
│ │ Media Panel   │ │ Preview Panel         │ │ Properties Panel     │ │
│ │              │ │                       │ │                      │ │
│ │ [Remotion]   │ │  MCP App HTML UI      │ │                      │ │
│ │ [Terminal] ← │ │  ┌─────────────────┐  │ │                      │ │
│ │  auto-open   │ │  │ Aspect Ratio    │  │ │                      │ │
│ │              │ │  │ ○ 16:9  ● 9:16  │  │ │                      │ │
│ │ Claude Code  │ │  │ ○ 1:1   ○ 4:3   │  │ │                      │ │
│ │ running here │ │  │                 │  │ │                      │ │
│ │              │ │  │ Duration: [15s] │  │ │                      │ │
│ │ > ask Claude │ │  │                 │  │ │                      │ │
│ │   to config  │ │  │ [Apply to QCut] │  │ │                      │ │
│ │   media ───────→  └─────────────────┘  │ │                      │ │
│ │              │ │                       │ │                      │ │
│ └──────────────┘ └───────────────────────┘ └──────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Timeline                                                         │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└───────┬──────────────────────────┬──────────────────────────────────┘
        │ PTY (node-pty)           │ IPC (renderer ↔ main)
        ▼                          ▼
┌─────────────────────┐  ┌──────────────────────────────┐
│ Claude Code CLI     │  │ QCut MCP Server              │
│ (spawned in PTY)    │  │ (Node.js, runs in Electron)  │
│                     │  │                              │
│ User talks to       │  │ Tools:                       │
│ Claude here         │  │ - configure-media            │
│                     │  │ - show-export-settings       │
│                  ──────→ - preview-project-stats      │
│                  stdio │                              │
│                     │  │ Returns: text + HTML UI      │
└─────────────────────┘  └──────────┬───────────────────┘
                                    │
                         ┌──────────▼───────────────────┐
                         │ Flow:                        │
                         │ 1. MCP tool returns HTML     │
                         │ 2. HTML sent to Preview via  │
                         │    IPC or postMessage        │
                         │ 3. Preview renders in iframe │
                         │ 4. User clicks "Apply"       │
                         │ 5. HTTP POST to localhost:    │
                         │    8765/api/claude/...       │
                         │ 6. QCut updates project      │
                         └──────────────────────────────┘
```

### Panel Layout: Terminal → Preview Flow

The key UX change: the **Preview Panel** (center panel in `panel-layouts.tsx`) serves double duty:
- **Normal mode**: shows video/media preview (existing behavior)
- **MCP App mode**: renders interactive HTML UIs from Claude Code's MCP tools

When Claude Code returns an MCP app HTML response, it is forwarded to the Preview Panel via IPC and rendered in a sandboxed iframe. The user sees:
- **Left**: Terminal tab with Claude Code (Media Panel)
- **Center**: Interactive MCP app UI (Preview Panel)
- **Right**: Properties Panel

## Implementation Tasks

Estimated total: ~55 minutes across 5 subtasks.

---

### Task 1: Auto-Open Claude Code Terminal on Editor Load (~10 min)

**What**: When the editor route loads, auto-connect the PTY terminal with Claude Code and switch to the Terminal tab.

**Files to modify**:

- `apps/web/src/stores/pty-terminal-store.ts` (434 lines)
  - Add an `autoConnectOnLoad` flag or method
  - The store already has `connect()` with command/cwd options (line ~53)
  - Set default provider to "claude" on first load

- `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` (372 lines)
  - Add `useEffect` to auto-trigger connect on mount if not already connected
  - Skip if user has explicitly disconnected (respect user preference)

- `apps/web/src/components/editor/media-panel/store.ts`
  - Set initial `activeTab` to `"terminal"` (or add a `defaultTab` preference)
  - Or: add logic in the editor route to switch tab on first load

- `apps/web/src/routes/editor.$project_id.lazy.tsx` (230 lines)
  - Add initialization effect that sets terminal tab active and triggers auto-connect
  - Pass project directory as `cwd` to PTY spawn

**Acceptance criteria**:
- Opening a project auto-opens the Terminal tab
- Claude Code CLI starts automatically in the project directory
- User can still switch to other tabs freely
- If Claude Code is not installed, show a helpful message instead of crashing

---

### Task 2: Build QCut MCP Server (~15 min)

**What**: Create an MCP server that Claude Code connects to. The server exposes tools that return interactive HTML UIs for configuring media settings.

**New files to create**:

- `electron/mcp/qcut-mcp-server.ts` (~200 lines)
  - MCP server using `@modelcontextprotocol/sdk`
  - Stdio transport (Claude Code connects via stdio)
  - Tools registered:
    - `configure-media` — returns HTML UI for aspect ratio, duration, resolution
    - `show-export-settings` — returns HTML UI for export format, quality, codec
    - `preview-project-stats` — returns HTML UI with project metrics dashboard
  - Each tool returns `content: [{ type: "text", ... }, { type: "resource", ... }]`

- `electron/mcp/apps/configure-media.html` (~150 lines)
  - Interactive form: aspect ratio buttons (16:9, 9:16, 1:1, 4:3), duration slider, resolution picker
  - "Apply to Project" button sends config to QCut HTTP API (`localhost:8765/api/claude/project/:projectId/settings`)
  - Uses `@modelcontextprotocol/ext-apps` for bidirectional comms
  - Self-contained CSS (dark theme matching QCut)

- `electron/mcp/apps/export-settings.html` (~150 lines)
  - Interactive export preset selector with live preview of settings
  - Platform presets (YouTube, TikTok, Instagram, Twitter, Custom)
  - "Apply Preset" button sends to QCut HTTP API

- `electron/mcp/apps/project-stats.html` (~100 lines)
  - Dashboard showing media count, timeline duration, track count
  - Auto-refreshing metrics

**Dependencies to add** (`package.json`):
```json
"@modelcontextprotocol/sdk": "latest"
```

Note: `@modelcontextprotocol/ext-apps` is loaded via ESM CDN in the HTML, not installed locally.

**Acceptance criteria**:
- MCP server starts and runs on stdio
- All tools return valid text + HTML resource content
- HTML apps render correctly in Claude Code/Desktop

---

### Task 3: Wire MCP Server to Claude Code PTY Session (~10 min)

**What**: When Claude Code starts in the PTY terminal, configure it to use the QCut MCP server automatically.

**Files to modify**:

- `electron/pty-handler.ts` (384 lines)
  - When spawning Claude Code, inject MCP server config via environment
  - Claude Code reads MCP config from `CLAUDE_MCP_SERVERS` env var or `.claude/settings.json`
  - Pass the path to `qcut-mcp-server.ts` (or compiled `.js`) as an MCP server

- `apps/web/src/stores/pty-terminal-store.ts`
  - Update `connect()` to pass MCP server path in spawn options when provider is "claude"
  - Add project ID to environment so MCP server knows which project to target

**Alternative approach** (simpler):

- `.claude/settings.json` or project-level `.claude/settings.local.json`
  - Register QCut MCP server statically:
  ```json
  {
    "mcpServers": {
      "qcut": {
        "command": "node",
        "args": ["electron/mcp/qcut-mcp-server.js"]
      }
    }
  }
  ```
  - Claude Code auto-discovers it when launched in the project directory

**Acceptance criteria**:
- Claude Code launched in QCut project automatically has `qcut` MCP server available
- User can ask Claude to "configure media settings" and get the interactive UI
- MCP tools appear in Claude Code's tool list

---

### Task 4: MCP App HTML Rendering in Preview Panel (~10 min)

**What**: When Claude Code's MCP tool returns HTML, forward it to the Preview Panel and render it in a sandboxed iframe — right next to the Terminal tab.

**Files to modify**:

- `apps/web/src/components/editor/preview-panel/index.tsx`
  - Add an `mcpAppHtml` state (or read from a store)
  - When `mcpAppHtml` is set, render an iframe with `srcdoc={mcpAppHtml}` instead of the normal video preview
  - Add a close/dismiss button to return to normal preview mode
  - Iframe should be sandboxed: `sandbox="allow-scripts allow-forms"`

- `apps/web/src/stores/mcp-app-store.ts` (NEW, ~60 lines)
  - Zustand store to hold MCP app state:
    ```typescript
    interface McpAppState {
      activeHtml: string | null;     // HTML content from MCP tool
      toolName: string | null;       // Which tool generated it
      setMcpApp: (html: string, toolName: string) => void;
      clearMcpApp: () => void;
    }
    ```
  - Preview Panel subscribes to this store
  - MCP server pushes HTML here via IPC

- `electron/mcp/qcut-mcp-server.ts`
  - After generating HTML response, also send it to the renderer via IPC:
    ```typescript
    mainWindow.webContents.send('mcp:app-html', { html, toolName });
    ```

- `electron/preload-integrations.ts` (340 lines)
  - Expose MCP app IPC channel:
    ```typescript
    electronAPI.mcp = {
      onAppHtml: (callback) => ipcRenderer.on('mcp:app-html', callback),
      removeListeners: () => ipcRenderer.removeAllListeners('mcp:app-html')
    }
    ```

**Acceptance criteria**:
- Claude Code returns MCP app HTML → Preview Panel switches to iframe view
- User sees Terminal (left) + MCP app UI (center) side by side
- Dismiss button returns Preview Panel to normal video preview
- Multiple MCP tool calls replace the previous HTML (latest wins)

---

### Task 5: HTML App ↔ QCut Communication (~10 min)

**What**: The interactive HTML UIs rendered in the Preview Panel need to send configuration back to QCut via the HTTP API.

**Files to modify**:

- `electron/mcp/apps/configure-media.html`
  - "Apply" button handler:
  ```javascript
  async function applySettings(settings) {
    const projectId = new URLSearchParams(window.location.search).get('projectId')
      || 'default';
    const res = await fetch(`http://localhost:8765/api/claude/project/${projectId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    const data = await res.json();
    // Update UI with success/error
  }
  ```

- `electron/claude/claude-http-server.ts` (321 lines)
  - Add CORS headers for iframe-originated requests:
  ```javascript
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  ```
  - Add preflight (OPTIONS) handler

- `electron/claude/claude-project-handler.ts` (210 lines)
  - Ensure `updateProjectSettings()` broadcasts changes to the renderer via IPC
  - The renderer should react to settings changes and update preview/timeline

**Acceptance criteria**:
- Clicking "Apply" in the MCP app iframe updates QCut project settings
- QCut editor UI reflects the changes immediately (e.g., preview aspect ratio updates)
- Error states are handled gracefully in the HTML UI

---

## Key File Reference

### Existing files to modify

| File | Lines | Purpose |
|------|-------|---------|
| `apps/web/src/stores/pty-terminal-store.ts` | 434 | Add auto-connect, MCP env injection |
| `apps/web/src/components/editor/media-panel/views/pty-terminal/pty-terminal-view.tsx` | 372 | Auto-open on mount |
| `apps/web/src/components/editor/media-panel/store.ts` | ~50 | Default tab to terminal |
| `apps/web/src/routes/editor.$project_id.lazy.tsx` | 230 | Init effect for auto-connect |
| `apps/web/src/components/editor/preview-panel/index.tsx` | ~200 | Render MCP app iframe |
| `electron/pty-handler.ts` | 384 | MCP server env injection |
| `electron/preload-integrations.ts` | 340 | Expose MCP app IPC channel |
| `electron/claude/claude-http-server.ts` | 321 | CORS for MCP app iframes |
| `electron/claude/claude-project-handler.ts` | 210 | Broadcast settings changes |

### New files to create

| File | Est. Lines | Purpose |
|------|-----------|---------|
| `electron/mcp/qcut-mcp-server.ts` | ~200 | MCP server with tools |
| `electron/mcp/apps/configure-media.html` | ~150 | Media config interactive UI |
| `electron/mcp/apps/export-settings.html` | ~150 | Export settings interactive UI |
| `electron/mcp/apps/project-stats.html` | ~100 | Project stats dashboard |
| `apps/web/src/stores/mcp-app-store.ts` | ~60 | MCP app state (active HTML, tool name) |

## Testing

- [ ] QCut opens → Terminal tab active → Claude Code starts automatically
- [ ] In Claude Code, ask "configure media settings" → MCP app HTML renders in **Preview Panel**
- [ ] User sees Terminal (left) + interactive UI (center) side by side
- [ ] Click aspect ratio button (e.g., 9:16) → "Apply" → QCut project updates to 9:16
- [ ] Click export preset (e.g., TikTok) → "Apply" → export settings update
- [ ] Dismiss button returns Preview Panel to normal video preview
- [ ] New MCP tool call replaces previous HTML in Preview Panel
- [ ] Close terminal → reopen → Claude Code reconnects
- [ ] No Claude Code installed → graceful fallback message
- [ ] Run `bun lint:clean` → no lint errors
- [ ] Run `bun check-types` → no type errors
- [ ] Run `bun run test` → all tests pass
