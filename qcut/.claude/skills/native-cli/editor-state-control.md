# QCut Editor CLI — State Control & Automation

Deterministic editor state control via HTTP API: snapshots, event streams, correlation tracking, transactions, and capability negotiation.

Requires QCut running (`bun run electron:dev`). See [editor-core.md](editor-core.md) for connection options.

---

## State Snapshots

Get the full or partial editor state at any moment.

### Full snapshot

```bash
curl http://127.0.0.1:8765/api/claude/state
```

### Partial snapshot

```bash
# Only timeline and selection
curl "http://127.0.0.1:8765/api/claude/state?include=timeline,selection"

# Only playhead position
curl "http://127.0.0.1:8765/api/claude/state?include=playhead"
```

**Sections**: `timeline`, `selection`, `playhead`, `media`, `editor` (or `ui`), `project`

**Response**:

```json
{
  "success": true,
  "data": {
    "version": 1,
    "timestamp": 1740000000000,
    "state": {
      "timeline": { "tracks": [...], "selection": [...], "playhead": 5.2, "historyDepth": 3 },
      "media": { "items": [...], "counts": { "video": 2, "audio": 1 } },
      "editor": { "activePanel": "media", "activeTool": "select", "isDirty": false, "modals": [] },
      "project": { "id": "...", "name": "My Project", "fps": 30, "width": 1920, "height": 1080 }
    }
  }
}
```

---

## Event Streaming

Subscribe to real-time editor state changes and async job events.

### List recent events

```bash
# Last 100 events
curl http://127.0.0.1:8765/api/claude/events

# Filtered by category
curl "http://127.0.0.1:8765/api/claude/events?category=timeline&limit=50"

# Cursor pagination (events after a specific ID)
curl "http://127.0.0.1:8765/api/claude/events?after=evt_abc123"
```

### SSE real-time stream

```bash
curl -N http://127.0.0.1:8765/api/claude/events/stream
```

Streams Server-Sent Events. Heartbeat pings every 15s.

**Query params**: `limit` (max 1000), `category` (prefix match), `source` (exact match), `after` (event ID cursor)

**Event categories**:

| Category | Events |
|----------|--------|
| `timeline.*` | `elementAdded`, `elementRemoved`, `elementUpdated` |
| `media.*` | `imported`, `deleted` |
| `export.*` | `started`, `progress`, `completed`, `failed` |
| `project.*` | `settingsChanged` |
| `editor.*` | `selectionChanged`, `playheadMoved` |

**Event shape**:

```json
{
  "eventId": "evt_abc123",
  "timestamp": 1740000000000,
  "category": "timeline.elementAdded",
  "action": "elementAdded",
  "correlationId": "cmd_xyz789",
  "data": { "elementId": "e1", "trackId": "t1" },
  "source": "renderer.timeline-store"
}
```

---

## Operation Notification Bridge (QCut → Claude Terminal)

Forward meaningful user actions from QCut into an active Claude PTY session as context lines.

This bridge is **one-way only**:
- QCut emits context to Claude terminal.
- Claude terminal notifications are display-only context and should not trigger re-execution.

### Check bridge status

```bash
curl http://127.0.0.1:8765/api/claude/notifications/status
```

Response:

```json
{
  "success": true,
  "data": {
    "enabled": false,
    "sessionId": null
  }
}
```

### Enable bridge for a PTY session

```bash
curl -X POST http://127.0.0.1:8765/api/claude/notifications/enable \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"pty-123abc"}'
```

### Disable bridge

```bash
curl -X POST http://127.0.0.1:8765/api/claude/notifications/disable
```

### Toggle bridge (single endpoint)

```bash
# Enable
curl -X POST http://127.0.0.1:8765/api/claude/notifications/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"sessionId":"pty-123abc"}'

# Disable
curl -X POST http://127.0.0.1:8765/api/claude/notifications/toggle \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}'
```

### Read recent notification history

```bash
curl "http://127.0.0.1:8765/api/claude/notifications/history?limit=20"
```

### Notification format

Each bridged line is formatted like:

```text
[QCut] 14:23:05 - User imported media file "clip.mp4"
```

Typical forwarded operations include:
- timeline element add/update/remove
- media import/delete
- export start/complete/fail
- project settings changes

---

## Correlation IDs & Command Lifecycle

Every HTTP API response includes a `correlationId` for tracking commands through their full lifecycle.

### Response headers

