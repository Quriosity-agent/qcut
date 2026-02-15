# Implementation Plan: Robust FAL Key Setup via CLI

**Date**: 2026-02-15
**Status**: Implemented
**Branch**: `date-versioning`
**Depends on**: AICP binary v1.0.29+ (already released in `video-agent-skill`)

---

## Overview

QCut has an Electron-only key store (`safeStorage` + `api-keys.json`). AICP has its own CLI credential store (`~/.config/video-ai-studio/credentials.env`). These two systems are disconnected. This plan unifies them with a 3-tier fallback chain and adds CLI commands so users can set keys without the GUI.

**Resolution order** (highest priority wins):

```
1. Environment variable   →  FAL_KEY / FAL_API_KEY
2. QCut Electron store    →  userData/api-keys.json
3. AICP credential store  →  ~/.config/video-ai-studio/credentials.env
```

---

## Subtask 1: Add AICP credential reader to api-key-handler

**~8 min** | Backend (Electron main process)

### Files

| File | Action |
|------|--------|
| `electron/api-key-handler.ts` | Add `loadAicpCredentials()`, modify `getDecryptedApiKeys()` |

### What to do

1. Add a `getAicpCredentialsPath()` helper that returns the platform-correct path:
   - macOS/Linux: `~/.config/video-ai-studio/credentials.env`
   - Windows: `%APPDATA%/video-ai-studio/credentials.env`

2. Add `loadAicpCredentials()` that reads and parses the dotenv file:

```typescript
// Key name mapping: AICP env var → QCut ApiKeys field
const AICP_KEY_MAP: Record<string, keyof ApiKeys> = {
  FAL_KEY: "falApiKey",
  GEMINI_API_KEY: "geminiApiKey",
  OPENROUTER_API_KEY: "openRouterApiKey",
  ELEVENLABS_API_KEY: "anthropicApiKey", // or add new field if needed
};

function getAicpCredentialsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"),
      "video-ai-studio", "credentials.env");
  }
  return path.join(home, ".config", "video-ai-studio", "credentials.env");
}

function loadAicpCredentials(): Partial<ApiKeys> {
  const credPath = getAicpCredentialsPath();
  if (!fs.existsSync(credPath)) return {};

  const content = fs.readFileSync(credPath, "utf-8");
  const keys: Partial<ApiKeys> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const name = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    const field = AICP_KEY_MAP[name];
    if (field && value) {
      keys[field] = value;
    }
  }
  return keys;
}
```

3. Modify `getDecryptedApiKeys()` to merge AICP credentials as a fallback tier:

```typescript
export async function getDecryptedApiKeys(): Promise<ApiKeys> {
  // Tier 2: QCut Electron store (existing logic)
  const electronKeys = await loadElectronStoredKeys();
  // Tier 3: AICP CLI credential store (new)
  const aicpKeys = loadAicpCredentials();

  return {
    falApiKey:        electronKeys.falApiKey        || aicpKeys.falApiKey        || "",
    freesoundApiKey:  electronKeys.freesoundApiKey  || "",
    geminiApiKey:     electronKeys.geminiApiKey     || aicpKeys.geminiApiKey     || "",
    openRouterApiKey: electronKeys.openRouterApiKey || aicpKeys.openRouterApiKey || "",
    anthropicApiKey:  electronKeys.anthropicApiKey  || "",
  };
}
```

The existing internal logic of `getDecryptedApiKeys()` becomes `loadElectronStoredKeys()` (rename the body into a private function). This keeps the public API unchanged.

4. Export `loadAicpCredentials` and `getAicpCredentialsPath` for use in tests and the CLI handler.

### Acceptance criteria

- `getDecryptedApiKeys()` returns AICP-stored keys when Electron store is empty
- Electron store keys take priority over AICP store when both exist
- Missing or malformed `credentials.env` returns empty (no crash)
- Works on macOS, Windows, and Linux paths

