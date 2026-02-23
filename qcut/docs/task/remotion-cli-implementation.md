# Remotion CLI: Prompt-to-Timeline Pipeline

## Context

QCut has full Remotion integration (19 built-in components, folder import, esbuild bundling, timeline rendering, frame caching, export compositing). However, there is no CLI command to generate Remotion components from a text prompt. The goal is to add a `generate-remotion` CLI command that:

1. Takes a user **PROMPT** describing the desired animation/effect
2. Invokes **Claude Code** with the `remotion-best-practices` skill to generate a `.tsx` component
3. **Bundles** the component with esbuild
4. **Registers** it in the Remotion store
5. **Adds** the component to the editor timeline

**Estimated implementation time**: ~3-4 hours (subtasks below)

---

## Architecture Overview

```
User prompt
  |
  v
CLI: generate-remotion --prompt "..." --add-to-timeline --project-id default
  |
  v
[1] Claude Code generates .tsx component (via PTY or SDK)
  |
  v
[2] Write component to project's remotion/ folder
  |
  v
[3] Bundle with esbuild (remotion-bundler.ts)
  |
  v
[4] POST to editor API: register component + add to timeline
  |
  v
Editor timeline: Remotion element with live preview
```

---

## Subtask 1: Register CLI Command

**Files**:
- `electron/native-pipeline/cli/cli.ts` — Add `"generate-remotion"` to `COMMANDS` array + help text
- `electron/native-pipeline/cli/cli-runner.ts` — Import handler + add switch case

**Pattern**: Same as `analyze-video`, `query-video` registration.

**Time**: ~10 min

---

## Subtask 2: Create CLI Handler

**File**: `electron/native-pipeline/cli/cli-handlers-remotion.ts` (new file)

Separate file to keep `cli-handlers-media.ts` under 800 lines.

### `handleGenerateRemotion(options, onProgress, signal): Promise<CLIResult>`

**Input options**:
- `--input/-i` or `--prompt`/`--text`: The user's description of the desired animation
- `--name`: Component name (auto-generated if not provided, e.g. `MyAnimation`)
- `--duration`: Duration in seconds (default: 5)
- `--width`/`--height`: Canvas dimensions (default: 1920x1080)
- `--add-to-timeline` + `--project-id`: Add to editor timeline after generation
- `--output-dir/-o`: Where to write the component file

**Steps**:

1. **Validate inputs** — require prompt
2. **Generate component name** — sanitize from prompt or use `--name`
3. **Build Claude Code prompt** — wrap user prompt with Remotion constraints:
   ```
   Generate a Remotion component named "{name}".
   Requirements:
   - User description: "{userPrompt}"
   - Duration: {duration} seconds at 30fps ({duration * 30} frames)
   - Canvas: {width}x{height}
   - Use useCurrentFrame() for ALL animations (CSS animations forbidden)
   - Export default the component
   - Use interpolate() for smooth transitions
   - Include a Zod schema export named "schema" for props
   Return ONLY the .tsx file content, no explanation.
   ```
4. **Call Claude Code** to generate the component (see Subtask 3)
5. **Write `.tsx` file** to output directory
6. **Bundle with esbuild** — reuse `remotion-bundler.ts` logic
7. **Save output JSON** with component metadata
8. **Timeline integration** — if `--add-to-timeline`, register + add element

**Output JSON**:
```typescript
{
  type: "remotion",
  name: string,
  prompt: string,
  componentPath: string,       // path to .tsx file
  bundlePath?: string,         // path to bundled .js
  duration: number,
  width: number,
  height: number,
  generationDuration: number,  // how long it took
}
```

**Time**: ~1 hour

---

## Subtask 3: Claude Code Invocation Strategy

The CLI needs to call an LLM to generate the Remotion component source code. Two approaches:

### Option A: Reuse existing `image_understanding` pipeline with code-gen prompt (Recommended for v1)

Use the existing `fal_video_qa` / Gemini model via `executor.executeStep()` with a code-generation prompt. The model returns the `.tsx` source as text.

**Pros**: Zero new infrastructure, works today, reuses API keys
**Cons**: Not using Claude Code / Remotion skill directly, code quality depends on prompt

**Implementation**:
```typescript
const step: PipelineStep = {
  type: "image_understanding",
  model: "fal_video_qa",  // Gemini 2.5 Flash
  params: { prompt: wrappedPrompt },
  enabled: true,
  retryCount: 0,
};
const result = await executor.executeStep(step, {}, { signal });
// Parse .tsx source from result.text
```

