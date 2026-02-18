# Implement Native Video Agent Skill in QCut

**Created**: 2026-02-18
**Estimated Total Time**: ~4-6 hours (8 subtasks)
**Priority**: Long-term maintainability > scalability > performance

---

## Problem Statement

QCut currently relies on an **external Python binary** (`aicp`) for AI content generation. The `AIPipelineManager` in `electron/ai-pipeline-handler.ts` spawns child processes, parses stdout/stderr, and manages binary detection across three fallback strategies (bundled binary → system command → Python module).

**Current Pain Points**:
1. **Heavy dependency**: Requires Python runtime or a 100MB+ PyInstaller binary
2. **Fragile IPC**: Communicates via stdout JSON parsing and stderr progress scraping
3. **Duplicate code**: Frontend already has direct FAL.ai TypeScript clients in `apps/web/src/lib/ai-video/` that duplicate ~60% of AICP's functionality
4. **Complex distribution**: Binary manifests, checksums, version compatibility matrices
5. **Slow startup**: Binary detection probes 4 strategies with 5-second timeouts each
6. **Limited error context**: Process exit codes lose stack traces and error details

## Solution: Native TypeScript Video Agent Skill

Replace the Python binary with a **native TypeScript module** running inside Electron's Node.js process. This module mirrors the AICP registry + pipeline architecture but uses the existing FAL.ai TypeScript client as its execution engine.

### Architecture Overview

```text
Before (Python binary):
  Renderer → IPC → AIPipelineManager → spawn("aicp") → Python → FAL API
                                      ↕ stdout/stderr

After (Native TypeScript):
  Renderer → IPC → NativePipelineManager → ModelRegistry → FAL/Google/ElevenLabs API
                                          → PipelineExecutor → step-by-step execution
```

### What Changes vs. What Stays

| Component | Change |
|-----------|--------|
| `electron/ai-pipeline-ipc.ts` | Keep IPC channels, swap handler to native |
| `electron/ai-pipeline-handler.ts` | Keep as legacy fallback; native pipeline preferred via feature flag |
| `electron/ai-pipeline-output.ts` | Keep (used by legacy handler and for `inferProjectIdFromPath`) |
| `electron/binary-manager.ts` | Keep for FFmpeg; remove AICP binary logic |
| `apps/web/src/lib/ai-video/` | Becomes the execution engine (shared) |
| `apps/web/src/hooks/use-ai-pipeline.ts` | No changes (IPC interface unchanged) |
| `apps/web/src/components/editor/media-panel/views/ai/` | No changes |
| `packages/video-agent-skill/` | Keep as reference; no longer runtime dependency |

---

## Subtasks

### Subtask 1: Create Native Model Registry (TypeScript)
**Estimated Time**: 45 min
**Description**: Port the Python `ModelRegistry` + `registry_data.py` (73 models) to a TypeScript registry module.

**Key Files**:
- **Create**: `electron/native-pipeline/registry.ts` — `ModelDefinition` interface + `ModelRegistry` class
- **Create**: `electron/native-pipeline/registry-data.ts` — All 73 model definitions as typed constants
- **Reference**: `packages/video-agent-skill/packages/core/ai_content_pipeline/ai_content_pipeline/registry.py`
- **Reference**: `packages/video-agent-skill/packages/core/ai_content_pipeline/ai_content_pipeline/registry_data.py`

**Details**:
```typescript
// electron/native-pipeline/registry.ts
export interface ModelDefinition {
  key: string;                          // "kling_3_standard"
  name: string;                         // "Kling v3 Standard"
  provider: string;                     // "Kling"
  endpoint: string;                     // "fal-ai/kling-video/v3/standard/text-to-video"
  categories: ModelCategory[];          // ["text_to_video", "image_to_video"]
  description: string;
  pricing: ModelPricing;
  durationOptions: (string | number)[];
  aspectRatios: string[];
  providerKey: string;
  resolutions: string[];
  defaults: Record<string, unknown>;
  features: string[];
  maxDuration: number;
  extendedParams: string[];
  extendedFeatures: Record<string, boolean>;
  inputRequirements: { required: string[]; optional: string[] };
  costEstimate: number;
  processingTime: number;
}

export type ModelCategory =
  | "text_to_image" | "image_to_image"
  | "text_to_video" | "image_to_video" | "video_to_video"
  | "avatar" | "motion_transfer" | "upscale"
  | "text_to_speech" | "speech_to_text"
  | "image_understanding" | "prompt_generation";

export class ModelRegistry {
  static get(key: string): ModelDefinition;
  static has(key: string): boolean;
  static listByCategory(category: ModelCategory): ModelDefinition[];
  static allKeys(): string[];
  static getCostEstimate(key: string, params?: Record<string, unknown>): number;
}
```