---

## Subtask 2: Add `api-keys:status` IPC handler

**~5 min** | Backend (Electron main process)

### Files

| File | Action |
|------|--------|
| `electron/api-key-handler.ts` | Add `api-keys:status` IPC handler inside `setupApiKeyIPC()` |
| `electron/preload.ts` | Expose `status()` on `apiKeys` object (line ~236) |
| `electron/preload-types.ts` | Add `status` to `ElectronAPI.apiKeys` type |
| `apps/web/src/types/electron.d.ts` | Add `status()` return type to `apiKeys` interface (line ~329) |

### What to do

1. Inside `setupApiKeyIPC()` in `electron/api-key-handler.ts`, add:

```typescript
interface KeyStatus {
  set: boolean;
  source: "environment" | "electron" | "aicp-cli" | "not-set";
}

interface ApiKeysStatus {
  falApiKey: KeyStatus;
  freesoundApiKey: KeyStatus;
  geminiApiKey: KeyStatus;
  openRouterApiKey: KeyStatus;
  anthropicApiKey: KeyStatus;
}

ipcMain.handle("api-keys:status", async (): Promise<ApiKeysStatus> => {
  const electronKeys = await loadElectronStoredKeys();
  const aicpKeys = loadAicpCredentials();

  function resolveStatus(
    envName: string,
    electronField: keyof ApiKeys,
  ): KeyStatus {
    if (process.env[envName]) return { set: true, source: "environment" };
    if (electronKeys[electronField]) return { set: true, source: "electron" };
    if (aicpKeys[electronField]) return { set: true, source: "aicp-cli" };
    return { set: false, source: "not-set" };
  }

  return {
    falApiKey: resolveStatus("FAL_KEY", "falApiKey"),
    freesoundApiKey: resolveStatus("FREESOUND_API_KEY", "freesoundApiKey"),
    geminiApiKey: resolveStatus("GEMINI_API_KEY", "geminiApiKey"),
    openRouterApiKey: resolveStatus("OPENROUTER_API_KEY", "openRouterApiKey"),
    anthropicApiKey: resolveStatus("ANTHROPIC_API_KEY", "anthropicApiKey"),
  };
});
```

2. In `electron/preload.ts` (line ~236, inside `apiKeys` object):

```typescript
status: (): Promise<ApiKeysStatus> => ipcRenderer.invoke("api-keys:status"),
```

3. In `electron/preload-types.ts` (inside `ElectronAPI.apiKeys`):

```typescript
status: () => Promise<ApiKeysStatus>;
```

4. In `apps/web/src/types/electron.d.ts` (line ~344, after `clear`):

```typescript
status: () => Promise<{
  falApiKey: { set: boolean; source: string };
  freesoundApiKey: { set: boolean; source: string };
  geminiApiKey: { set: boolean; source: string };
  openRouterApiKey: { set: boolean; source: string };
  anthropicApiKey: { set: boolean; source: string };
}>;
```

### Acceptance criteria

- `window.electronAPI.apiKeys.status()` returns correct source for each key
- Environment variables take priority in source detection
- Works when no keys are set (all `not-set`)

---

## Subtask 3: Add CLI flags to Electron main process

**~8 min** | Backend (Electron main process)

### Files

| File | Action |
|------|--------|
| `electron/main.ts` | Add early CLI arg handling before `app.whenReady()` |

### What to do

Add a CLI handler block **before** line 120 (`app.commandLine.appendSwitch`) that intercepts key-management commands and exits before creating the window:

```typescript
// CLI key management - runs headless, no window needed
const cliArgs = process.argv.slice(app.isPackaged ? 1 : 2);

if (cliArgs[0] === "set-key" || cliArgs[0] === "check-keys" || cliArgs[0] === "delete-key") {
  app.whenReady().then(async () => {
    try {
      const { BinaryManager } = require("./binary-manager.js");
      const bm = new BinaryManager();
      await bm.initialize();
      const aicpPath = bm.getBinaryPath("aicp");

      if (!aicpPath) {
        console.error("AICP binary not found. Install QCut or set up AICP standalone.");
        app.exit(1);
        return;
      }

      const { spawnSync } = require("child_process");
      const result = spawnSync(aicpPath, cliArgs, { stdio: "inherit" });
      app.exit(result.status ?? 1);
    } catch (err: any) {
      console.error("CLI error:", err.message);
      app.exit(1);
    }
  });
  // Return early - don't set up window, IPC handlers, etc.
} else {
  // ... existing app startup code (move current app.whenReady block inside this else)
}
```

This means running `QCut set-key FAL_KEY` from terminal will:
1. Resolve the bundled AICP binary
2. Delegate to `aicp set-key FAL_KEY` (secure hidden prompt)
3. Exit without opening any window

Supported CLI commands (all delegated to AICP):
- `QCut set-key <KEY_NAME>` -- securely set a key
- `QCut check-keys` -- show all key statuses
- `QCut delete-key <KEY_NAME>` -- remove a key

### Acceptance criteria

- `./QCut set-key FAL_KEY` prompts for key and saves without opening a window
- `./QCut check-keys` prints key status and exits
- Normal launch (no CLI args) still works exactly as before
- Handles missing binary gracefully with error message

---

## Subtask 4: Show key source badge in Settings UI

**~8 min** | Frontend (React)

### Files

| File | Action |
|------|--------|
| `apps/web/src/components/editor/properties-panel/settings-view.tsx` | Add source badges, call `status()` on mount |

### What to do

1. Add state for key statuses:

```typescript
const [keyStatuses, setKeyStatuses] = useState<Record<string, { set: boolean; source: string }> | null>(null);
```

2. In `loadApiKeys()` callback (~line 312), also fetch statuses:

```typescript
if (window.electronAPI?.apiKeys?.status) {
  const statuses = await window.electronAPI.apiKeys.status();
  setKeyStatuses(statuses);
}
```

3. Add a small `KeySourceBadge` component:

```tsx
function KeySourceBadge({ source }: { source: string }) {
  if (source === "not-set") return null;
  const labels: Record<string, string> = {
    environment: "env",
    electron: "app",
    "aicp-cli": "cli",
  };
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {labels[source] || source}
    </span>
  );
}
```

4. Render the badge next to each key's `PropertyGroup` title:

```tsx
<PropertyGroup title={
  <span className="flex items-center gap-2">
    FAL AI API Key
    {keyStatuses?.falApiKey && <KeySourceBadge source={keyStatuses.falApiKey.source} />}
  </span>
}>
```

### Acceptance criteria

- Badge shows "env", "app", or "cli" next to each key section
- No badge shown when key is not set
- Badge updates after saving keys
- No visual regression when `status()` IPC is unavailable (web mode)

---

## Subtask 5: Bump bundled AICP binary to v1.0.29+

**~5 min** | Build config

### Files

| File | Action |
|------|--------|
| `resources/bin/manifest.json` | Update version, checksums, download URLs |

### What to do

1. Update `binaries.aicp.version` from `"1.0.25"` to `"1.0.29"`
2. Update `sha256` checksums for all 4 platforms from the v1.0.29 GitHub release
3. Update `downloadUrl` for all 4 platforms to point to v1.0.29 release assets
4. Run `bun run stage-aicp-binaries` to download and verify the new binaries
5. Verify with: `./electron/resources/bin/aicp/darwin-arm64/aicp --version`

The v1.0.29 binary includes:
- `set-key` / `get-key` / `check-keys` / `delete-key` commands
- Persistent storage at `~/.config/video-ai-studio/credentials.env`
- Windows UTF-8 fix for emoji output
- Cross-platform checksum compatibility

### Acceptance criteria

