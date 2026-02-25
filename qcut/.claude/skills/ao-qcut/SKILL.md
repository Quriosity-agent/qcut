---
name: ao-qcut
description: Orchestrate parallel AI agents for Qcut development. Use when spawning agents on issues, checking session status, handling CI failures, managing PRs, or batch-processing multiple tasks. Covers all ao CLI commands configured for Qcut.
---

# Agent Orchestrator for Qcut

Use the `ao` CLI to spawn and manage parallel AI coding agents for Qcut development. The config is at `agent-orchestrator.yaml` in the repo root.

## Quick Start

```bash
# Spawn an agent on a GitHub issue
ao spawn qcut 170

# Spawn multiple agents in parallel
ao batch-spawn qcut 170 171 172 173

# Check all sessions
ao status

# Open the web dashboard
ao dashboard
```

## Common Workflows

### Spawn an agent on an issue
```bash
ao spawn qcut <issue-number>
```
This creates a git worktree, launches a Claude Code session, and starts working on the issue. The agent gets Qcut-specific rules (Bun, Biome, Electron conventions) injected automatically.

### Batch spawn for parallel development
```bash
ao batch-spawn qcut 170 171 172 173
```
Spawns 4 agents working simultaneously in isolated worktrees. Each gets its own branch, PR, and CI pipeline.

### Monitor all sessions
```bash
ao status                    # All sessions with branch/CI/PR/review info
ao status -p qcut            # Qcut sessions only
ao status --json             # Machine-readable output
```

### Send a message to a running agent
```bash
ao send qcut-170 "Focus on the FFmpeg handler, not the UI"
ao send qcut-170 "CI is failing on lint, please fix"
```

### Check and handle PR reviews automatically
```bash
ao review-check qcut         # Check all Qcut PRs for review comments
ao review-check qcut --dry-run  # Preview what would happen
```

### Export and forward PR comments
```bash
ao pr-comments export Quriosity-agent/qcut 170
ao pr-comments forward qcut-170
```

### Session management
```bash
ao session ls                # List all sessions
ao session kill qcut-170     # Kill a session and clean up worktree
ao session cleanup qcut      # Kill sessions where PR is merged
ao session restore qcut-170  # Restore a crashed session
```

### Open session in terminal
```bash
ao open qcut-170             # Open in iTerm2 tab
```

### Start/stop the orchestrator
```bash
ao start qcut                # Start lifecycle manager + dashboard
ao stop qcut                 # Stop everything
```

## What Happens Automatically

When `ao start` is running, the orchestrator:
- **CI failures**: Sends fix instructions to the agent (retries 2x, then notifies you)
- **Review comments**: Forwards CodeRabbit and human review comments to the agent
- **Approved + green**: Sends you a desktop notification to merge
- **Agent stuck**: Notifies you if an agent is idle for 10+ minutes

## Setup (first time)

```bash
bun run ao:setup    # Init submodule + install + build agent-orchestrator
```

Or manually:
```bash
git submodule update --init --recursive
cd packages/agent-orchestrator
pnpm install
pnpm build
```

The `ao` CLI should be installed globally: `npm install -g @composio/ao-cli`
