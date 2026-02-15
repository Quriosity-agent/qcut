# Robust FAL Key Setup via CLI

**Date**: 2026-02-15
**Status**: Proposed
**Scope**: QCut Electron + AICP binary integration

---

## Problem

QCut and AICP have **two disconnected credential stores**:

| System | Storage | Location | Set via |
|--------|---------|----------|---------|
| QCut Electron | `safeStorage` encrypted JSON | `userData/api-keys.json` | Settings UI only |
| AICP CLI | Plaintext dotenv (0o600) | `~/.config/video-ai-studio/credentials.env` | `aicp set-key` CLI |

**Pain points**:
1. Users must open the QCut GUI to set a key -- no headless/CLI option
2. Keys set via `aicp set-key` are ignored when QCut spawns AICP (QCut only reads its own store)
3. If QCut's Electron storage is corrupted or cleared, there's no fallback
4. CI/automation workflows can't configure keys without a running Electron app
5. Debugging key issues requires launching the full editor

---

## Proposed Solution

Unify key resolution into a **3-tier fallback chain** in QCut's Electron main process, and add a **CLI-first key setter** that writes to AICP's credential store (which both systems can read).

### Key Resolution Order (highest priority wins)

```
1. Environment variable   →  FAL_KEY / FAL_API_KEY in shell
2. QCut Electron store    →  userData/api-keys.json (safeStorage)
3. AICP credential store  →  ~/.config/video-ai-studio/credentials.env
```

This means:
- GUI-set keys still work as before (tier 2)
- `aicp set-key FAL_KEY` now works as a fallback (tier 3)
- `export FAL_KEY=...` overrides everything (tier 1, already works)

### New: QCut CLI key setter

Add a thin wrapper so users can set keys from terminal without knowing AICP internals:

```bash
# Using the bundled AICP binary
qcut set-key FAL_KEY
# → prompts securely, saves to ~/.config/video-ai-studio/credentials.env

# Check all keys
qcut check-keys
# → shows status from all 3 tiers
```

---

## Implementation Plan

### Step 1: Read AICP credentials in Electron main process

**File**: `electron/api-key-handler.ts`

Add a function to read AICP's credential store as a fallback:

```typescript
function loadAicpCredentials(): Partial<ApiKeys> {
  const credPath = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".config",
    "video-ai-studio",
    "credentials.env"
  );

  if (!fs.existsSync(credPath)) return {};

  const content = fs.readFileSync(credPath, "utf-8");
  const keys: Partial<ApiKeys> = {};

  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (!match) continue;
    const [, name, value] = match;
    if (name === "FAL_KEY") keys.falApiKey = value;
    if (name === "GEMINI_API_KEY") keys.geminiApiKey = value;
    if (name === "OPENROUTER_API_KEY") keys.openRouterApiKey = value;
  }

  return keys;
}
```

Modify `getDecryptedApiKeys()` to merge:

```typescript
export async function getDecryptedApiKeys(): Promise<ApiKeys> {
  const electronKeys = await loadElectronKeys();   // existing logic
  const aicpKeys = loadAicpCredentials();           // new fallback

  return {
    falApiKey:        electronKeys.falApiKey        || aicpKeys.falApiKey        || "",
    geminiApiKey:     electronKeys.geminiApiKey     || aicpKeys.geminiApiKey     || "",
    openRouterApiKey: electronKeys.openRouterApiKey || aicpKeys.openRouterApiKey || "",
    freesoundApiKey:  electronKeys.freesoundApiKey  || "",
    anthropicApiKey:  electronKeys.anthropicApiKey  || "",
  };
}
```

### Step 2: Add CLI key commands via Electron CLI flags

**File**: `electron/main.ts`

Handle `--set-key` and `--check-keys` flags before app window creation:

```typescript
// Early in main.ts, before app.whenReady()
const args = process.argv.slice(2);

if (args[0] === "set-key" && args[1]) {
  // Delegate to bundled AICP binary
  const aicp = resolveBundledAicpPath();
  const result = spawnSync(aicp, ["set-key", args[1]], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

if (args[0] === "check-keys") {
  // Show unified status from all 3 tiers
  await showUnifiedKeyStatus();
  process.exit(0);
}
```

This keeps it simple -- delegate to AICP's existing secure CLI for the actual key storage, just wire it into QCut's entrypoint.

### Step 3: Update `buildSpawnEnvironment()` (already works)

**File**: `electron/ai-pipeline-handler.ts`

No changes needed here. `buildSpawnEnvironment()` already calls `getDecryptedApiKeys()`, so once Step 1 merges AICP credentials, the spawn environment automatically picks them up.

### Step 4: Add `check-keys` IPC for Settings UI status

**File**: `electron/api-key-handler.ts`

Add an IPC handler that returns key status with source info:

```typescript
ipcMain.handle("api-keys:status", async () => {
  const envKeys = { falApiKey: process.env.FAL_KEY || "" };
  const electronKeys = await loadElectronKeys();
  const aicpKeys = loadAicpCredentials();

  return {
    falApiKey: {
      set: !!(envKeys.falApiKey || electronKeys.falApiKey || aicpKeys.falApiKey),
      source: envKeys.falApiKey ? "environment" :
              electronKeys.falApiKey ? "electron" :
              aicpKeys.falApiKey ? "aicp-cli" : "not set",
    },
    // ... same for other keys
  };
});
```

### Step 5: Update Settings UI to show key source

**File**: `apps/web/src/components/editor/properties-panel/settings-view.tsx`

Show a small badge next to each key field indicating where the active key comes from:

```
FAL API Key: ●●●●●●●●  [source: aicp-cli]
```

This helps users understand which tier is active and whether their CLI-set key is being used.

### Step 6: Update AICP binary to v1.0.29+

**File**: `resources/bin/manifest.json`

Bump the bundled AICP version to >= 1.0.29 which includes the full `set-key`/`get-key`/`check-keys`/`delete-key` CLI commands and Windows UTF-8 fixes.

---

## Files to Modify

| File | Change |
|------|--------|
| `electron/api-key-handler.ts` | Add `loadAicpCredentials()`, merge into `getDecryptedApiKeys()`, add `api-keys:status` IPC |
| `electron/main.ts` | Add `set-key` / `check-keys` CLI flag handling |
| `electron/preload.ts` | Expose `api-keys:status` to renderer |
| `apps/web/src/types/electron.d.ts` | Add `status()` type to apiKeys interface |
| `settings-view.tsx` | Show key source badge |
| `resources/bin/manifest.json` | Bump AICP version to 1.0.29+ |

---

## Testing

1. **Unit**: Extend `electron/__tests__/api-key-injection.test.ts` with AICP fallback cases
2. **Manual CLI**:
   - `./QCut set-key FAL_KEY` → prompts, saves to `~/.config/video-ai-studio/credentials.env`
   - `./QCut check-keys` → shows all 3 tiers
   - Remove key from Electron store → verify AICP fallback kicks in
   - Set env var → verify it wins over both stores
3. **Integration**: Generate an image with key set only via CLI (no GUI setup)

---

## Migration

- No breaking changes. Existing QCut Electron-stored keys remain highest non-env priority.
- Users who already use `aicp set-key` get automatic key pickup with no action needed.
- The `VITE_FAL_API_KEY` env var in renderer continues to work for dev/web mode.