### Option B: Invoke Claude Code CLI via child_process (Future enhancement)

Spawn `claude` CLI with the Remotion skill loaded, passing the prompt. Claude Code generates higher-quality components using the full `remotion-best-practices` skill.

**Pros**: Uses Claude Code + skill system, highest quality output
**Cons**: Requires Claude Code installed, harder to test, nested session issues

**Implementation**:
```typescript
import { execFile } from "node:child_process";
const result = await new Promise((resolve, reject) => {
  execFile("claude", [
    "--print",
    "--prompt", wrappedPrompt,
    "--allowedTools", "Read,Write,Glob,Grep",
  ], { cwd: outputDir, timeout: 120000 }, (err, stdout) => {
    if (err) reject(err);
    else resolve(stdout);
  });
});
```

### Option C: Use Anthropic SDK directly (Best long-term)

Call Anthropic API directly with the Remotion best practices loaded as system context.

**Pros**: Full control, can load skill rules as system prompt, high quality
**Cons**: Requires `ANTHROPIC_API_KEY`, new provider integration

**Recommendation**: Start with **Option A** (Gemini via existing pipeline). The prompt can include key Remotion rules inline. Upgrade to Option C when Anthropic API is integrated as a provider.

**Time**: ~30 min (Option A), ~2 hours (Option B/C)

---

## Subtask 4: Component Bundling Integration

**Files**:
- `electron/remotion-bundler.ts` — Existing esbuild bundler (reuse)
- `electron/remotion-composition-parser.ts` — Existing parser (reuse)

The CLI handler needs to bundle the generated `.tsx` without Electron IPC. Two approaches:

### For CLI (standalone, no Electron)

Extract the bundling logic into a shared function that works in both Electron and CLI:

```typescript
// electron/remotion-bundler.ts — already exports:
export async function bundleComposition(
  entryPath: string,
  options?: BundleOptions
): Promise<{ code: string; error?: string }>
```

The CLI can import and call this directly since it runs in the same Node.js context via `bun`.

### For timeline integration (via editor API)

POST to `/api/claude/timeline/{projectId}/elements` with:
```json
{
  "type": "remotion",
  "componentId": "generated-{name}",
  "componentPath": "/path/to/Component.tsx",
  "startTime": 0,
  "duration": 5,
  "props": {}
}
```

The editor's Remotion store handles registration and bundling on the renderer side.

**Time**: ~30 min

---

## Subtask 5: Claude Bridge — Add Remotion Element Support

**Files**:
- `apps/web/src/lib/claude-bridge/claude-timeline-bridge.ts` — `onAddElement` handler
- `apps/web/src/lib/claude-bridge/claude-timeline-bridge-helpers.ts` — New `addClaudeRemotionElement()`

Currently, `onAddElement` handles media, text, markdown but **NOT remotion**. Add:

```typescript
// In claude-timeline-bridge-helpers.ts
export async function addClaudeRemotionElement({
  element,
  timelineStore,
}: {
  element: Partial<ClaudeElement>;
  timelineStore: TimelineStoreState;
}): Promise<void> {
  const trackId = timelineStore.findOrCreateTrack("remotion");
  const startTime = getElementStartTime({ element });
  const duration = getElementDuration({ element, fallbackDuration: 5 });

  timelineStore.addElementToTrack(trackId, {
    type: "remotion",
    name: element.sourceName || "Remotion",
    componentId: element.sourceId || element.componentId || "",
    componentPath: element.componentPath,
    props: element.props || {},
    renderMode: "live",
    startTime,
    duration,
    trimStart: 0,
    trimEnd: 0,
    opacity: 1,
  });
}
```

Also wire it up in the `onAddElement` handler:
```typescript
if (element.type === "remotion") {
  await addClaudeRemotionElement({ element, timelineStore });
  return;
}
```

**Time**: ~30 min

---

## Subtask 6: Remotion Folder Setup for Generated Components

**File**: `electron/native-pipeline/cli/cli-handlers-remotion.ts`

Generated components need a home. Use the project's remotion folder:

```
{project-root}/remotion/
  ├── generated/
  │   ├── MyAnimation.tsx        ← generated component
  │   ├── MyAnimation.bundle.js  ← esbuild output
  │   └── ...
  └── Root.tsx                   ← auto-generated entry (lists all generated components)
```

The handler should:
1. Create `remotion/generated/` directory if it doesn't exist
2. Write the `.tsx` component file
3. Optionally generate a `Root.tsx` that imports all generated components as `<Composition>` entries
4. Bundle via esbuild

**Time**: ~30 min

---