All API responses include:
- `X-Correlation-Id` header
- `correlationId` field in response body

### Check command status

```bash
# Get specific command lifecycle
curl http://127.0.0.1:8765/api/claude/commands/<correlationId>

# List recent commands
curl http://127.0.0.1:8765/api/claude/commands
```

### Wait for command completion

```bash
# Long-poll until command reaches applied/failed state (29s timeout)
curl http://127.0.0.1:8765/api/claude/commands/<correlationId>/wait
```

**Command lifecycle states**: `pending` → `accepted` → `applying` → `applied` | `failed`

**CommandRecord response**:

```json
{
  "correlationId": "cmd_abc123",
  "command": "POST /api/claude/timeline/proj1/elements",
  "state": "applied",
  "createdAt": 1740000000000,
  "acceptedAt": 1740000000100,
  "appliedAt": 1740000000500,
  "duration": 500
}
```

---

## Transactions (Undo Groups)

Group multiple operations into a single undo entry. Prevents race conditions in multi-step edits.

### Begin transaction

```bash
curl -X POST http://127.0.0.1:8765/api/claude/transaction/begin \
  -H "Content-Type: application/json" \
  -d '{"label": "Add title sequence", "timeoutMs": 30000}'
```

Returns `{ "transactionId": "txn_abc123" }`.

### Commit transaction

```bash
curl -X POST http://127.0.0.1:8765/api/claude/transaction/<id>/commit
```

All changes since `begin` become a single undo entry.

### Rollback transaction

```bash
curl -X POST http://127.0.0.1:8765/api/claude/transaction/<id>/rollback
```

Reverts all changes to pre-transaction state.

### Check transaction status

```bash
curl http://127.0.0.1:8765/api/claude/transaction/<id>
```

**Transaction states**: `active` → `committed` | `rolledBack` | `timedOut`

**Rules**:
- One active transaction at a time (409 Conflict if nested)
- Auto-rollback after timeout (default 30s, max 5min)
- Undo/redo blocked during active transaction

### Undo / Redo via API

```bash
# Undo last action
curl -X POST http://127.0.0.1:8765/api/claude/undo

# Redo
curl -X POST http://127.0.0.1:8765/api/claude/redo

# Get history summary
curl http://127.0.0.1:8765/api/claude/history
```

**History response**:

```json
{
  "undoCount": 5,
  "redoCount": 2,
  "entries": [
    { "label": "Add title sequence", "timestamp": 1740000000000 }
  ]
}
```

---

## Capability Negotiation

Discover what the editor supports before calling endpoints.

### Full capability manifest

```bash
curl http://127.0.0.1:8765/api/claude/capabilities
```

### Check specific capability

```bash
# Check if a capability exists
curl http://127.0.0.1:8765/api/claude/capabilities/timeline.batch

# Check minimum version
curl "http://127.0.0.1:8765/api/claude/capabilities/timeline.batch?minVersion=1.0.0"
```

**Response**:

```json
{
  "supported": true,
  "name": "timeline.batch",
  "version": "1.0.0",
  "since": "1.0.0",
  "category": "TIMELINE"
}
```

### Command registry

```bash
# Full registry with param schemas
curl http://127.0.0.1:8765/api/claude/commands/registry
```

Returns all 80+ available commands with name, description, param schemas, and required capabilities.

### Enhanced health check

```bash
curl http://127.0.0.1:8765/api/claude/health
```

Now includes:

```json
{
  "status": "ok",
  "version": "2026.02.26.3",
  "uptime": 12345.67,
  "apiVersion": "1.1.0",
  "protocolVersion": "1.0.0",
  "appVersion": "2026.02.26.3",
  "electronVersion": "30.0.0",
  "capabilities": [{ "name": "...", "version": "...", "category": "..." }]
}
```

---

## Capability Categories

| Category | Capabilities |
|----------|-------------|
| `STATE` | `state.health`, `state.capabilities`, `state.commandRegistry`, `state.ui.panelSwitch` |
| `MEDIA` | `media.library`, `media.import.local`, `media.import.url`, `media.extractFrame`, `media.screenshot`, `media.screenRecording` |
| `TIMELINE` | `timeline.read`, `timeline.import`, `timeline.elements`, `timeline.batch`, `timeline.arrange`, `timeline.selection`, `timeline.cuts`, `timeline.autoEdit` |
| `PROJECT` | `project.settings`, `project.stats`, `project.summary`, `project.navigator`, `project.crud` |
| `ANALYSIS` | `analysis.video`, `analysis.models`, `analysis.transcription`, `analysis.suggestCuts`, `analysis.generate`, `analysis.diagnostics` |
| `EXPORT` | `export.presets`, `export.jobs`, `export.remotion` |
| `EVENTS` | `events.rendererBridge`, `events.mcpPreview` |
| `TRANSACTIONS` | `transactions.batchMutations`, `transactions.asyncJobs` |

