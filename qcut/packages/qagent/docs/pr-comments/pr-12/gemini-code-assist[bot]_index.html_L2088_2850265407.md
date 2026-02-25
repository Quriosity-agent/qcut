# Review Comment

- **Author:** gemini-code-assist[bot]
- **File:** `index.html`
- **Line:** 2088
- **Date:** 2026-02-25
- **Comment ID:** 2850265407
- **URL:** https://github.com/donghaozhang/game-project/pull/12#discussion_r2850265407

---

![medium](https://www.gstatic.com/codereviewagent/medium-priority.svg)

The `saveGameOverScore` function already updates the global `bestScore` variable (via the `persistHighScores` function it calls). This makes this line redundant, as `bestScore` will already hold the correct highest score after `saveGameOverScore` completes. You can safely remove this line to simplify the code.