## Subtask 7: Editor API Route for Remotion Import

**File**: `electron/claude/http/claude-http-server.ts` or a new `claude-http-remotion-routes.ts`

Add endpoint for registering a generated Remotion component:

```
POST /api/claude/remotion/{projectId}/register
Body: {
  name: string,
  componentPath: string,       // absolute path to .tsx
  durationInFrames?: number,
  fps?: number,
  width?: number,
  height?: number,
  defaultProps?: Record<string, unknown>
}

Response: {
  success: true,
  data: { componentId: string }
}
```

This endpoint triggers:
1. `remotion-folder:scan` on the component directory
2. `remotion-folder:bundle` to compile the component
3. IPC notification to renderer to register in Remotion store

**Time**: ~45 min

---

## Key Files Reference

| Area | File | Purpose |
|------|------|---------|
| **CLI** | `electron/native-pipeline/cli/cli.ts` | Command registration |
| **CLI** | `electron/native-pipeline/cli/cli-runner.ts` | Command routing |
| **CLI** | `electron/native-pipeline/cli/cli-handlers-remotion.ts` | **New** handler |
| **Skill** | `.agents/skills/remotion-best-practices/SKILL.md` | Remotion rules for prompting |
| **Types** | `apps/web/src/types/timeline.ts` | `RemotionElement` interface (line 125) |
| **Types** | `electron/types/claude-api.ts` | `ClaudeElement` with remotion type |
| **Types** | `apps/web/src/lib/remotion/types.ts` | `RemotionComponentDefinition` |
| **Bundler** | `electron/remotion-bundler.ts` | esbuild bundling (reuse) |
| **Parser** | `electron/remotion-composition-parser.ts` | Composition extraction (reuse) |
| **Store** | `apps/web/src/stores/ai/remotion-store.ts` | Component registry + instances |
| **Bridge** | `apps/web/src/lib/claude-bridge/claude-timeline-bridge.ts` | Element addition handler |
| **Bridge** | `apps/web/src/lib/claude-bridge/claude-timeline-bridge-helpers.ts` | Helper functions |
| **Preview** | `apps/web/src/components/editor/preview-panel/remotion-preview.tsx` | Preview renderer |
| **Folder** | `electron/remotion-folder-handler.ts` | IPC for folder operations |
| **HTTP** | `electron/claude/http/claude-http-server.ts` | REST API endpoints |

---

## Implementation Order

```
Subtask 1 (10 min)  → Register CLI command
Subtask 2 (60 min)  → Create handler + prompt wrapping
Subtask 3 (30 min)  → LLM invocation (Option A: Gemini)
Subtask 5 (30 min)  → Claude bridge Remotion support
Subtask 6 (30 min)  → Folder structure for generated components
Subtask 4 (30 min)  → Bundling integration
Subtask 7 (45 min)  → Editor API route for registration
                     ─────────────
                     ~4 hours total
```

---

## Testing Plan

### Unit Tests
- `electron/__tests__/cli-handlers-remotion.test.ts` — Test prompt wrapping, JSON parsing, file writing
- Mock executor to return sample `.tsx` source code
- Test component name sanitization

### Integration Tests
```bash
# Test 1: Generate component only (no timeline)
bun electron/native-pipeline/cli/cli.ts generate-remotion \
  --prompt "A bouncing ball animation with a trail effect" \
  --name BouncingBall --duration 3

# Test 2: Generate + add to timeline
bun electron/native-pipeline/cli/cli.ts generate-remotion \
  --prompt "Animated title card that reads 'Four Seasons' with fade-in" \
  --name TitleCard --duration 5 \
  --add-to-timeline --project-id default

# Test 3: Verify in editor
curl http://127.0.0.1:8765/api/claude/timeline/default
# Should show a remotion element on the timeline
```

### Manual Verification
1. Open QCut editor after generation
2. Verify Remotion element appears on timeline (purple/violet block)
3. Preview panel renders the component at correct frames
4. Scrubbing timeline updates Remotion preview in sync

---

## Future Enhancements

1. **Claude Code SDK integration** — Use Anthropic API directly with full `remotion-best-practices` skill as system context for higher quality generation
2. **Iterative refinement** — Allow `--refine` flag to take existing component + feedback prompt and regenerate
3. **Template selection** — `--template typewriter|lower-third|title-card` to start from built-in components
4. **Props from prompt** — Parse user intent into Zod schema props (e.g., "blue background" → `backgroundColor: "#0000ff"`)
5. **Preview before commit** — Generate, preview in editor, then confirm or regenerate
