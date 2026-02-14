# Secure API Key Injection for AICP Binary — Implementation Plan

## Overview

Inject the user's encrypted FAL API key into the AICP binary process at spawn time, so the bundled binary can call FAL.ai without requiring a `.env` file or manual key entry each session.

## Current State — Almost Everything Exists

| Component | File | Status |
|-----------|------|--------|
| **Encryption** | `electron/api-key-handler.ts` (323 lines) | Done — `safeStorage.encryptString()` / `decryptString()`, stored in `~/.config/QCut/api-keys.json` with `0o600` permissions |
| **Settings UI** | `apps/web/src/components/editor/properties-panel/settings-view.tsx` (lines 288-659) | Done — `ApiKeysView` component with input fields for 5 keys (FAL, Freesound, Gemini, OpenRouter, Anthropic), show/hide toggles, save button |
| **IPC bridge** | `electron/preload.ts` (lines 235-241) | Done — `window.electronAPI.apiKeys.get()` / `.set()` / `.clear()` |
| **Type definitions** | `apps/web/src/types/electron.d.ts` (lines 329-345) | Done — `ApiKeyConfig` type with all 5 keys |
| **Client-side usage** | `apps/web/src/lib/fal-ai-client.ts` (lines 75-145) | Done — FAL client loads key from Electron storage on init |
| **AICP env injection** | `electron/ai-pipeline-handler.ts` (line 450) | **NOT DONE** — passes `env: { ...process.env }` only |

### The Gap

```typescript
// ai-pipeline-handler.ts line 447-451 (current)
const proc = spawn(cmd, args, {
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },  // ← Only inherits process.env, no stored keys
});
```

The AICP binary needs `FAL_KEY` in its environment to call FAL.ai. The key is already encrypted and stored — it just isn't being read and injected at spawn time.

---

## Implementation Subtasks

### Task 1: Load Stored API Keys in AIPipelineManager (15 min)

**File to modify:**
- `electron/ai-pipeline-handler.ts`

**Changes:**

Import the key retrieval function from the existing api-key-handler and load keys during environment detection. Inject them into the spawned process environment.

