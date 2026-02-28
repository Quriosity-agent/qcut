# Operation Notification Bridge: QCut → Claude Code

> When the user performs operations in QCut (GUI or CLI), notify Claude Code in the terminal that the operation already happened. Claude Code should **never re-execute** the operation — only acknowledge it as context.

---

## Overview

QCut already has a rich event system (`claude-events-handler.ts`) and operation log (`claude-operation-log.ts`). This plan adds a **one-way notification bridge** that forwards user-performed operations to Claude Code's terminal session so Claude Code stays aware of what the user did — without taking any action itself.

**Flow:**
```
User action in QCut → Editor event emitted → Bridge formats message →
  PTY session writes to Claude Code terminal → Claude Code sees "[QCut] User did X"
```

---

## Subtask 1: Define Operation Notification Types

**Estimated time:** ~10 min

Create a type file that defines which user operations should be forwarded and in what format.

### Relevant Files
- `electron/types/claude-events-api.ts` — existing event categories/actions
- **New:** `electron/types/operation-notification.ts`

### Details
- Define `OperationNotification` interface:
  ```ts
  interface OperationNotification {
    id: string;
    timestamp: number;
    operation: string;       // e.g. "timeline.addElement", "media.import", "export.start"
    summary: string;         // Human-readable: "User added a text element to timeline"
    details?: Record<string, unknown>; // Optional metadata
    source: 'gui' | 'cli' | 'shortcut';
  }
  ```
- Define `NOTIFIABLE_OPERATIONS` const array — whitelist of event categories that get forwarded (not every micro-event, only meaningful user actions)
- Map existing `EditorEventCategory` + `EditorEventAction` combinations to human-readable summaries

### Tests
- `electron/__tests__/operation-notification-types.test.ts` — validate type mappings cover all whitelisted operations

---

## Subtask 2: Create Operation Notification Formatter

**Estimated time:** ~15 min

A pure function that takes an `EditorEvent` and returns a formatted terminal message string, or `null` if the event should not be forwarded.

### Relevant Files
- `electron/claude/handlers/claude-events-handler.ts` — where events originate
- **New:** `electron/claude/utils/operation-formatter.ts`

### Details
- `formatOperationForTerminal(event: EditorEvent): string | null`
- Output format: `[QCut] <timestamp> — <summary>` (single line, no escape codes)
  - Example: `[QCut] 14:23:05 — User imported media file "clip.mp4"`
  - Example: `[QCut] 14:23:12 — User added text element "Title" to timeline at 00:03.200`
  - Example: `[QCut] 14:24:01 — User started export (preset: "YouTube 1080p")`
- Filter out internal/system events — only forward user-initiated actions
- Keep messages concise — Claude Code should get context, not noise

### Tests
- `electron/__tests__/operation-formatter.test.ts` — test formatting for each event category, test null returns for filtered events

---

## Subtask 3: Add Notification Emitter Hook to Event System

**Estimated time:** ~15 min

Tap into the existing event emission pipeline to also route events through the notification bridge.

### Relevant Files
- `electron/claude/handlers/claude-events-handler.ts` — `emitEditorEvent()` function
- `electron/claude/utils/operation-formatter.ts` — from Subtask 2
- **New:** `electron/claude/notification-bridge.ts`

### Details
- Create `NotificationBridge` class:
  ```ts
  class NotificationBridge {
    private enabled: boolean = false;
    private targetSessionId: string | null = null;

    enable(sessionId: string): void;
    disable(): void;
    notify(event: EditorEvent): void;  // Formats + sends to PTY
  }
  ```
- Export singleton instance `notificationBridge`
- In `emitEditorEvent()`, after the existing event buffer push, call `notificationBridge.notify(event)` if enabled
- The bridge checks `formatOperationForTerminal()` — if it returns a string, write it to the target PTY session
- Minimal coupling: if bridge is disabled or has no target, the call is a no-op

### Tests
- `electron/__tests__/notification-bridge.test.ts` — test enable/disable, test that events reach PTY mock, test filtering

---

## Subtask 4: Wire Bridge to PTY Session (Claude Code Terminal)

**Estimated time:** ~15 min

Connect the notification bridge output to the PTY session where Claude Code is running.

