# Media Import API Bug Report

**Date:** 2026-02-15
**Project:** QCut v0.3.67
**Severity:** High — breaks core API-driven workflow

---

## Problem

When importing media via the HTTP REST API and adding it to the timeline, the **media appears broken in the editor**. The images show on the timeline as elements but cannot be rendered because the renderer doesn't know about the files.

### Root Cause: Dual ID System Mismatch

QCut has **two separate media registration systems** that don't talk to each other:

| System | Where | ID Format | Example |
|--------|-------|-----------|---------|
| HTTP Media API | `claude-media-handler.ts` | Deterministic base64 of filename | `media_dmFsZW50aW5lXzAx...` |
| Renderer Media Store | Zustand store (frontend) | Random UUID | `dc777029-09f4-24e9-...` |

### What Happens Step by Step

```
1. POST /api/claude/media/:projectId/import
   → File copied to media/ directory ✅
   → Returns media_base64(filename) ID ✅
   → Renderer Zustand store: NOT notified ❌

2. POST /api/claude/timeline/:projectId/elements
   → Element created with sourceName ✅
   → Renderer generates a random UUID sourceId ✅
   → sourceId doesn't map to anything in Zustand media store ❌
   → Result: broken media reference in timeline ❌
```

### What We Observed

- **Files on disk:** Valid PNGs at `media/valentine_*.png` (1376x768, ~1.5MB each)
- **Media API response:** Success, files listed correctly
- **Timeline API response:** Success, 4 elements at 0-5s, 5-10s, 10-15s, 15-20s
- **Editor UI:** Timeline elements visible but images broken/unresolved

---

## What Was Fixed (Workaround)

No code fix was applied. The workaround is:

1. Files were generated with AICP and saved to `media/generated/images/`
2. API import copied them to `media/` — files exist on disk
3. Timeline elements were added via API — they appear in the editor
4. **Manual step required:** User must drag-drop files from `media/` into QCut's media panel to register them in the Zustand store

This defeats the purpose of the API.

---

## Code That Needs Modification

### File 1: `electron/claude/claude-media-handler.ts`

**Problem:** The `import` handler copies the file to disk but doesn't notify the renderer.

**Fix:** After copying the file, send an IPC event to the renderer so it registers the media in its Zustand store.

```typescript
// CURRENT: File copy only
async function handleMediaImport(projectId, sourcePath) {
  // ... copies file to media/ directory
  // Returns file info
  return { id, name, type, path, size };
}

// PROPOSED: File copy + renderer notification
async function handleMediaImport(projectId, sourcePath) {
  // ... copies file to media/ directory
  const fileInfo = { id, name, type, path, size };

  // NEW: Notify renderer to register media in Zustand store
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('claude:media:imported', {
      projectId,
      file: fileInfo
    });
  }

  return fileInfo;
}
```

### File 2: `apps/web/src/lib/claude-timeline-bridge.ts` (or equivalent renderer bridge)

**Problem:** No listener for `claude:media:imported` events.

**Fix:** Add a listener that registers the imported file in the Zustand media store.

```typescript
// NEW: Listen for API-imported media
window.electronAPI.claude.media.onImported((fileInfo) => {
  const mediaStore = useMediaStore.getState();
  mediaStore.addMedia({
    id: crypto.randomUUID(),    // Renderer's UUID
    name: fileInfo.name,
    type: fileInfo.type,
    path: fileInfo.path,
    size: fileInfo.size,
    // ... other fields
  });
});
```

### File 3: `electron/claude/claude-timeline-handler.ts`

**Problem:** `addElement` accepts `sourceName` but generates a random `sourceId` that doesn't map to the renderer's media store.

**Fix:** When adding an element, resolve `sourceName` to the renderer's actual media UUID.

```typescript
// CURRENT: Random sourceId generation
async function handleAddElement(projectId, element) {
  // sourceName is passed but sourceId is auto-generated
  // The generated sourceId has no relation to the media store
}

// PROPOSED: Resolve sourceName → renderer media UUID
async function handleAddElement(projectId, element) {
  if (element.sourceName) {
    // Ask renderer for the media UUID matching this filename
    const mediaId = await resolveMediaId(element.sourceName);
    element.sourceId = mediaId;
  }
  // ... proceed with adding element
}
```

### File 4: `electron/preload.ts` (or preload script)

**Problem:** No IPC channel exposed for `claude:media:imported`.

**Fix:** Add the channel to the preload API.

```typescript
// Add to the claude.media namespace in preload
media: {
  // ... existing methods
  onImported: (callback) =>
    ipcRenderer.on('claude:media:imported', (_event, data) => callback(data)),
}
```

---

## Ideal One-Shot Flow

After the fix, this single API sequence should work end-to-end:

```bash
# 1. Import media → file copied AND registered in renderer
curl -X POST -H "Content-Type: application/json" \
  -d '{"source":"/path/to/image.png"}' \
  http://127.0.0.1:8765/api/claude/media/PROJECT_ID/import

# 2. Add to timeline → sourceId correctly resolved
curl -X POST -H "Content-Type: application/json" \
  -d '{"type":"image","trackIndex":0,"startTime":0,"endTime":5,"sourceName":"image.png"}' \
  http://127.0.0.1:8765/api/claude/timeline/PROJECT_ID/elements

# Result: Image appears on timeline AND renders correctly ✅
```

---

## Files to Modify (Summary)

