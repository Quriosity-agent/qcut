<div align="center">

# Agent Orchestrator — The Orchestration Layer for Parallel AI Agents

Spawn parallel AI coding agents, each in its own git worktree. Agents autonomously fix CI failures, address review comments, and open PRs — you supervise from one dashboard.

[![GitHub stars](https://img.shields.io/github/stars/ComposioHQ/agent-orchestrator?style=flat-square)](https://github.com/ComposioHQ/agent-orchestrator/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![PRs merged](https://img.shields.io/badge/PRs_merged-61-brightgreen?style=flat-square)](https://github.com/ComposioHQ/agent-orchestrator/pulls?q=is%3Amerged)
[![Tests](https://img.shields.io/badge/test_cases-3%2C288-blue?style=flat-square)](https://github.com/ComposioHQ/agent-orchestrator/releases/tag/metrics-v1)

</div>

---

Agent Orchestrator manages fleets of AI coding agents working in parallel on your codebase. Each agent gets its own git worktree, its own branch, and its own PR. When CI fails, the agent fixes it. When reviewers leave comments, the agent addresses them. You only get pulled in when human judgment is needed.

**Agent-agnostic** (Claude Code, Codex, Aider) · **Runtime-agnostic** (tmux, Docker) · **Tracker-agnostic** (GitHub, Linear)

<!-- TODO: Add dashboard screenshot or terminal GIF showing 10+ sessions with attention zones -->

## Quick Start

> **Note**: QAgent lives inside the [QCut monorepo](https://github.com/Quriosity-agent/qcut) at `packages/qagent/`. No separate clone needed.

```bash
# From the qcut root
bun run qagent:setup

# Configure your project
cp packages/qagent/qagent.yaml.example qagent.yaml

# Launch and spawn an agent
qagent start
qagent spawn my-project 123    # GitHub issue, Linear ticket, or ad-hoc
```

Dashboard opens at `http://localhost:3000`. Run `qagent status` for the CLI view.

## How It Works

```
qagent spawn my-project 123
```

1. **Workspace** creates an isolated git worktree with a feature branch
2. **Runtime** starts a tmux session (or Docker container)
3. **Agent** launches Claude Code (or Codex, or Aider) with issue context
4. Agent works autonomously — reads code, writes tests, creates PR
5. **Reactions** auto-handle CI failures and review comments
6. **Notifier** pings you only when judgment is needed

### Plugin Architecture

Eight slots. Every abstraction is swappable.

| Slot | Default | Alternatives |
|------|---------|-------------|
| Runtime | tmux | docker, k8s, process |
| Agent | claude-code | codex, aider, opencode |
| Workspace | worktree | clone |
| Tracker | github | linear |
| SCM | github | — |
| Notifier | desktop | slack, composio, webhook |
| Terminal | iterm2 | web |
| Lifecycle | core | — |

All interfaces defined in [`packages/core/src/types.ts`](packages/core/src/types.ts). A plugin implements one interface and exports a `PluginModule`. That's it.

## Configuration

```yaml
# qagent.yaml
port: 3000

defaults:
  runtime: tmux
  agent: claude-code
  workspace: worktree
  notifiers: [desktop]

projects:
  my-app:
    repo: owner/my-app
    path: ~/my-app
    defaultBranch: main
    sessionPrefix: app

reactions:
  ci-failed:
    auto: true
    action: send-to-agent
    retries: 2
  changes-requested:
    auto: true
    action: send-to-agent
    escalateAfter: 30m
  approved-and-green:
    auto: false       # flip to true for auto-merge
    action: notify
```

CI fails → agent gets the logs and fixes it. Reviewer requests changes → agent addresses them. PR approved with green CI → you get a notification to merge.

See [`qagent.yaml.example`](qagent.yaml.example) for the full reference.

## CLI

```bash
qagent status                              # Overview of all sessions
qagent spawn <project> [issue]             # Spawn an agent
qagent send <session> "Fix the tests"      # Send instructions
qagent session ls                          # List sessions
qagent session kill <session>              # Kill a session
qagent session restore <session>           # Revive a crashed agent
qagent dashboard                           # Open web dashboard
```

## Why Agent Orchestrator?

Running one AI agent in a terminal is easy. Running 30 across different issues, branches, and PRs is a coordination problem.

**Without orchestration**, you manually: create branches, start agents, check if they're stuck, read CI failures, forward review comments, track which PRs are ready to merge, clean up when done.

**With Agent Orchestrator**, you: `qagent spawn` and walk away. The system handles isolation, feedback routing, and status tracking. You review PRs and make decisions — the rest is automated.

## Prerequisites

- Node.js 20+
- Git 2.25+
- tmux (for default runtime)
- `gh` CLI (for GitHub integration)

## Development

```bash
bun install && bun run build   # Install and build all packages
bun run test                   # Run tests (3,288 test cases)
bun run dev                    # Start web dashboard dev server
```

See [CLAUDE.md](CLAUDE.md) for code conventions and architecture details.

## Documentation

| Doc | What it covers |
|-----|---------------|
| [Setup Guide](SETUP.md) | Detailed installation and configuration |
| [Examples](examples/) | Config templates (GitHub, Linear, multi-project, auto-merge) |
| [CLAUDE.md](CLAUDE.md) | Architecture, conventions, plugin pattern |
| [Troubleshooting](TROUBLESHOOTING.md) | Common issues and fixes |

## Contributing

Contributions welcome. The plugin system makes it straightforward to add support for new agents, runtimes, trackers, and notification channels. Every plugin is an implementation of a TypeScript interface — see [CLAUDE.md](CLAUDE.md) for the pattern.

## License

MIT
