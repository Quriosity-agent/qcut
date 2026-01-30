---
name: pr-comments
description: Export GitHub PR review comments to individual markdown files. Use when user wants to copy, save, or export PR comments, code review feedback, or CodeRabbit/Gemini bot comments.
argument-hint: [owner/repo] [pr-number] [output-dir]
disable-model-invocation: true
allowed-tools: Bash(gh *), Bash(jq *), Bash(mkdir *), Bash(cat *), Bash(sed *), Read
---

# PR Comments Exporter

Export all review comments from a GitHub Pull Request into individual markdown files for easy copying and reference.

## Quick Start

```bash
# Step 1: Export PR comments
/pr-comments donghaozhang/qcut 102

# Step 2: Preprocess for evaluation (creates task files)
bash .claude/skills/pr-comments/scripts/batch-preprocess.sh docs/pr-comments/pr-102

# Step 3: Evaluate and fix each comment
/pr-review-fix docs/pr-comments/pr-102-tasks/comment-file.md
```

## Commands

### Export Comments

```bash
bash .claude/skills/pr-comments/scripts/export.sh $ARGUMENTS
```

**Arguments:**
- `$0` - Repository in `owner/repo` format (e.g., `donghaozhang/qcut`)
- `$1` - PR number (e.g., `102`)
- `$2` - Output directory (optional, defaults to `docs/pr-comments/pr-{number}`)

### Preprocess for Evaluation

Convert exported comments into task files ready for agentic evaluation:

```bash
# Single file
bash .claude/skills/pr-comments/scripts/preprocess.sh docs/pr-comments/pr-102/comment.md

# Batch all files
bash .claude/skills/pr-comments/scripts/batch-preprocess.sh docs/pr-comments/pr-102
```

This:
- Removes `<details>` sections (AI prompts, proposed fixes)
- Removes HTML comments
- Adds evaluation prompt: "If valid, fix it. If not, explain why."

## Workflow

```
┌─────────────────────────────────────────────┐
│  1. /pr-comments owner/repo 102             │
│     Export comments to markdown files       │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  2. batch-preprocess.sh                     │
│     Clean files, add evaluation prompt      │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  3. /pr-review-fix task-file.md             │
│     Evaluate each, fix or explain           │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  4. Results: FIXED / NOT_APPLICABLE         │
└─────────────────────────────────────────────┘
```

## Output Structure

```
docs/pr-comments/
├── README.md
├── pr-102/                    # Raw exported comments
│   ├── coderabbitai[bot]_*.md
│   └── gemini-code-assist[bot]_*.md
└── pr-102-tasks/              # Preprocessed for evaluation
    ├── coderabbitai[bot]_*.md
    └── gemini-code-assist[bot]_*.md
```

## Related Skills

- `/pr-review-fix [file]` - Evaluate single comment, fix or explain
- `/pr-review-batch [dir]` - Batch process all comments in directory

## Requirements

- GitHub CLI (`gh`) - installed and authenticated
- `jq` - JSON processing
- `sed` - text processing