**Acceptance Criteria**:
- All 73 models registered with correct endpoints, defaults, and pricing
- `ModelRegistry.listByCategory()` returns correct models per category
- Unit tests validate registry completeness and consistency

**Test File**: `apps/web/src/lib/__tests__/native-registry.test.ts`

---

### Subtask 2: Create Native Pipeline Executor
**Estimated Time**: 60 min
**Description**: Implement the pipeline step executor that replaces AICP's `pipeline/executor.py`. Each step type maps to a TypeScript function that calls the appropriate API.

**Key Files**:
- **Create**: `electron/native-pipeline/executor.ts` — `PipelineExecutor` class
- **Create**: `electron/native-pipeline/step-executors.ts` — Per-category execution functions
- **Reference**: `packages/video-agent-skill/packages/core/ai_content_pipeline/ai_content_pipeline/pipeline/executor.py`
- **Reuse**: `apps/web/src/lib/ai-video/core/fal-request.ts` — FAL API client

**Details**:
```typescript
// electron/native-pipeline/executor.ts
export interface PipelineStep {
  type: ModelCategory;
  model: string;              // Registry key
  params: Record<string, unknown>;
  enabled: boolean;
  retryCount: number;
}

export interface PipelineChain {
  name: string;
  steps: PipelineStep[];
  config: { outputDir?: string; saveIntermediates?: boolean };
}

export interface StepResult {
  success: boolean;
  outputPath?: string;
  outputUrl?: string;
  error?: string;
  duration: number;
  cost?: number;
}

export class PipelineExecutor {
  async executeChain(
    chain: PipelineChain,
    input: string | Buffer,
    onProgress: (progress: PipelineProgress) => void
  ): Promise<PipelineResult>;

  async executeStep(
    step: PipelineStep,
    input: string | Buffer,
    onProgress: (progress: PipelineProgress) => void
  ): Promise<StepResult>;
}
```

**Step Executor Mapping**:
| Step Type | Execution Strategy |
|-----------|-------------------|
| `text_to_image` | FAL API via `fal-request.ts` |
| `text_to_video` | FAL API via `fal-request.ts` + queue polling |
| `image_to_video` | FAL API with image upload via `fal-upload.ts` |
| `avatar` | FAL API with image + audio upload |
| `text_to_speech` | ElevenLabs API (existing handler) |
| `upscale` | FAL API via upscale endpoint |
| `video_to_video` | FAL API with video upload |
| `prompt_generation` | OpenRouter/Gemini API (existing handler) |
| `image_understanding` | Gemini API (existing handler) |

**Acceptance Criteria**:
- Single-step execution works for all 12 categories
- Multi-step chains pass output of step N as input to step N+1
- Data type validation between steps (text→image→video flow)
- Retry logic with configurable count per step

**Test File**: `apps/web/src/lib/__tests__/pipeline-executor.test.ts`

---

### Subtask 3: Create Shared API Caller Module
**Estimated Time**: 45 min
**Description**: Extract and extend the existing FAL.ai client into a unified API caller that works in both renderer and main process. Currently, `fal-request.ts` lives in the renderer; the native pipeline needs it in Electron main.

**Key Files**:
- **Create**: `electron/native-pipeline/api-caller.ts` — Unified API caller for Electron main process
- **Modify**: `apps/web/src/lib/ai-video/core/fal-request.ts` — Extract shared types
- **Reuse**: `electron/api-key-handler.ts` — API key retrieval
- **Reuse**: `electron/elevenlabs-transcribe-handler.ts` — ElevenLabs patterns
- **Reuse**: `electron/gemini-chat-handler.ts` — Gemini API patterns