1. Import the key loading function from `api-key-handler.ts` (need to check what's exported — likely need to export a `getDecryptedKeys()` function)
2. In the `execute()` method, read the stored FAL key and inject it into the spawn env:

```typescript
// In execute(), before spawning:
const storedKeys = await getDecryptedApiKeys();
const spawnEnv = {
  ...process.env,
  ...(storedKeys.falApiKey ? { FAL_KEY: storedKeys.falApiKey } : {}),
  ...(storedKeys.geminiApiKey ? { GEMINI_API_KEY: storedKeys.geminiApiKey } : {}),
};

const proc = spawn(cmd, args, {
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: spawnEnv,
});
```

3. Also inject into the `detectEnvironment()` version checks so `aicp --version` can work even if the binary requires a key.

**Relevant files:**
- `electron/api-key-handler.ts` — check what's exported, may need to expose a `getDecryptedApiKeys()` function
- `electron/ai-pipeline-handler.ts:447-451` — the spawn call

**Acceptance criteria:**
- AICP process receives `FAL_KEY` from encrypted storage
- No plaintext key written to disk (stays in memory only)
- Works when user has set key via Settings UI
- Falls back gracefully when no key is stored (AICP will report its own "key missing" error)

---

### Task 2: Export Key Retrieval from api-key-handler (10 min)

**File to modify:**
- `electron/api-key-handler.ts`

**Changes:**

The current handler registers IPC handlers but may not export a function callable from other Electron main-process modules. Add an exported function:

```typescript
/**
 * Read and decrypt stored API keys from disk.
 * For use by other main-process modules (e.g., ai-pipeline-handler).
 * Returns empty strings for keys that aren't stored.
 */
export async function getDecryptedApiKeys(): Promise<ApiKeyConfig> {
  // Re-use existing decryption logic
}
```

Check current exports — if the decryption logic is already in a standalone function, just export it. If it's inline in the IPC handler, extract it.

**Acceptance criteria:**
- `getDecryptedApiKeys()` is importable from `ai-pipeline-handler.ts`
- Returns the same data as the `api-keys:get` IPC handler
- Does not duplicate decryption logic (reuse existing code)

---

### Task 3: Validate Key Before Generation (10 min)

**File to modify:**
- `electron/ai-pipeline-handler.ts`

**Changes:**

Before executing a generation command, check if the required API key is available. Return a clear, actionable error if not:

```typescript
// In execute(), before spawning:
if (!spawnEnv.FAL_KEY && command !== "list-models" && command !== "--help") {
  return {
    success: false,
    error: "FAL API key not configured. Go to Editor → Settings → API Keys to add your key.",
  };
}
```

This avoids spawning a process that will fail 10+ seconds later with a cryptic error from the AICP binary.

**Acceptance criteria:**
- Missing key returns immediate, user-friendly error with navigation hint
- `list-models` and help commands work without a key
- Error message tells the user exactly where to fix it

---

### Task 4: Unit Tests (15 min)

**Files to create:**
- `electron/__tests__/api-key-injection.test.ts`

**Test cases:**

1. **Key injection** — when FAL key is stored, it appears in the spawn environment
2. **No key stored** — spawn env doesn't include `FAL_KEY` (no crash, no undefined)
3. **Multiple keys** — FAL + Gemini keys both injected correctly
4. **Key not leaked to logs** — ensure console.log in execute() doesn't print the key value
5. **Pre-flight validation** — generate command without key returns actionable error
6. **List-models bypass** — `list-models` command works without key

**Acceptance criteria:**
- All tests pass with `bun run test`
- Tests mock `safeStorage` and file system (no real keychain access in CI)

---

## Estimated Total Time: ~50 minutes

| Task | Time |
|------|------|
| 1. Inject keys into AICP spawn env | 15 min |
| 2. Export key retrieval function | 10 min |
| 3. Pre-flight key validation | 10 min |
| 4. Unit tests | 15 min |

## File Impact Summary

| File | Action |
|------|--------|
| `electron/ai-pipeline-handler.ts` | Modify — inject stored keys into spawn env, add pre-flight check |
| `electron/api-key-handler.ts` | Modify — export `getDecryptedApiKeys()` for use by other modules |
| `electron/__tests__/api-key-injection.test.ts` | **Create** — unit tests |

### No changes needed

| File | Why |
|------|-----|
| `electron/preload.ts` | IPC bridge already exposes `apiKeys.get/set/clear` |
| `apps/web/src/types/electron.d.ts` | Types already defined |
| `apps/web/src/components/editor/properties-panel/settings-view.tsx` | Settings UI already complete with FAL key input |
| `apps/web/src/lib/fal-ai-client.ts` | Client-side FAL usage already loads from Electron storage |

## Security Model

```
User enters FAL key in Settings UI (once)
        │
        ▼
window.electronAPI.apiKeys.set({ falApiKey: "sk-..." })
        │
        ▼
api-key-handler.ts
├── safeStorage.encryptString("sk-...") → encrypted Buffer
├── Buffer.toString("base64") → "dGhpcyBpcyBl..."
└── writeFile("~/.config/QCut/api-keys.json", { falApiKey: "dGhpcyBpcyBl..." }, mode: 0o600)
        │
        ▼ (on AICP generation request)
        │
ai-pipeline-handler.ts
├── getDecryptedApiKeys() → { falApiKey: "sk-..." }
├── Inject into spawn env: { ...process.env, FAL_KEY: "sk-..." }
└── spawn("aicp", args, { env: spawnEnv })
        │
        ▼
AICP process reads FAL_KEY from its environment
├── Calls FAL API with Authorization header
└── Process exits, env destroyed — key only existed in memory
```

**What's protected:**
- Key encrypted at rest by OS keychain (macOS Keychain / Windows DPAPI / Linux Secret Service)
- File permissions `0o600` — only owner can read
- Key only decrypted in Electron main process memory, never in renderer
- Passed to AICP via process environment (standard, same as how any CLI tool reads secrets)
- Process environment destroyed when AICP exits

**What's NOT protected against:**
- Root/admin access on the machine (can access keychain)
- Memory dump of the running process (key is in memory during generation)
- These are inherent to any client-side key storage — acceptable trade-offs for a desktop app

## Diagram

```
Settings UI                  Electron Main Process              AICP Binary
───────────                  ──────────────────────              ───────────

"Enter FAL Key"              api-key-handler.ts
  [sk-abc123]  ──────────►   encrypt + store
                             ~/.config/QCut/api-keys.json
                             (encrypted, 0o600)

"Generate Image" ─────────►  ai-pipeline-handler.ts
                             ├── getDecryptedApiKeys()
                             ├── env = { FAL_KEY: "sk-abc123" }
                             └── spawn("aicp", args, { env })
                                        │
                                        └──────────────────────► aicp generate-image
                                                                 ├── reads FAL_KEY
                                                                 ├── calls FAL API
                                                                 └── exits (env gone)
```
