---
name: qagent
description: Orchestrate parallel AI agents for Qcut development. Use when spawning agents on issues, checking session status, handling CI failures, managing PRs, or batch-processing multiple tasks. Covers all qagent CLI commands configured for Qcut.
---

# QAgent — Agent Orchestrator for Qcut

Use the `qagent` CLI to spawn and manage parallel AI coding agents for Qcut development. The config is at `qagent.yaml` in the repo root.

## Quick Start

```bash
# Spawn an agent on a GitHub issue
qagent spawn qcut 170

# Spawn multiple agents in parallel
qagent batch-spawn qcut 170 171 172 173

# Check all sessions
qagent status

# Open the web dashboard
qagent dashboard
```

## Common Workflows

### Spawn an agent on an issue
```bash
qagent spawn qcut <issue-number>
```
This creates a git worktree, launches a Claude Code session, and starts working on the issue. The agent gets Qcut-specific rules (Bun, Biome, Electron conventions) injected automatically.

### Batch spawn for parallel development
```bash
qagent batch-spawn qcut 170 171 172 173
```
Spawns 4 agents working simultaneously in isolated worktrees. Each gets its own branch, PR, and CI pipeline.

### Monitor all sessions
```bash
qagent status                    # All sessions with branch/CI/PR/review info
qagent status -p qcut            # Qcut sessions only
qagent status --json             # Machine-readable output
```

### Send a message to a running agent
```bash
qagent send qcut-170 "Focus on the FFmpeg handler, not the UI"
qagent send qcut-170 "CI is failing on lint, please fix"
```

### Check and handle PR reviews automatically
```bash
qagent review-check qcut         # Check all Qcut PRs for review comments
qagent review-check qcut --dry-run  # Preview what would happen
```

### Export and forward PR comments
```bash
qagent pr-comments export Quriosity-agent/qcut 170
qagent pr-comments forward qcut-170
```

### Session management
```bash
qagent session ls                # List all sessions
qagent session kill qcut-170     # Kill a session and clean up worktree
qagent session cleanup qcut      # Kill sessions where PR is merged
qagent session restore qcut-170  # Restore a crashed session
```

### Open session in terminal
```bash
qagent open qcut-170             # Open in iTerm2 tab
```

### Start/stop the orchestrator
```bash
qagent start qcut                # Start lifecycle manager + dashboard
qagent stop qcut                 # Stop everything
```

## What Happens Automatically

When `qagent start` is running, the orchestrator:
- **CI failures**: Sends fix instructions to the agent (retries 2x, then notifies you)
- **Review comments**: Forwards CodeRabbit and human review comments to the agent
- **Approved + green**: Sends you a desktop notification to merge
- **Agent stuck**: Notifies you if an agent is idle for 10+ minutes

## Setup (first time)

```bash
bun run qagent:setup    # Init submodule + install + build qagent
```

Or manually:
```bash
git submodule update --init --recursive
cd packages/qagent
bun install
bun run build
```

The `qagent` CLI should be installed globally: `npm install -g @composio/ao-cli`