### Relevant Files
- `electron/utility/utility-pty-manager.ts` — manages PTY sessions
- `electron/utility/utility-bridge.ts` — main ↔ utility process communication
- `electron/claude/notification-bridge.ts` — from Subtask 3

### Details
- Add a `writeToSession(sessionId: string, data: string)` IPC message type in `utility-ipc-types.ts`
- In `utility-pty-manager.ts`, handle the new message by writing to the PTY's stdin:
  ```ts
  // Write notification as a comment/no-op line so it appears in terminal
  // but does NOT execute as a command
  pty.write(`# ${notification}\n`);
  ```
- In `notification-bridge.ts`, use the utility bridge to send the formatted message to the target PTY
- The `#` prefix ensures the shell treats it as a comment — visible but not executed
- Alternative: write to PTY output stream (stdout side) instead of stdin, so it appears as output rather than input — this is safer and prevents any accidental execution

### Tests
- `electron/__tests__/notification-pty-integration.test.ts` — test that bridge messages arrive at PTY output

---

## Subtask 5: Add Toggle IPC Endpoint

**Estimated time:** ~10 min

Let the renderer (or Claude HTTP API) enable/disable the notification bridge and set the target session.

### Relevant Files
- `electron/claude/index.ts` — `setupAllClaudeIPC()`
- `electron/claude/notification-bridge.ts` — from Subtask 3
- `electron/preload-integrations.ts` — `createClaudeAPI()`

### Details
- Register IPC handlers:
  - `claude:notifications:enable` — takes `{ sessionId: string }`, enables bridge
  - `claude:notifications:disable` — disables bridge
  - `claude:notifications:status` — returns `{ enabled: boolean, sessionId: string | null }`
- Add to preload Claude API:
  ```ts
  notifications: {
    enable: (sessionId: string) => ipcRenderer.invoke('claude:notifications:enable', { sessionId }),
    disable: () => ipcRenderer.invoke('claude:notifications:disable'),
    status: () => ipcRenderer.invoke('claude:notifications:status'),
  }
  ```
- Also expose via Claude HTTP API route: `POST /api/claude/notifications/toggle`

### Tests
- `electron/__tests__/notification-ipc.test.ts` — test enable/disable/status cycle

---

## Subtask 6: Add HTTP API Route for Notification Bridge

**Estimated time:** ~10 min

Expose the bridge status and toggle via the Claude HTTP server so external tools can also control it.

### Relevant Files
- `electron/claude/http/claude-http-shared-routes.ts` — existing shared routes
- `electron/claude/notification-bridge.ts` — from Subtask 3

### Details
- `POST /api/claude/notifications/enable` — body: `{ sessionId: string }`
- `POST /api/claude/notifications/disable`
- `GET /api/claude/notifications/status` — returns `{ enabled, sessionId }`
- `GET /api/claude/notifications/history` — returns last N formatted notification strings (ring buffer, max 50)

### Tests
- HTTP route tests alongside existing Claude HTTP tests

---

## Summary

| # | Subtask | Key File(s) | ~Time |
|---|---------|-------------|-------|
| 1 | Define notification types | `electron/types/operation-notification.ts` | 10 min |
| 2 | Create formatter | `electron/claude/utils/operation-formatter.ts` | 15 min |
| 3 | Notification bridge class | `electron/claude/notification-bridge.ts` | 15 min |
| 4 | Wire to PTY | `electron/utility/utility-pty-manager.ts`, `utility-ipc-types.ts` | 15 min |
| 5 | Toggle IPC endpoint | `electron/claude/index.ts`, `electron/preload-integrations.ts` | 10 min |
| 6 | HTTP API routes | `electron/claude/http/claude-http-shared-routes.ts` | 10 min |

**Total estimated: ~75 min**

### Architecture Decisions
- **One-way only**: QCut → Claude Code. No command channel back.
- **PTY output, not stdin**: Write notifications to PTY's output stream so they appear as terminal output, never as executed commands.
- **Whitelist, not blacklist**: Only forward explicitly listed operations. New event types are silent by default.
- **Singleton bridge**: One active notification target at a time. Multiple Claude Code sessions would need separate bridges (future work).
- **Comment prefix fallback**: If writing to stdin is ever needed, `# ` prefix ensures shell treats it as a comment.
