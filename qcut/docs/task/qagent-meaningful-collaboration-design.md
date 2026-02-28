# QAgent Multi-Agent Meaningful Collaboration Design

## Background

Current relay behavior produces high-volume noise and very low semantic value.  
Observed messages are mostly repeated terminal snippets, not intentional agent discussion.

Typical noise examples:

- `Write tests for @filename`
- `Find and fix a bug in @filename`
- `Explain this codebase`
- `[Pasted Content ...]`

Root cause: terminal output snapshots are being broadcast as if they were collaboration messages.

## Problem Statement

The current system behaves like a log relay, not a collaboration protocol.

Main failures:

- Signal source is wrong: terminal capture is treated as dialogue.
- No loop protection: rebroadcast can bounce between peers.
- No routing discipline: broad fan-out to all peers.
- No task contract: agents do not share structured intent.
- No file ownership protocol: concurrent edits can collide.

## Goals

1. Make inter-agent traffic meaningful and task-oriented.
2. Prevent collaboration loops and message storms.
3. Enable safe parallel work without file conflicts.
4. Keep architecture simple enough for CLI usage.
5. Provide clear observability from files on disk.

## Non-Goals

- Building a full distributed system.
- Replacing existing session runtime.
- Requiring external middleware (Redis, MQ, etc.).

## Design Principles

1. Structured messages over raw terminal text.
2. Task-first coordination.
3. Explicit ownership and leases.
4. Controlled collaboration triggers, not constant chatter.
5. File-system-native persistence and debuggability.

## High-Level Architecture

### Control Plane vs Data Plane

- Control plane: structured team protocol messages.
- Data plane: local coding activity within each agent session.

Only control-plane messages are relayed team-wide.  
Data-plane terminal output stays local unless explicitly summarized.

### Core Components

1. Task Ledger
2. File Ownership Locks
3. Structured Message Bus
4. Relay Guardrails
5. Policy Engine for "when to discuss"

## Task Ledger

Use one JSON file per task instead of a single giant shared JSON.

Directory:

`coord/tasks/T-<id>.json`

Example:

```json
{
  "id": "T-017",
  "title": "Implement collision system",
  "status": "in_progress",
  "owner": "codex-b",
  "leaseUntil": "2026-03-01T02:10:00.000Z",
  "priority": "high",
  "dependencies": ["T-012"],
  "fileScopes": ["game.js", "physics/*.js"],
  "inputs": ["design/collision-rules.md"],
  "outputs": ["tests/collision.test.js"],
  "notes": "Need integration contract with rendering loop",
  "updatedAt": "2026-03-01T01:40:00.000Z"
}
```

Why one-file-per-task:

- Better concurrent writes.
- Clear audit trail per unit of work.
- Easier recovery from partial corruption.

## Claim and Lease Protocol

### Task Claim

Agent must claim task before execution:

- Set `owner`
- Set `leaseUntil`
- Set `status=in_progress`

### Lease Renewal

Owner renews lease periodically while active.

### Lease Expiry

If lease expires, other agents may take over after writing takeover event.

This avoids deadlock from abandoned tasks.

## File Ownership Locks

Task ownership alone is not enough.  
Need file-level protection to prevent concurrent edits.

Directory:

`coord/locks/<normalized-path>.lock.json`

Example:

```json
{
  "file": "game.js",
  "owner": "codex-a",
  "taskId": "T-011",
  "leaseUntil": "2026-03-01T02:00:00.000Z",
  "updatedAt": "2026-03-01T01:45:00.000Z"
}
```

Rules:

1. Must acquire lock before editing.
2. Lock conflict blocks write and requires coordination.
3. Lock lease can expire and be reclaimed.
4. Pre-commit guard checks modified files stay within owned scopes.

## Structured Message Protocol

Relay should forward only protocol messages, not raw pane deltas.

Message schema:

```json
{
  "id": "msg-01JXYZ...",
  "type": "task_update",
  "from": "codex-a",
  "to": ["lead", "codex-b"],
  "taskId": "T-017",
  "priority": "normal",
  "requiresAck": false,
  "ttl": 2,
  "createdAt": "2026-03-01T01:50:00.000Z",
  "body": {
    "summary": "Collision detection complete",
    "details": "Need API confirmation for sprite bounds"
  }
}
```

Required protections:

1. `id` dedup cache.
2. `ttl` decrement on forward.
3. Drop if `ttl <= 0`.
4. Do not rebroadcast messages with same `id`.
5. Route by `to`, not blind broadcast.

## Collaboration Policy

Default mode should be independent execution, not continuous discussion.

### Default (Independent)

- Agent executes owned task.
- Sends only status checkpoints.

### Triggered Discussion

Discussion is required only when:

1. Need to modify file owned by another agent.
2. Dependency contract is unclear or changed.
3. Task blocked beyond threshold (for example 5 minutes).
4. Critical failure requires cross-task rollback.

### Mandatory Output

After discussion, decision must be written back to task ledger:

- Decision summary
- Affected tasks/files
- New owners or lock transfers

## Relay Behavior Changes

Current behavior:

- Capture tmux output
- Compute text delta
- Broadcast delta to peers

Target behavior:

1. Inbound: forward only structured protocol messages to harness.
2. Outbound: forward only explicit structured emissions from harness.
3. Ignore terminal prompt noise and UI artifacts.
4. Add dedup and TTL checks.

Optional compatibility mode:

- Keep raw relay for debug only via explicit flag.
- Default must be structured-only mode.

## Suggested Message Types

- `task_claim`
- `task_update`
- `task_blocked`
- `task_handoff`
- `contract_request`
- `contract_response`
- `lock_request`
- `lock_grant`
- `lock_reject`
- `decision_recorded`

## File Layout Proposal

```
coord/
  tasks/
    T-001.json
    T-002.json
  locks/
    game__js.lock.json
    src__render__hud__js.lock.json
  messages/
    inbox/
      lead.json
      codex-a.json
      codex-b.json
      codex-c.json
    dedup/
      codex-a.seen.json
      codex-b.seen.json
```

## Rollout Plan

### Phase 1: Stop the noise

1. Disable default tmux-output rebroadcast.
2. Add structured-only relay mode.
3. Add message dedup and TTL.

### Phase 2: Introduce task ownership

1. Add task ledger files.
2. Add claim and lease flow.
3. Add status transitions.

### Phase 3: Add file safety

1. Add file lock acquisition and renewal.
2. Add pre-commit scope guard.
3. Add lock conflict resolution messages.

### Phase 4: Policy enforcement

1. Only trigger discussions on explicit conditions.
2. Persist decisions back to ledger.
3. Add dashboard views for tasks, locks, and meaningful messages.

## Success Metrics

1. Noise ratio: repeated prompt-like messages should drop by >90%.
2. Loop incidents: zero rebroadcast loops with same `message.id`.
3. Conflict rate: near-zero concurrent edit collisions.
4. Throughput: more tasks completed per hour per agent.
5. Quality: higher share of messages mapped to task IDs and decisions.

## Risks and Mitigations

Risk: protocol too strict, agents become silent.  
Mitigation: keep debug raw mode and minimal required message types initially.

Risk: lock contention stalls progress.  
Mitigation: short leases, handoff flow, lead override for deadlocks.

Risk: schema drift between versions.  
Mitigation: include `schemaVersion` and backward-compatible parser.

## Practical Recommendation

Start with a minimal production-safe baseline:

1. Structured-only relay by default.
2. Message dedup + TTL.
3. Task claim + lease.
4. File lock for write operations.

This is enough to move from "echoing logs" to "meaningful collaboration".
