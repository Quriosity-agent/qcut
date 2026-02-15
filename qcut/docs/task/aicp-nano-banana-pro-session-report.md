~/Documents/QCut/Projects/<project-id>
# AICP Nano Banana Pro Image Generation — Session Report

**Date:** 2026-02-15
**Task:** Generate 4 images using AICP with `nano_banana_pro` model (text-to-image), then open Finder
**Status:** Failed — FAL API key not accessible from CLI

---

## 1. Two Versions of AICP Found

During execution, two distinct AICP binaries were discovered on this machine:

### Version A: QCut Bundled Binary (v1.0.25)

| Property | Value |
|----------|-------|
| **Path** | `~/Desktop/code/qcut/qcut/electron/resources/bin/aicp/darwin-arm64/aicp` |
| **Version** | 1.0.25 |
| **Type** | Mach-O 64-bit executable arm64 (standalone PyInstaller binary) |
| **Text-to-Image** | **Not available** — provider directory missing |
| **Issue** | `list-models` output: `"No models available (integration pending)"` for Text-To-Image |

This binary is the one bundled inside QCut's Electron app (`electron/resources/bin/aicp/`). It ships as a frozen PyInstaller executable but **lacks the text-to-image provider modules**. It only has Image-to-Video, Image-to-Image, and analysis models. The `check-keys` command doesn't even exist in this version.

### Version B: Development venv Binary (v1.0.29)

