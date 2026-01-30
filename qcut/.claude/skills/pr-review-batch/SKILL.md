---
name: pr-review-batch
description: Batch evaluate and fix all PR review comments in a directory. Processes each comment, decides to fix or reject.
argument-hint: [tasks-directory]
context: fork
agent: general-purpose
allowed-tools: Read, Edit, Glob, Grep, Bash(git *), Skill(pr-review-fix *)
---

# Batch PR Review Processor

Process all PR review task files in a directory, evaluating and fixing each one.

## Instructions

1. List all `.md` files in the directory: `$ARGUMENTS`
2. For each file:
   - Read the task content
   - Use `/pr-review-fix` skill to evaluate and fix
   - Log the result
3. After all files processed, provide summary

## Process

```
for each task_file in $ARGUMENTS/*.md:
    1. Read task_file
    2. Extract file path and line from task
    3. Read the source file
    4. Evaluate if review is valid
    5. If valid: Fix the code
       If invalid: Log reason
    6. Record result
```

## Output Summary

After processing all files, output:

```markdown
# PR Review Batch Results

## Summary
- Total: X comments
- Fixed: Y
- Not applicable: Z
- Already fixed: W

## Details

| File | Line | Status | Notes |
|------|------|--------|-------|
| ... | ... | FIXED | ... |
| ... | ... | NOT_APPLICABLE | ... |
```

## Important

- Process files one at a time
- Don't skip any files
- Be concise in notes
- Create a results.md file in the tasks directory when done
