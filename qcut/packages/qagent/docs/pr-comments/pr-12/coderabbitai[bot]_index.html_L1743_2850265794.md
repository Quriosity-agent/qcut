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


<details>
<summary>Option A – strict comparison (simpler)</summary>

```diff
       function qualifiesForHighScores(score) {
         if (!Number.isFinite(score) || score <= 0) return false;
         if (highScores.length < 5) return true;
         const cutoff = highScores[highScores.length - 1];
-        return !!cutoff && score >= cutoff.score;
+        return !!cutoff && score > cutoff.score;
       }
```

</details>

<details>
<summary>Option B – keep >= but let newer entries win ties</summary>

```diff
       function sortHighScores(entries) {
         return entries
           .filter(Boolean)
-          .sort((a, b) => (b.score - a.score) || (a.createdAt - b.createdAt))
+          .sort((a, b) => (b.score - a.score) || (b.createdAt - a.createdAt))
           .slice(0, 5);
       }
```

</details>

<!-- suggestion_start -->

<details>
<summary>📝 Committable suggestion</summary>

> ‼️ **IMPORTANT**
> Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements.

```suggestion
      function qualifiesForHighScores(score) {
        if (!Number.isFinite(score) || score <= 0) return false;
        if (highScores.length < 5) return true;
        const cutoff = highScores[highScores.length - 1];
        return !!cutoff && score > cutoff.score;
      }
```

</details>

<!-- suggestion_end -->

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
Verify each finding against the current code and only fix it if needed.

In `@index.html` around lines 1738 - 1743, qualifiesForHighScores currently
returns true for score >= cutoff, which lets a tied new entry be saved then
dropped because sortHighScores breaks ties by createdAt ascending; fix by either
changing the check in qualifiesForHighScores to a strict greater-than (score >
cutoff.score) or, if you want ties to let newer entries win, update
sortHighScores so its comparator treats equal scores by comparing createdAt
descending (newer first) before slicing to 5; ensure you reference highScores,
qualifiesForHighScores and sortHighScores when making the change so the saved
entry actually persists.
```

</details>

<!-- fingerprinting:phantom:medusa:phoenix -->

<!-- This is an auto-generated comment by CodeRabbit -->
