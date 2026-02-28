# QAgent Team Manager Analysis

## Overview

The Team Manager is a **filesystem-backed inter-agent messaging system** within the qagent orchestration framework. It enables multiple AI agent sessions to communicate asynchronously through JSON inbox files, without requiring a database or network service.

Core location: `packages/qagent/packages/core/src/team-manager.ts` (632 lines)

## What It Does

The Team Manager provides a message-passing layer for coordinating parallel AI agents. Each agent gets a personal inbox (a JSON file), and other agents can append messages to it. This allows agents working on different tasks to share status, request help, or coordinate shutdown — all through the local filesystem.

**Key operations:**
- **ensureTeam** — Create a team directory with inbox files for each member
- **addMember** — Add a new member inbox to an existing team
- **listMembers** — List all members by scanning inbox files
- **sendMessage** — Append a text message to a member's inbox
- **sendProtocol** — Send a structured JSON protocol message (e.g., idle notification, shutdown request)
- **readInbox** — Read messages with optional unread filtering, limit, and mark-as-read
- **markAllRead** — Bulk-acknowledge all unread messages

## Architecture

### Filesystem Layout

```
~/.claude/teams/
└── <team-id>/
    └── inboxes/
        ├── team-lead.json      # JSON array of TeamMessage objects
        ├── observer.json
        └── worker-1.json
```

Each inbox file is a JSON array of `TeamMessage` objects:

```typescript
interface TeamMessage {
  from: string;       // sender identifier
  text: string;       // message body (plain text or serialized JSON for protocol)
  timestamp: string;  // ISO 8601
  read: boolean;      // unread/read state
  summary?: string;   // optional short summary
  color?: string;     // optional color label for UI
}
```

### Concurrency Model

The system uses **exclusive file locks** (`O_CREAT | O_EXCL`) to prevent concurrent write corruption:

1. A `.lock` file is atomically created next to the inbox file
2. The operation reads, modifies, and writes the inbox
3. Writes go to a temp file first, then `renameSync` atomically replaces the inbox
4. The lock file is deleted on completion
5. If the lock is held, the caller retries every `lockRetryMs` (default 50ms) up to `lockTimeoutMs` (default 5s)

This is tested with 50 concurrent writes in the test suite — all messages survive without loss.

**Read operations skip locking** when `markAsRead` is false, since reads without mutation are safe on a single-writer-per-inbox model.

### Protocol Messages

Protocol messages embed structured JSON in the `text` field, enabling machine-readable coordination:

```typescript
const TEAM_PROTOCOL_TYPE = {
  IDLE_NOTIFICATION: "idle_notification",
  SHUTDOWN_REQUEST: "shutdown_request",
  SHUTDOWN_APPROVED: "shutdown_approved",
};
```

The `parseTeamProtocolMessage` utility extracts and validates these payloads, requiring both `type` and `from` fields.

### Security

Path traversal is prevented by `assertSafePathPart`, which validates team IDs and member names against `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`. Inputs like `../escape` are rejected.

## CLI Surface

### `qagent team` Commands (`cli/src/commands/team.ts`)

| Command | Description |
|---------|-------------|
| `team init <team-id> <members...>` | Create team with inbox files |
| `team add-member <team-id> <member>` | Add member to existing team |
| `team members <team-id>` | List team members |
| `team send <team-id> <from> <to> [message...]` | Send text or protocol message |
| `team inbox <team-id> <member>` | Read member's inbox (supports `--unread`, `--mark-read`, `--limit`, `--json`) |
| `team ack <team-id> <member>` | Mark all messages as read |

The `send` command supports `--protocol <type>` and `--payload <json>` flags to send structured protocol messages, and `-f/--file <path>` to read message text from a file.

The team root directory defaults to `~/.claude/teams` but can be overridden via `--root` or `QAGENT_TEAM_ROOT` env var.

### `qagent harness` Commands (`cli/src/commands/harness.ts`)

The harness system builds on top of the Team Manager and session management to provide an **external control surface** for agent sessions:

| Command | Description |
|---------|-------------|
| `harness spawn <agent-id> [task...]` | Spawn a new agent session with runtime options |
| `harness status [target]` | Show live session state |
| `harness sessions` | List all harness sessions |
| `harness steer <instruction...>` | Send mid-flight instruction to a session |
| `harness cancel` | Cancel current turn (Ctrl-C via tmux or steer message) |
| `harness close` | Kill session and remove tracking record |
| `harness model <id>` | Change model at runtime |
| `harness permissions <profile>` | Change permissions profile |
| `harness timeout <seconds>` | Set timeout |
| `harness cwd <path>` | Set working directory |
| `harness set <key> <value>` | Set arbitrary runtime option |
| `harness reset-options` | Clear all runtime overrides |
| `harness doctor` | Health check (config, store, tmux) |

The harness tracks sessions in `.qagent/harness-sessions.json` using atomic write-rename (same pattern as inbox files). Sessions are resolved by key, session ID, or label, with a default session fallback.

**Session modes:**
- `persistent` — Long-running session that stays active
- `oneshot` — Runs a single task and stops

**Thread modes:** `auto`, `here`, `off`

## How It Relates to QCut

The Team Manager enables QCut's **multi-agent development workflow**:

1. **Parallel agent orchestration** — Multiple Claude Code agents can work on different QCut tasks simultaneously (e.g., one on UI, one on backend), coordinating through team inboxes
2. **Harness control** — The harness system lets operators spawn, steer, and monitor agent sessions working on the QCut codebase
3. **CI/build coordination** — Agents can notify each other when builds pass/fail via protocol messages
4. **Idle/shutdown protocol** — Agents signal when they're available or need to shut down, enabling resource-efficient parallel development

The qagent skill in CLAUDE.md references this: "Orchestrate parallel AI agents for Qcut development."

## Test Coverage

The test suite (`__tests__/team-manager.test.ts`) covers 7 scenarios:

| Test | What It Validates |
|------|-------------------|
| Team init | Inbox files created, members listed correctly |
| Unread/ack flow | Send → read unread → mark read → verify empty unread |
| Protocol messages | Serialize, send, parse back with custom payload |
| Mark all read | Bulk acknowledge, verify unread count drops to 0 |
| Unsafe path rejection | `../escape` blocked for both team ID and member |
| Inbox format preservation | Pre-existing messages survive new appends |
| Concurrent writes | 50 parallel sends → all 50 messages present and unique |

## Key Design Decisions

1. **No database** — Pure filesystem, works anywhere without setup
2. **JSON arrays** — Each inbox is a flat JSON array, simple to inspect and debug
3. **Atomic writes** — Write-to-temp + rename prevents partial writes
4. **File locks** — `O_CREAT | O_EXCL` is portable and doesn't require external tooling
5. **Protocol as text** — Protocol messages use the same `text` field as regular messages, keeping the data model simple
6. **Factory function** — `createTeamManager()` returns an interface, enabling testability and configuration

## Potential Improvements

1. **Inbox growth** — Inboxes grow unboundedly since messages are never deleted. An archival or rotation mechanism would prevent large files from degrading read performance.

2. **Lock file cleanup on crash** — If a process crashes while holding a lock, the stale `.lock` file blocks all subsequent operations until the timeout expires. A PID-based staleness check or advisory locks (`flock`) would improve resilience.

3. **Watch/subscribe** — Currently consumers must poll `readInbox`. A filesystem watcher (`fs.watch`) could enable push-based notification for lower latency coordination.

4. **Message deletion** — There's no way to delete individual messages. An expiry TTL or explicit delete operation would help manage inbox size.

5. **Typed protocol registry** — Protocol types are string constants. A discriminated union or schema registry would provide compile-time safety for protocol payloads.

6. **Harness file length** — `harness.ts` is 1131 lines, exceeding the project's 800-line rule. It could be split into separate files for store management, session lifecycle, and runtime option commands.