- `aicp --version` returns 1.0.29
- `aicp set-key FAL_KEY` works from bundled binary
- `aicp check-keys` reports stored keys correctly
- All 4 platform checksums validate

---

## Subtask 6: Unit tests for AICP credential fallback

**~10 min** | Tests

### Files

| File | Action |
|------|--------|
| `electron/__tests__/api-key-injection.test.ts` | Add test cases for 3-tier fallback |
| `electron/__tests__/api-key-aicp-fallback.test.ts` | New file for AICP credential reader tests |

### Test cases for `api-key-aicp-fallback.test.ts`

```typescript
describe("loadAicpCredentials", () => {
  it("returns empty when credentials.env does not exist");
  it("parses FAL_KEY from credentials.env");
  it("parses multiple keys from credentials.env");
  it("ignores comments and blank lines");
  it("handles malformed lines gracefully");
  it("handles values with = signs in them");
});

describe("getDecryptedApiKeys with AICP fallback", () => {
  it("returns Electron key when both stores have the same key");
  it("returns AICP key when Electron store is empty");
  it("merges keys from both stores (different keys in each)");
  it("returns empty when both stores are empty");
});

describe("api-keys:status IPC", () => {
  it("reports 'environment' when env var is set");
  it("reports 'electron' when only Electron store has key");
  it("reports 'aicp-cli' when only AICP store has key");
  it("reports 'not-set' when no key exists anywhere");
  it("priority: env > electron > aicp-cli");
});
```

### Additions to existing `api-key-injection.test.ts`

Add to the existing spawn environment tests:

```typescript
describe("AICP fallback in spawn environment", () => {
  it("injects FAL_KEY from AICP store when Electron store is empty");
  it("prefers Electron-stored key over AICP-stored key");
  it("pre-flight still fails if key missing from all tiers");
});
```

### Acceptance criteria

- All new tests pass with `bun run test`
- Existing api-key-injection tests still pass unchanged
- Tests mock the filesystem (no real `~/.config` access)
- Coverage for all 3 tiers of fallback chain

---

## Verification checklist

After all subtasks are complete:

- [x] `bun run test` -- 2089 tests pass (156 files), including 21 new fallback tests
- [x] `bun check-types` -- no type errors
- [ ] `bun lint:clean` -- pending
- [ ] `bun run electron:dev` -- app starts, Settings UI shows key source badges
- [ ] Set key via CLI: `./QCut set-key FAL_KEY` -- prompts, saves, exits headless
- [ ] Check keys via CLI: `./QCut check-keys` -- prints status, exits
- [ ] Remove Electron key, verify AICP fallback works for AI generation
- [ ] Set env var `FAL_KEY`, verify it takes priority in status display
- [ ] Generate an image with key set only via CLI (no GUI setup)

---

## Architecture diagram

```
User sets key via...
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ export FAL_  │  │ Settings UI  │  │ QCut set-key │
│ KEY=xxx      │  │ (Electron)   │  │ (delegates   │
│              │  │              │  │  to aicp)    │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       ▼                 ▼                 ▼
  ┌─────────┐    ┌─────────────┐   ┌──────────────┐
  │ Tier 1  │    │   Tier 2    │   │    Tier 3    │
  │ env var │    │ safeStorage │   │ credentials  │
  │         │    │ api-keys.   │   │ .env (AICP)  │
  │ (shell) │    │ json        │   │ ~/.config/   │
  └────┬────┘    └──────┬──────┘   └──────┬───────┘
       │                │                 │
       └───────┬────────┴─────────────────┘
               ▼
    ┌─────────────────────┐
    │ getDecryptedApiKeys │
    │ (merged result)     │
    └──────────┬──────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌──────────┐      ┌─────────────┐
│ Spawn    │      │ Settings UI │
│ AICP     │      │ status()    │
│ binary   │      │ badge       │
└──────────┘      └─────────────┘
```