| File | Change |
|------|--------|
| `electron/claude/claude-media-handler.ts` | Send IPC `claude:media:imported` after file copy |
| `electron/preload.ts` | Expose `claude:media:imported` channel |
| `apps/web/src/lib/claude-timeline-bridge.ts` | Listen for import event, register in Zustand store |
| `electron/claude/claude-timeline-handler.ts` | Resolve `sourceName` → renderer media UUID in `addElement` |
| `electron/types/claude-api.ts` | Add type for `MediaImportedEvent` |

---

## Bug 2: AICP Nano Banana Pro — Silent Failure on Image Generation

**Severity:** Medium — wastes API credits, produces no output, reports false success

### What Happened

The first batch of 4 image generations using `aicp generate-image --model nano_banana_pro` all reported **success but saved nothing**:

```
Image generation successful!
Model: nano_banana_pro
Cost: $0.002
Processing time: 0.0 seconds   ← RED FLAG: real generation takes ~20s
```

No output file path was printed. No files were written anywhere on disk. But the CLI exited 0 and printed a success message. We were charged 4x $0.002 = **$0.008 wasted**.

### Root Cause: `source .env` vs `export FAL_KEY`

The `.env` file contains the FAL API key:

```
FAL_KEY=137e7c24-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

The commands were run as:

```bash
# BROKEN — key set in shell but NOT exported to child process
source .env && /path/to/aicp generate-image --model nano_banana_pro ...
```

`source .env` sets `FAL_KEY` as a **shell variable**, not an **environment variable**. The AICP binary is a child process and doesn't inherit shell-only variables. It needs `export`:

```bash
# WORKING — key exported to child process environment
source .env && export FAL_KEY && /path/to/aicp generate-image --model nano_banana_pro ...
```

### Why It's a Bug (Not Just User Error)

The AICP CLI has **3 separate failures** that compound into a silent disaster:

#### 1. False Success on Auth Failure

When `FAL_KEY` is missing from the process environment, AICP still prints:

```
Image generation successful!
Cost: $0.002
Processing time: 0.0 seconds
```

**Expected behavior:** Should exit non-zero with an error like `ERROR: FAL_KEY not set. Cannot generate images.`

The `0.0 seconds` processing time is the giveaway — real Nano Banana Pro generation takes 17-25 seconds. But a user running batch jobs won't notice this.

#### 2. No Output Path on Failure

On a real success, AICP prints the output path:

```
💾 Saving base64 image to: output/generated_image_1771076486.png
✅ Image saved successfully! (1552.5 KB)
📥 Image saved to: output/generated_image_1771076486.png
Output: output/generated_image_1771076486.png
```

On the silent failure, none of these lines appear — but the exit code is still 0 and it still says "successful". There's no indication that nothing was saved.

#### 3. `--output-dir` Flag Silently Ignored

We passed `--output-dir media/generated/images` but files always saved to `output/` (the default). The flag is accepted without error but has no effect:

```bash
# This flag does nothing
aicp generate-image --output-dir media/generated/images ...

# Files always go here regardless
output/generated_image_TIMESTAMP.png
```

### What It Cost Us

| Attempt | FAL_KEY Status | Result | Files Saved | Cost |
|---------|---------------|--------|-------------|------|
| Run 1 (4 images) | `source` only, not exported | False success, 0.0s each | 0 | $0.008 wasted |
| Run 2 (1 image, debug) | `export FAL_KEY` | Real success, 22.3s | 1 | $0.002 |
| Run 3 (3 images) | `export FAL_KEY` | Real success, 17-24s each | 3 | $0.006 |
| **Total** | | | **4 usable images** | **$0.016** ($0.008 wasted) |

### AICP Code Fixes Needed

#### Fix 1: Fail fast when FAL_KEY is missing

```python
# In the generate-image command handler
def generate_image(model, text, **kwargs):
    if model in FAL_MODELS and not os.environ.get('FAL_KEY'):
        print("❌ ERROR: FAL_KEY environment variable is not set.")
        print("   Set it with: export FAL_KEY=your_key")
        sys.exit(1)
```

#### Fix 2: Exit non-zero when no image is produced

```python
# After generation attempt
result = generate(prompt, model)
if not result or not result.get('images'):
    print("❌ ERROR: No image was generated. Check API key and model availability.")
    sys.exit(1)
```

#### Fix 3: Respect `--output-dir` flag

```python
# Currently hardcoded to 'output/'
output_path = os.path.join('output', filename)

# Should use the user-specified directory
output_path = os.path.join(args.output_dir or 'output', filename)
os.makedirs(os.path.dirname(output_path), exist_ok=True)
```

#### Fix 4: QCut app-mode should inject `FAL_KEY` via `export`

In QCut's Electron main process where it spawns AICP, the key should be passed in the `env` option of `child_process.spawn()`:

```typescript
// electron/main — when spawning aicp
const child = spawn(aicpBinaryPath, args, {
  env: {
    ...process.env,
    FAL_KEY: getDecryptedFalKey(),  // Inject from secure storage
  }
});
```

This is documented as already happening ("FAL_KEY injection at spawn time"), but in standalone CLI mode the user must manually `export` — and the CLI should validate this before making API calls.

### Summary of AICP Issues

| Issue | Current Behavior | Expected Behavior |
|-------|-----------------|-------------------|
| Missing FAL_KEY | Silent false success, exit 0 | Hard error, exit 1 |
| No image produced | Prints "successful", no file path | Error with clear message |
| `--output-dir` flag | Silently ignored | Respected, creates dirs |
| Processing time 0.0s | No warning | Warning or error (generation can't be instant) |