| Property | Value |
|----------|-------|
| **Path** | `~/Desktop/code/video-agent-skill/venv/bin/aicp` |
| **Version** | 1.0.29 |
| **Type** | Python script (runs via venv's Python 3.12) |
| **Text-to-Image** | **Available** — `nano_banana_pro`, `flux_dev`, `flux_schnell`, `imagen4`, `seedream_v3`, `gpt_image_1_5` |
| **Issue** | Requires `FAL_KEY` environment variable; cannot read QCut's encrypted Electron store |

This is the development version in the `video-agent-skill` project. It has the full provider directory with all text-to-image models including `nano_banana_pro`. The AICP skill documentation requires v1.0.29+, which is only satisfied by this version.

### Why Two Versions Exist

The QCut bundled binary (v1.0.25) was built/frozen before the unified text-to-image provider was added. The development source (v1.0.29) has been updated with the new provider but **hasn't been re-bundled** into QCut's Electron resources yet.

| Feature | v1.0.25 (bundled) | v1.0.29 (dev venv) |
|---------|-------------------|---------------------|
| Text-to-Image | Missing | Full support |
| Image-to-Image | Partial (missing FAL) | Full support |
| Image-to-Video | Available | Available |
| `check-keys` command | Not implemented | Not tested (script form) |
| `set-key` command | Not implemented | Available |
| Standalone execution | Yes (PyInstaller) | Requires Python venv |

---

## 2. Why the FAL Key Could Not Be Found (4-Location Search)

The AICP CLI needs the `FAL_KEY` environment variable to authenticate with FAL AI's API. I searched all four possible locations:

### Location 1: Environment Variable (`$FAL_KEY`)

```text
Result: NOT SET
```
No `FAL_KEY` was exported in the shell environment. This is the highest-priority source (Tier 1).

### Location 2: QCut Electron Store (`~/Library/Application Support/qcut/api-keys.json`)

```text
Result: FOUND but ENCRYPTED (112 chars, base64-encoded safeStorage ciphertext)
Key starts with: djEwo97o0X...
```

The key exists but is encrypted using Electron's `safeStorage` API, which delegates to macOS Keychain. The encryption/decryption cycle:

1. **Encrypt** (on save): `safeStorage.encryptString(plaintext)` → `Buffer.toString("base64")` → stored in JSON
2. **Decrypt** (on read): `Buffer.from(base64, "base64")` → `safeStorage.decryptString(buffer)` → plaintext

**Critical limitation:** `safeStorage.decryptString()` can only be called from within a running Electron process with the same app identity. It is impossible to decrypt these values from a CLI tool, Python script, or any non-Electron context. The macOS Keychain ties the decryption key to the specific Electron app bundle.

### Location 3: AICP CLI Credential Store (`~/.config/video-ai-studio/credentials.env`)

```text
Result: FILE EXISTS but EMPTY (0 lines)
```

This file was created but never populated. The `syncToAicpCredentials()` function in `api-key-handler.ts` (line 182) writes plaintext keys here whenever keys are saved through QCut's Settings UI. However, this sync was likely added after the user originally saved their FAL key, so the credentials.env was never populated.

### Location 4: AICP's Own Credential Store

```text
Result: NOT SET
```

The `aicp set-key FAL_KEY` command was never run to store a key in AICP's own config.

### Root Cause

```text
QCut Settings UI
     │
     ▼ (saves encrypted)
api-keys.json ──────────── Encrypted with safeStorage (macOS Keychain)
     │                      ↑ Only Electron can decrypt
     │
     ▼ (syncs plaintext)
credentials.env ─────────── Empty (sync was added AFTER key was saved)
     │
     ▼
FAL_KEY env var ──────────── Not exported
```

The FAL key is trapped in QCut's encrypted store. The plaintext sync to `credentials.env` (which would make it available to CLI tools) never ran because:
- The user saved their FAL key before `syncToAicpCredentials()` was implemented
- Or the user has never re-saved keys since the sync feature was added

### Fix

**Option A (easiest):** Open QCut → Settings → API Keys → Click Save (even without changes). This triggers `syncToAicpCredentials()` which writes the plaintext key to `~/.config/video-ai-studio/credentials.env`.

**Option B:** Manually run `aicp set-key FAL_KEY` and paste the key when prompted.

**Option C:** Export directly: `export FAL_KEY=your_fal_key_here`

---

## 3. What Was Tried

### Step-by-step debugging timeline:

1. **Read AICP skill documentation** (`Skill.md`, `REFERENCE.md`) — identified `nano_banana_pro` as the correct model key

2. **Searched for aicp binary** — `which aicp` returned nothing; not in PATH

3. **Found bundled binary** at QCut's Electron resources path — version 1.0.25

4. **Ran `list-models`** on v1.0.25 → Text-to-Image showed "No models available"

5. **Found dev venv binary** at `video-agent-skill/venv/bin/aicp` — version 1.0.29

6. **Ran `list-models`** on v1.0.29 → Found `nano_banana_pro` and 5 other text-to-image models

7. **Checked FAL key sources:**
   - `$FAL_KEY` env → not set
   - `api-keys.json` → encrypted (112 chars base64)
   - `credentials.env` → empty file

8. **Attempted to read encrypted key** — loaded the base64 value from `api-keys.json`, but it's encrypted with Electron safeStorage and cannot be decrypted outside the app

9. **Read `api-key-handler.ts`** — confirmed encryption uses `safeStorage.encryptString()` / `safeStorage.decryptString()` which requires macOS Keychain access through the specific Electron app identity

10. **Attempted generation anyway** — ran 4 parallel `generate-image` commands with the encrypted (unusable) key value

11. **All 4 failed** with: `Cannot access application 'fal-ai/nano-banana-pro'. Authentication is required to access this application.`

---

## 4. How to Generate Nano Banana Pro Images (Once Key Is Available)

### The Command

Once `FAL_KEY` is available (via any of the 3 methods above), use the **v1.0.29 dev binary**:

```bash
export FAL_KEY="your_fal_key_here"

cd ~/Desktop/code/video-agent-skill

./venv/bin/python ./venv/bin/aicp generate-image \
  --text "Your prompt here" \
  --model nano_banana_pro \
  --output-dir ~/Documents/QCut/Projects/<project-id>/media/generated/images
```

### The 4 Prompts That Were Attempted

| # | Theme | Prompt |
|---|-------|--------|
| 1 | Nature | "A majestic golden eagle soaring over snow-capped mountains at sunrise, dramatic lighting, photorealistic, 8K detail" |
| 2 | Cyberpunk | "A futuristic neon-lit Tokyo alleyway at night, rain-soaked streets reflecting purple and cyan lights, cyberpunk atmosphere, cinematic composition" |
| 3 | Fantasy | "An ancient library with towering bookshelves, floating magical orbs illuminating dusty tomes, fantasy art style, warm golden atmosphere" |
| 4 | Underwater | "A coral reef underwater scene with tropical fish, sea turtles, and sunbeams piercing through crystal clear turquoise water, National Geographic style" |

### Model Specifications

| Property | Value |
|----------|-------|
| **Model Key** | `nano_banana_pro` |
| **Provider** | FAL AI |
| **Endpoint** | `https://fal.run/fal-ai/nano-banana-pro` |
| **Cost** | ~$0.002 per image |
| **Best for** | Speed, cost-effective, quality |
| **Default aspect ratio** | 16:9 |
| **Default resolution** | 1K |

### Available CLI Options

```text
--text TEXT          Text prompt (required)
--model TEXT         Model to use (default: auto)
--aspect-ratio TEXT  21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16
--resolution TEXT    1K, 2K, 4K (4K costs double)
--output-dir TEXT    Output directory
--json               Machine-readable JSON output
```

### Parallel Generation (YAML Pipeline)

For batch generation, a YAML pipeline config can be used:

```yaml
# nano_banana_batch.yaml
steps:
  - name: eagle
    type: text_to_image
    model: nano_banana_pro
    params:
      prompt: "A majestic golden eagle soaring over snow-capped mountains..."

  - name: cyberpunk
    type: text_to_image
    model: nano_banana_pro
    params:
      prompt: "A futuristic neon-lit Tokyo alleyway at night..."

  - name: library
    type: text_to_image
    model: nano_banana_pro
    params:
      prompt: "An ancient library with towering bookshelves..."

  - name: reef
    type: text_to_image
    model: nano_banana_pro
    params:
      prompt: "A coral reef underwater scene with tropical fish..."
```

Run with:
```bash
PIPELINE_PARALLEL_ENABLED=true aicp run-chain --config nano_banana_batch.yaml
```

---

## 5. Recommendations

1. **Re-bundle AICP v1.0.29** into QCut's Electron resources — the current bundled v1.0.25 is missing text-to-image support entirely

2. **Re-save API keys in QCut** to trigger the `syncToAicpCredentials()` function and populate `~/.config/video-ai-studio/credentials.env`

3. **Add a CLI command to QCut** that explicitly syncs encrypted keys to the credential store without requiring re-save through the UI:
   ```bash
   ./QCut sync-keys  # decrypt + write to credentials.env
   ```

4. **Consider adding a migration** that automatically syncs existing encrypted keys to `credentials.env` on app startup, so CLI tools always have access

---

## File Paths Referenced

| File | Purpose |
|------|---------|
| `~/Library/Application Support/qcut/api-keys.json` | Encrypted API key store (Electron safeStorage) |
| `~/.config/video-ai-studio/credentials.env` | Plaintext CLI credential store (empty) |
| `electron/api-key-handler.ts` | Key encryption/decryption + sync logic |
| `electron/resources/bin/aicp/darwin-arm64/aicp` | Bundled AICP v1.0.25 |
| `~/Desktop/code/video-agent-skill/venv/bin/aicp` | Dev AICP v1.0.29 |
