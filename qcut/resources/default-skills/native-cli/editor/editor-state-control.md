# QCut Editor — State Control & Automation (HTTP-first)

Advanced editor state control via HTTP API. For basic state operations, prefer the CLI:

```bash
qcut editor:undo --json              # Undo last action
qcut editor:redo --json              # Redo last undone action
qcut editor:state:snapshot --json    # Full state snapshot
qcut editor:state:snapshot --include timeline,playhead --json  # Partial
```

The endpoints below have no CLI wrappers — use `curl` directly (transactions excepted: see below). Requires QCut running.

> **Note:** In curl examples below, `...` is shorthand for `http://127.0.0.1:8765/api/claude`.

---

## Event Streaming

```bash
curl .../events                              # Last 100 events
curl ".../events?category=timeline&limit=50" # Filtered
curl -N .../events/stream                    # SSE real-time
```

**Query params**: `limit` (max 1000), `category` (prefix match), `source` (exact match), `after` (event ID cursor)

**Event categories**: `timeline.*` (elementAdded/Removed/Updated), `media.*` (imported/deleted), `export.*` (started/progress/completed/failed), `project.*` (settingsChanged), `editor.*` (selectionChanged/playheadMoved)

---

## Notification Bridge (QCut → Claude Terminal)

One-way bridge: forwards user actions from QCut into an active Claude PTY session as `[QCut] HH:MM:SS - description` context lines.

```bash
curl .../notifications/status                                              # Check status
curl -X POST .../notifications/enable -d '{"sessionId":"pty-123abc"}'     # Enable
curl -X POST .../notifications/disable                                     # Disable
curl ".../notifications/history?limit=20"                                  # Recent history
```

---

## Correlation IDs & Command Lifecycle

Every API response includes `correlationId` (header + body) for tracking.

```bash
curl .../commands/<correlationId>       # Command status
curl .../commands/<correlationId>/wait  # Long-poll (29s timeout)
```

**States**: `pending` → `accepted` → `applying` → `applied` | `failed`

---

## Transactions (Undo Groups)

Group multiple operations into a single undo entry. `editor:captions:import`
opens one for its whole import.

```bash
qcut editor transaction list --json                              # Open + recent, and what the editor holds
qcut editor transaction status --transaction-id <id> --json
qcut editor transaction rollback --transaction-id <id> --json    # End one (see below)
```

The HTTP routes, for scripts (each needs the bearer token the CLI sends for
you; it is the `token` field of `~/.local/state/qcut-pipeline/instances/8765.json`,
or `QCUT_API_TOKEN` when QCut was started with one):

```bash
curl -X POST .../transaction/begin -d '{"label":"Add intro","timeoutMs":30000}'  # → transactionId
curl -X POST .../transaction/<id>/commit                                          # Commit
curl -X POST .../transaction/<id>/rollback                                        # Rollback
curl .../transaction/<id>                                                         # Status
curl .../transaction                                                              # List
```

**Rules**: One active transaction at a time (409 if nested). Auto-rollback after timeout (default 30s, max 5min). Undo/redo blocked during active transaction.

**When the editor is busy** (just after opening a large project), a begin can
time out after 5 s: it fails with `Timeout waiting for transaction begin …
Nothing was changed; retry once it is ready`, and the editor drops the
transaction when it gets to the request, so nothing is left open. A commit or
rollback the editor does not answer in time leaves the transaction active
with its timeout re-armed, so it can be retried and still expires.

**Orphaned transactions**: `transaction list` reports `editor.orphaned: true`
when the editor holds a transaction QCut no longer tracks (QCut 2026.10.27.1
and older left one behind after a begin timeout; every later import then
failed with `Nested transactions are not supported. Active transaction: …`).
`transaction rollback --transaction-id <that id>` ends it **without
restoring anything** (no caller ever edited under it, and restoring would
undo everything done since it opened); a new begin also drops one that is
more than 15 s past its expiry. Rolling back a transaction whose project is
no longer open ends it without restoring either, so another project's
snapshot is never written into the open one.

---

## Capability Negotiation

```bash
curl .../capabilities                              # Full manifest
curl .../capabilities/timeline.batch               # Check specific
curl .../commands/registry                         # All commands + schemas
```

**Capability categories**: `STATE`, `MEDIA`, `TIMELINE`, `PROJECT`, `ANALYSIS`, `EXPORT`, `EVENTS`, `TRANSACTIONS`

---

## Undo/Redo History (HTTP)

```bash
curl .../history    # { undoCount, redoCount, entries[] }
```

`editor:undo` and `editor:redo` (`POST .../undo`, `POST .../redo`) answer
`{ applied, undoCount, redoCount, label, changes }`. `label` names the step
taken back or redone (a transaction's label, `Edit` for any other step), and
`changes` says what it did to the timeline: how many elements it `added`,
`removed`, `moved` and `changed`, and the first ten of them with their
track, `startTime` and `duration`. A moved one also has `from`, where it was
before; a `changed` one kept its place but not its settings (a replaced
media, a trim, a grade), and `fields` names what differs on a moved or
changed one. Check `changes` against the step you meant to take back. A
command the editor refuses adds no step, so it never needs undoing and
leaves redo as it was. When
nothing changed (`applied: false`: the history is empty, or a transaction is
open) the command fails and says which.