**Details**:
```typescript
// electron/native-pipeline/api-caller.ts
export interface ApiCallOptions {
  endpoint: string;              // FAL endpoint or full URL
  payload: Record<string, unknown>;
  provider: "fal" | "elevenlabs" | "google" | "openrouter";
  async?: boolean;               // Use queue mode for long operations
  onProgress?: (percent: number, message: string) => void;
  timeoutMs?: number;
  retries?: number;
}

export interface ApiCallResult {
  success: boolean;
  data?: unknown;
  outputUrl?: string;
  error?: string;
  duration: number;
  cost?: number;
}

export async function callModelApi(options: ApiCallOptions): Promise<ApiCallResult>;
export async function pollQueueStatus(requestId: string, endpoint: string): Promise<ApiCallResult>;
export async function downloadOutput(url: string, outputPath: string): Promise<string>;
```

**Provider Routing**:
- FAL endpoints → `https://queue.fal.run/{endpoint}` with `Authorization: Key {FAL_KEY}`
- ElevenLabs → `https://api.elevenlabs.io/v1/...` with `xi-api-key`
- Google/Gemini → `https://generativelanguage.googleapis.com/...`
- OpenRouter → `https://openrouter.ai/api/v1/...` with `Authorization: Bearer`

**Acceptance Criteria**:
- Supports all 4 providers with correct auth headers
- Queue-based polling for async FAL operations with progress callbacks
- File download with streaming for large video outputs
- Timeout and retry handling

**Test File**: `electron/__tests__/api-caller.test.ts`

---

### Subtask 4: Implement NativePipelineManager
**Estimated Time**: 45 min
**Description**: Replace `AIPipelineManager` (process spawning) with `NativePipelineManager` (direct TypeScript execution). Maintains the same public API so the IPC layer needs zero changes.

**Key Files**:
- **Create**: `electron/native-pipeline/manager.ts` — `NativePipelineManager` class
- **Create**: `electron/native-pipeline/index.ts` — Barrel export
- **Modify**: `electron/ai-pipeline-ipc.ts` — Swap `AIPipelineManager` → `NativePipelineManager`
- **Reference**: `electron/ai-pipeline-handler.ts` — Current process-based implementation

**Details**:
```typescript
// electron/native-pipeline/manager.ts
import { ModelRegistry } from "./registry.js";
import { PipelineExecutor } from "./executor.js";
import { callModelApi, downloadOutput } from "./api-caller.js";

export class NativePipelineManager {
  // Same public interface as AIPipelineManager
  async isAvailable(): Promise<boolean>;
  async getStatus(): Promise<PipelineStatus>;
  async execute(options: GenerateOptions, onProgress: (p: PipelineProgress) => void): Promise<PipelineResult>;
  cancel(sessionId: string): boolean;
  cancelAll(): void;
  getActiveCount(): number;

  // New: no environment detection needed
  // Always available if API keys are configured
}
```

**Key Differences from Current**:
| Aspect | Current (`AIPipelineManager`) | Native (`NativePipelineManager`) |
|--------|-------------------------------|----------------------------------|
| Availability | Binary/Python detection | Always available (check API keys) |
| Execution | `spawn()` child process | Direct async function call |
| Progress | Parse stdout `PROGRESS:` lines | Direct callback from API caller |
| Output | Parse stdout JSON + file recovery | Direct return value |
| Cancellation | `proc.kill("SIGTERM")` | `AbortController.abort()` |
| Error handling | Exit code + stderr parsing | Try/catch with typed errors |

**Acceptance Criteria**:
- Same `GenerateOptions` / `PipelineResult` interfaces (no IPC changes)
- `isAvailable()` returns true when at least one API key is configured
- `getStatus()` reports `source: "native"` instead of binary/system/python
- `execute()` routes to correct model via registry + executor
- `cancel()` aborts in-flight HTTP requests via AbortController
- Auto-import to project media folder works (reuse existing `importMediaFile`)

**Test File**: `electron/__tests__/native-pipeline-manager.test.ts`

---

### Subtask 5: YAML Pipeline Config Parser
**Estimated Time**: 30 min
**Description**: Port the YAML pipeline chain parser so users can still define multi-step workflows in YAML config files.

