# PR Review Evaluator & Fixer

Evaluate a PR review comment and either fix the issue or explain why it doesn't apply.

## Instructions

1. Read the task file provided
2. The task file contains a code review comment with:
   - The file path to check
   - The line number
   - The issue description
3. Read the source file mentioned in the review
4. Evaluate if the feedback is valid
5. Take action:
   - **If valid**: Fix the code using the Edit tool
   - **If invalid**: Explain in 2-3 sentences why it doesn't apply

## Output Format

After evaluation, provide a brief summary:

```
## Result: [FIXED | NOT_APPLICABLE | ALREADY_FIXED]

**File:** path/to/file.ts
**Line:** 123

**Action taken:** [Description of fix OR reason why not applicable]
```

## Important Guidelines

- Be concise - don't over-explain
- Only fix what the review mentions
- Don't make unrelated changes
- If the issue is already fixed, report as ALREADY_FIXED
- Check for "Also applies to:" lines - fix those too if valid