---

## Common Automation Workflows

### Atomic multi-element add

```bash
# Start transaction
TXN=$(curl -s -X POST http://127.0.0.1:8765/api/claude/transaction/begin \
  -H "Content-Type: application/json" \
  -d '{"label":"Add intro sequence"}' | jq -r '.data.transactionId')

# Add multiple elements (each tracked via correlation ID)
bun run pipeline editor:timeline:batch-add \
  --project-id $PROJECT \
  --elements '[{"type":"text","content":"Title","startTime":0,"trackId":"t1"},
               {"type":"text","content":"Subtitle","startTime":0,"trackId":"t2"}]'

# Commit as single undo entry
curl -X POST http://127.0.0.1:8765/api/claude/transaction/$TXN/commit
```

### Wait for command completion

```bash
# Add element and get correlation ID
RESULT=$(curl -s -X POST http://127.0.0.1:8765/api/claude/timeline/$PROJECT/elements \
  -H "Content-Type: application/json" \
  -d '{"type":"text","content":"Hello"}')
CID=$(echo $RESULT | jq -r '.correlationId')

# Wait until fully applied
curl -s "http://127.0.0.1:8765/api/claude/commands/$CID/wait"
```

### Monitor state changes during export

```bash
# Start SSE stream in background
curl -sN http://127.0.0.1:8765/api/claude/events/stream &

# Start export
bun run pipeline editor:export:start --project-id $PROJECT --preset youtube-1080p

# Events stream shows: export.started → export.progress → export.completed
```

---

## All New HTTP Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/claude/state` | Editor state snapshot (full or partial) |
| GET | `/api/claude/events` | List buffered events |
| GET | `/api/claude/events/stream` | SSE real-time event stream |
| GET | `/api/claude/commands` | List tracked commands |
| GET | `/api/claude/commands/:id` | Get command lifecycle |
| GET | `/api/claude/commands/:id/wait` | Long-poll for completion |
| GET | `/api/claude/capabilities` | Full capability manifest |
| GET | `/api/claude/capabilities/:name` | Check specific capability |
| GET | `/api/claude/commands/registry` | Command registry with schemas |
| POST | `/api/claude/transaction/begin` | Start transaction |
| POST | `/api/claude/transaction/:id/commit` | Commit transaction |
| POST | `/api/claude/transaction/:id/rollback` | Rollback transaction |
| GET | `/api/claude/transaction/:id` | Transaction status |
| POST | `/api/claude/undo` | Undo timeline |
| POST | `/api/claude/redo` | Redo timeline |
| GET | `/api/claude/history` | Undo/redo history summary |

---

## Key Source Files

| Component | File |
|-----------|------|
| State handler | `electron/claude/handlers/claude-state-handler.ts` |
| Events handler | `electron/claude/handlers/claude-events-handler.ts` |
| Correlation tracker | `electron/claude/handlers/claude-correlation.ts` |
| Transaction handler | `electron/claude/handlers/claude-transaction-handler.ts` |
| Capability handler | `electron/claude/handlers/claude-capability-handler.ts` |
| Command registry | `electron/claude/handlers/claude-command-registry.ts` |
| State HTTP routes | `electron/claude/http/claude-http-state-routes.ts` |
| Events HTTP routes | `electron/claude/http/claude-http-events-routes.ts` |
| Meta HTTP routes | `electron/claude/http/claude-http-meta-routes.ts` |
| Transaction routes | `electron/claude/http/claude-http-transaction-routes.ts` |
| State bridge | `apps/web/src/lib/claude-bridge/claude-state-bridge.ts` |
| Events bridge | `apps/web/src/lib/claude-bridge/claude-events-bridge.ts` |
| Transaction bridge | `apps/web/src/lib/claude-bridge/claude-transaction-bridge.ts` |
| State types | `electron/types/claude-state-api.ts` |
| Events types | `electron/types/claude-events-api.ts` |
| Capability types | `electron/types/claude-api-capabilities.ts` |
