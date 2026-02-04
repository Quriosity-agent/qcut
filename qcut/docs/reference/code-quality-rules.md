# QCut Code Quality Rules

These five rules deliver the highest value-to-refactor ratio for the QCut codebase. Add them to your Ultracite (Biome) config at **error** level first.

| # | Rule | Why It Pays Off Immediately |
|---|------|-----------------------------|
| **1** | **Use `for…of` instead of `Array.forEach`.** | `forEach` swallows `await`/`return`, prevents early-exit, and complicates error handling. `for…of` is clearer, supports `break` / `continue`, and works perfectly with `await`. |
| **2** | **Set a Cognitive-Complexity ceiling for every function.** | Stops "God functions" from landing in the codebase; forces decomposition into smaller, testable helpers and keeps reviews manageable. |
| **3** | **Ban the legacy `arguments` object; use rest parameters (`...args`).** | Rest parameters are iterable, type-safe, and compatible with arrow functions—essential for clean TypeScript and better IntelliSense. |
| **4** | **Disallow `any` / `unknown` as type constraints.** | The single biggest source of hidden runtime bugs. Removing it preserves strong typing and makes large-scale refactors safe. |
| **5** | **Forbid reassigning `const` variables and eliminate `var`.** | Guarantees immutability by default, avoids hoisting surprises, and simplifies reasoning about state—especially in asynchronous flows. |

## Biome Configuration

Add these rules to your `biome.json`:

```json
{
  "linter": {
    "rules": {
      "complexity": {
        "noForEach": "error"
      },
      "style": {
        "noArguments": "error",
        "noVar": "error"
      },
      "suspicious": {
        "noExplicitAny": "error"
      }
    }
  }
}
```
