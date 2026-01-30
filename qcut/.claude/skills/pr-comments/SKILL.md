---
name: pr-comments
description: Export, preprocess, and fix GitHub PR review comments. Use when user wants to export PR comments, evaluate code reviews, or fix review feedback from CodeRabbit/Gemini bots.
argument-hint: <action> [args...]
disable-model-invocation: true
allowed-tools: Bash(gh *), Bash(jq *), Bash(mkdir *), Bash(sed *), Read, Edit, Glob, Grep
---

# PR Comments Skill

Export GitHub PR review comments, preprocess for evaluation, and fix or reject each review.

## Actions

### 1. Export: `/pr-comments export <owner/repo> <pr-number>`

Export all review comments from a PR to individual markdown files.

```bash
bash .claude/skills/pr-comments/scripts/export.sh $1 $2 $3
```

**Output:** `docs/pr-comments/pr-{number}/` with one file per comment.

### 2. Preprocess: `/pr-comments preprocess <input-dir>`

Clean exported comments for agentic evaluation (removes `<details>` blocks, adds evaluation prompt).

```bash
bash .claude/skills/pr-comments/scripts/batch-preprocess.sh $1
```

**Output:** `{input-dir}-tasks/` with cleaned task files.

### 3. Fix: `/pr-comments fix <task-file.md>`

Evaluate a single PR review comment. Read the source file, determine if valid, then fix or explain.

Follow instructions in [review-fix.md](review-fix.md).

### 4. Batch: `/pr-comments batch <tasks-dir>`

Process all task files in a directory, evaluating and fixing each one.

Follow instructions in [review-batch.md](review-batch.md).

## Complete Workflow

```bash
# Step 1: Export comments from PR
/pr-comments export donghaozhang/qcut 102

# Step 2: Preprocess into task files
/pr-comments preprocess docs/pr-comments/pr-102

# Step 3a: Fix single comment
/pr-comments fix docs/pr-comments/pr-102-tasks/comment.md

# Step 3b: Or batch fix all
/pr-comments batch docs/pr-comments/pr-102-tasks
```

## Output Structure

```
docs/pr-comments/
├── README.md
├── pr-102/                    # Raw exported comments
│   ├── coderabbitai[bot]_file_L42_123.md
│   └── gemini-code-assist[bot]_file_L50_456.md
└── pr-102-tasks/              # Preprocessed for evaluation
    ├── coderabbitai[bot]_file_L42_123.md
    └── gemini-code-assist[bot]_file_L50_456.md
```

## Supporting Files

- [review-fix.md](review-fix.md) - Single comment evaluation instructions
- [review-batch.md](review-batch.md) - Batch processing instructions

## Requirements

- GitHub CLI (`gh`) - installed and authenticated
- `jq` - JSON processing
