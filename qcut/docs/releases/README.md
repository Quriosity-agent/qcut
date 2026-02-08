# Release Notes

This directory contains per-version release notes that are automatically displayed to users in the QCut desktop app.

## File Format

Each file is named `v{version}.md` (e.g., `v0.3.52.md`) and uses YAML frontmatter:

```markdown
---
version: "0.3.52"
date: "2025-01-31"
channel: "stable"
---

# QCut v0.3.52

## What's New
- Feature description

## Improvements
- Improvement description

## Bug Fixes
- Fix description
```

## Conventions

- **channel**: One of `stable`, `alpha`, `beta`, `rc`
- **date**: ISO date format `YYYY-MM-DD`
- **version**: Semver string matching `package.json`
- Sections are optional; omit empty sections
- `latest.md` is a copy of the most recent stable release

## How It Works

1. During `bun run release:*`, the release script auto-generates a new file here
2. The Electron main process reads these files via IPC
3. The renderer displays them in the update notification and changelog page
4. Files are bundled with the app and work offline