**Key Files**:
- **Create**: `electron/native-pipeline/chain-parser.ts` — YAML → PipelineChain converter
- **Reference**: `packages/video-agent-skill/packages/core/ai_content_pipeline/ai_content_pipeline/pipeline/chain.py`

**Details**:
```yaml
# Example: input/pipelines/text-to-cinematic-video.yaml
name: "Text to Cinematic Video"
steps:
  - type: prompt_generation
    model: openrouter_video_cinematic
    params:
      style: cinematic
  - type: text_to_image
    model: flux_dev
    params:
      aspect_ratio: "16:9"
  - type: image_to_video
    model: kling_3_pro_i2v
    params:
      duration: "10"
  - type: upscale
    model: topaz_upscale
config:
  output_dir: ./output
  save_intermediates: true
```

```typescript
// electron/native-pipeline/chain-parser.ts
import yaml from "js-yaml";  // Already in dependencies
import { ModelRegistry } from "./registry.js";

export function parseChainConfig(yamlContent: string): PipelineChain;
export function validateChain(chain: PipelineChain): { valid: boolean; errors: string[] };
export function getDataTypeForCategory(category: ModelCategory): "text" | "image" | "video" | "audio";
```

**Validation Rules** (ported from Python):
- First step input type must match pipeline input
- Step N output type must be compatible with step N+1 input type
- All model keys must exist in registry
- `prompt_generation` is pass-through (modifies text, doesn't change type)

**Acceptance Criteria**:
- Parses existing AICP YAML pipeline configs without modification
- Validates data type flow between steps
- Reports clear errors for invalid configs
- Works with the `run-pipeline` command in GenerateOptions

**Test File**: `electron/__tests__/chain-parser.test.ts`

---

### Subtask 6: Cost Calculator & Model Listing
**Estimated Time**: 20 min
**Description**: Implement cost estimation and model listing that currently happens via `aicp estimate-cost` and `aicp list-models` commands.

**Key Files**:
- **Create**: `electron/native-pipeline/cost-calculator.ts`
- **Modify**: `electron/native-pipeline/manager.ts` — Wire up list-models and estimate-cost commands
- **Reference**: `apps/web/src/hooks/use-cost-calculation.ts` — Existing frontend cost logic

**Details**:
```typescript
// electron/native-pipeline/cost-calculator.ts
export interface CostEstimate {
  model: string;
  baseCost: number;
  totalCost: number;
  breakdown: { item: string; cost: number }[];
  currency: "USD";
}

export function estimateCost(
  modelKey: string,
  params: Record<string, unknown>
): CostEstimate;

export function listModels(options?: {
  category?: ModelCategory;
  format?: "json" | "table";
}): ModelDefinition[];
```

**Pricing Logic** (from registry):
- `per_image`: flat rate per generation
- `per_second`: `duration × cost_per_second`
- Variable: check `generate_audio`, `voice_control` flags for tier selection
- Pipeline: sum of all step costs

**Acceptance Criteria**:
- Cost estimates match AICP Python output for same inputs
- `list-models` returns same model list as `aicp list-models --json`
- Supports category filtering

**Test File**: `electron/__tests__/cost-calculator.test.ts`

---

### Subtask 7: Migration & Backward Compatibility
**Estimated Time**: 30 min
**Description**: Wire up the native pipeline to the existing IPC layer and ensure zero breaking changes for the frontend.

**Key Files**:
- **Modify**: `electron/ai-pipeline-ipc.ts` — Swap handler instantiation
- **Modify**: `electron/main.ts` — Update imports (if needed)
- **Modify**: `electron/binary-manager.ts` — Remove AICP binary entries (keep FFmpeg)
- **Keep**: `electron/ai-pipeline-handler.ts` — Rename to `ai-pipeline-handler.legacy.ts` (deprecate, don't delete yet)
- **Keep**: `apps/web/src/types/electron.d.ts` — No changes needed

**Migration Strategy**:
```typescript
// electron/ai-pipeline-ipc.ts (modified)
import { NativePipelineManager } from "./native-pipeline/index.js";

// Feature flag for gradual rollout
const USE_NATIVE_PIPELINE = process.env.QCUT_NATIVE_PIPELINE !== "false";

const manager = USE_NATIVE_PIPELINE
  ? new NativePipelineManager()
  : new AIPipelineManager();  // Legacy fallback

// IPC handlers remain identical — same channels, same types
```

**Acceptance Criteria**:
- Frontend code requires zero changes
- IPC channel names unchanged: `ai-pipeline:check`, `ai-pipeline:generate`, etc.
- Feature flag allows rollback to legacy binary mode
- `getStatus()` returns `source: "native"` so UI can show the new mode
- Legacy handler preserved but not imported by default

**Test File**: `electron/__tests__/pipeline-migration.test.ts`

---

### Subtask 8: Integration Tests & Documentation
**Estimated Time**: 30 min
**Description**: End-to-end tests verifying the full flow from IPC call to API response, plus documentation.

**Key Files**:
- **Create**: `electron/__tests__/native-pipeline-e2e.test.ts`
- **Modify**: `docs/task/implement-native-video-agent-skill.md` — Update with results
- **Modify**: `CLAUDE.md` — Add native pipeline notes if needed

**Test Scenarios**:
1. **Status Check**: `ai-pipeline:status` returns `{ available: true, source: "native" }`
2. **List Models**: `ai-pipeline:list-models` returns 73 models with correct categories
3. **Cost Estimate**: `ai-pipeline:estimate-cost` matches expected pricing
4. **Image Generation**: `ai-pipeline:generate` with `generate-image` command (mock FAL API)
5. **Video Creation**: `ai-pipeline:generate` with `create-video` command (mock FAL API)
6. **Pipeline Execution**: `ai-pipeline:generate` with `run-pipeline` + YAML config
7. **Cancellation**: `ai-pipeline:cancel` aborts in-flight request
8. **Auto-Import**: Generated file auto-imported to project media
9. **Error Handling**: Missing API key, network failure, invalid model key
10. **Legacy Fallback**: Feature flag switches to binary mode

**Acceptance Criteria**:
- All 10 test scenarios pass
- No changes needed in frontend components or hooks
- `bun run test` passes with new tests included

---

## File Structure (New Files)

```
electron/native-pipeline/
├── index.ts               # Barrel export
├── registry.ts            # ModelDefinition + ModelRegistry class
├── registry-data.ts       # 73 model definitions (< 800 lines)
├── registry-data-2.ts     # Overflow if needed (< 800 lines each per CLAUDE.md)
├── executor.ts            # PipelineExecutor class
├── step-executors.ts      # Per-category execution functions
├── api-caller.ts          # Unified multi-provider API caller
├── manager.ts             # NativePipelineManager (replaces AIPipelineManager)
├── chain-parser.ts        # YAML pipeline config parser
└── cost-calculator.ts     # Cost estimation logic

electron/__tests__/
├── native-registry.test.ts
├── pipeline-executor.test.ts
├── api-caller.test.ts
├── native-pipeline-manager.test.ts
├── chain-parser.test.ts
├── cost-calculator.test.ts
└── native-pipeline-e2e.test.ts
```

## Dependency Changes

| Package | Action | Reason |
|---------|--------|--------|
| `js-yaml` | Already installed | YAML pipeline parsing |
| `node-fetch` | Already in Node.js 18+ | API calls from main process |
| None new | — | Leverage existing FAL client patterns |

No new dependencies required.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Registry drift from Python AICP | Models get out of sync | Script to diff Python registry_data.py vs TS registry-data.ts |
| API behavior differences | Edge cases in FAL API handling | Port AICP's test cases to TypeScript |
| Large registry-data.ts | May exceed 800-line limit | Split into registry-data.ts + registry-data-2.ts |
| Missing ElevenLabs/Google patterns | TTS/Gemini calls differ from FAL | Reuse existing electron handlers |
| Feature flag complexity | Two code paths to maintain | Remove legacy path after 2 release cycles |

## Success Metrics

1. **Zero frontend changes** — Same IPC interface, same UI behavior
2. **Faster startup** — No binary detection probing (instant availability)
3. **Smaller bundle** — No 100MB+ Python binary in packaged app
4. **Better errors** — TypeScript stack traces instead of process exit codes
5. **Easier updates** — Add new model = add entry to registry-data.ts
6. **All 73 models working** — Parity with AICP Python implementation
