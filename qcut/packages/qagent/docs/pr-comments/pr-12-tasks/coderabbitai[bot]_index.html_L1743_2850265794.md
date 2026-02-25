## Task

Evaluate this code review comment. Read the source file and determine if the issue is valid.

**Instructions:**
1. Read the file mentioned in the review: `index.html`
2. Check line 1743 and surrounding context
3. Determine if the review feedback is valid
4. If valid: Fix the issue in the code
5. If invalid: Explain why the feedback doesn't apply

**Important:** Be concise. Either fix the code or explain in 2-3 sentences why it's not applicable.

---

# Review Comment

- **Author:** coderabbitai[bot]
- **File:** `index.html`
- **Line:** 1743
- **Date:** 2026-02-25
- **Comment ID:** 2850265794
- **URL:** https://github.com/donghaozhang/game-project/pull/12#discussion_r2850265794

---

_⚠️ Potential issue_ | _🟡 Minor_

**Score tying with the 5th-place entry is saved then silently evicted.**

When `score` equals the current cutoff (`highScores[4].score`), `qualifiesForHighScores` returns `true`, the user is prompted for initials, and `saveGameOverScore` reports "Saved …". However, `sortHighScores` breaks ties by `createdAt` ascending (older first) and then slices to 5, so the newly pushed entry (highest `createdAt`) is always the one dropped.

This causes a misleading UX: the player sees a "Top 5 run!" prompt and a "Saved" message, but their entry doesn't persist.

Fix by using a strict `>` comparison, or by reversing the tie-break so newer entries displace older ones at equal score:
