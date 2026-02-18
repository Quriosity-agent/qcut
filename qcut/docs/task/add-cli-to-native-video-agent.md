# Add CLI Support to Native Video Agent Skill

**Created**: 2026-02-18
**Depends on**: `implement-native-video-agent-skill.md` (completed)
**Estimated Time**: ~3-4 hours (6 subtasks)
**Priority**: Long-term maintainability > scalability > performance

---

## Problem Statement

The native TypeScript video agent pipeline (`electron/native-pipeline/`) currently runs **only inside Electron's main process**. Users who want to run AI content pipelines from the terminal — CI/CD, batch jobs, scripting, headless servers — must still fall back to the legacy Python `aicp` binary.

**Current State**:
- `NativePipelineManager` in `electron/native-pipeline/manager.ts` depends on `electron` (`app.getPath`) and `electron/api-key-handler.ts` (`getDecryptedApiKeys`)
- All 70+ models, the executor, chain parser, cost calculator, and API caller are pure Node.js — no Electron dependency except manager's output dir resolution and key retrieval
- The Python CLI (`aicp`) is still bundled but deprecated

**Goal**: A standalone CLI entry point (`qcut-pipeline`) that reuses the existing native pipeline modules without Electron, enabling:
1. `qcut-pipeline generate-image --model flux_dev --text "A cat in space"`
2. `qcut-pipeline create-video --model kling_2_6_pro --text "Ocean waves" --duration 5s`
3. `qcut-pipeline run-pipeline --config pipeline.yaml --input "A sunset"`
4. `qcut-pipeline list-models --category text_to_video`
5. `qcut-pipeline estimate-cost --model veo3 --duration 8s`

---

## Architecture Overview

```text
Current (Electron-only):
  Renderer → IPC → NativePipelineManager → executor → API
                    ↑ uses electron app.getPath, getDecryptedApiKeys

Proposed (CLI + Electron):
  CLI entry (bin/qcut-pipeline.ts)
    → CLIPipelineRunner (new, no Electron deps)
       → ModelRegistry, PipelineExecutor, chainParser, costCalculator, apiCaller
       → reads API keys from env vars / .env file
       → writes output to --output-dir or cwd

  Electron (unchanged)
    → NativePipelineManager → same modules
```

### Key Design Decisions

1. **No Electron dependency in CLI path** — The CLI must run with plain `bun` or `node`, never importing from `electron`.
2. **Shared modules** — Registry, executor, chain-parser, cost-calculator, and step-executors are already Electron-free. The API caller imports `getDecryptedApiKeys` from `api-key-handler.ts` (Electron), which needs a shim.
3. **API keys from environment** — CLI reads keys from env vars (`FAL_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`) or a `.env` file. No Electron encrypted storage.
4. **Argument parsing** — Use `parseArgs` from `node:util` (built-in since Node 18.3 / Bun 1.0). Zero new dependencies.
5. **Progress output** — Inline terminal progress using `\r` overwrite for TTY, JSON lines for piped/CI output.
6. **Exit codes** — `0` success, `1` runtime error, `2` invalid arguments.

---

## Subtasks

### Subtask 1: Extract Electron Dependencies from API Caller

**Estimated Time**: 30 min
**Description**: Make `api-caller.ts` work without Electron by accepting an API key provider function instead of hardcoding `getDecryptedApiKeys`.

**Key Files**:
- **Modify**: `electron/native-pipeline/api-caller.ts` — Accept injectable key provider
- **Keep**: `electron/api-key-handler.ts` — Unchanged (Electron path still uses it)

**Details**:

The current `getApiKey()` function in `api-caller.ts` imports `getDecryptedApiKeys` from `../api-key-handler.js`, which uses Electron's `safeStorage`. This is the **only Electron dependency** in the shared pipeline modules.

Strategy: Introduce a `setApiKeyProvider` function that allows the caller to inject a key resolution strategy.

```typescript
// electron/native-pipeline/api-caller.ts (modified)

type ApiKeyProvider = (provider: "fal" | "elevenlabs" | "google" | "openrouter") => Promise<string>;

let apiKeyProvider: ApiKeyProvider = defaultApiKeyProvider;

export function setApiKeyProvider(provider: ApiKeyProvider): void {
  apiKeyProvider = provider;
}

// Default: try Electron keys first, then env vars
async function defaultApiKeyProvider(
  provider: "fal" | "elevenlabs" | "google" | "openrouter"
): Promise<string> {
  // Try Electron encrypted storage (will fail gracefully outside Electron)
  try {
    const { getDecryptedApiKeys } = await import("../api-key-handler.js");
    const keys = await getDecryptedApiKeys();
    // ... existing key resolution logic
  } catch {
    // Not in Electron — fall through to env vars
  }
  return envApiKeyProvider(provider);
}

// Pure env-var provider for CLI use
export function envApiKeyProvider(
  provider: "fal" | "elevenlabs" | "google" | "openrouter"
): Promise<string> {
  switch (provider) {
    case "fal": return Promise.resolve(process.env.FAL_KEY || process.env.FAL_API_KEY || "");
    case "elevenlabs": return Promise.resolve(process.env.ELEVENLABS_API_KEY || "");
    case "google": return Promise.resolve(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "");
    case "openrouter": return Promise.resolve(process.env.OPENROUTER_API_KEY || "");
  }
}
```

**Why dynamic import?** Using `await import("../api-key-handler.js")` instead of a top-level import means the Electron module is only loaded when actually available. This lets the same `api-caller.ts` file work in both contexts without build-time changes.

**Acceptance Criteria**:
- `api-caller.ts` works when imported from a non-Electron Node.js/Bun process
- Electron path continues to use encrypted key storage (no behavior change)
- `setApiKeyProvider()` allows CLI to inject env-var-only provider
- All existing tests pass unchanged

---

### Subtask 2: Extract Output Directory Resolution

**Estimated Time**: 15 min
**Description**: The `NativePipelineManager.resolveOutputDir()` calls `app.getPath("temp")` from Electron. The CLI needs a non-Electron equivalent.

**Key Files**:
- **Create**: `electron/native-pipeline/output-utils.ts` — Shared output dir utilities
- **Modify**: `electron/native-pipeline/manager.ts` — Use extracted utility

**Details**:

```typescript
// electron/native-pipeline/output-utils.ts
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

export function resolveOutputDir(
  outputDir: string | undefined,
  sessionId: string,
  tempBase?: string
): string {
  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    return outputDir;
  }
  const base = tempBase || os.tmpdir();
  const dir = path.join(base, "qcut", "aicp-output", sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
```

The existing `manager.ts` calls `app.getPath("temp")` which returns `/tmp` on macOS/Linux. The extracted utility uses `os.tmpdir()` as the fallback — same result, no Electron needed.

**Acceptance Criteria**:
- `resolveOutputDir` works without Electron
- `NativePipelineManager` still uses Electron's `app.getPath("temp")` when available
- CLI uses `os.tmpdir()` as the default

---

### Subtask 3: Create CLI Argument Parser

**Estimated Time**: 45 min
**Description**: Build the CLI entry point with command parsing, help text, and argument validation.

**Key Files**:
- **Create**: `electron/native-pipeline/cli.ts` — CLI entry point and argument parser
- **Modify**: `package.json` — Add `bin` entry

**Command Structure**:

```text
qcut-pipeline <command> [options]

Commands:
  generate-image      Generate an image from text
  create-video        Create a video from text or image
  generate-avatar     Generate a talking avatar video
  run-pipeline        Run a multi-step YAML pipeline
  list-models         List available AI models
  estimate-cost       Estimate generation cost

Global Options:
  --output-dir, -o    Output directory (default: ./output)
  --model, -m         Model key (e.g. kling_2_6_pro, flux_dev)
  --json              Output results as JSON (default for piped output)
  --verbose, -v       Verbose progress output
  --quiet, -q         Suppress progress output
  --help, -h          Show help
  --version           Show version

Generation Options:
  --text, -t          Text prompt for generation
  --image-url         Input image URL (for image_to_video, avatar)
  --video-url         Input video URL (for video_to_video, upscale)
  --audio-url         Input audio URL (for avatar, add_audio)
  --duration, -d      Duration (e.g. "5s", "10")
  --aspect-ratio      Aspect ratio (e.g. "16:9", "9:16")
  --resolution        Resolution (e.g. "1080p", "720p")

Pipeline Options:
  --config, -c        Path to YAML pipeline config
  --input, -i         Pipeline input text or file path
  --save-intermediates Save intermediate step outputs
```

**Implementation using `node:util` parseArgs**:

```typescript
// electron/native-pipeline/cli.ts
import { parseArgs } from "node:util";

const COMMANDS = [
  "generate-image", "create-video", "generate-avatar",
  "run-pipeline", "list-models", "estimate-cost"
] as const;

interface CLIOptions {
  command: typeof COMMANDS[number];
  model?: string;
  text?: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  outputDir: string;
  duration?: string;
  aspectRatio?: string;
  resolution?: string;
  config?: string;
  input?: string;
  saveIntermediates: boolean;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  category?: string;
}

function parseCliArgs(argv: string[]): CLIOptions { ... }
function printHelp(): void { ... }
function printVersion(): void { ... }

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> { ... }

// Direct execution
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("qcut-pipeline")) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
```

**Package.json addition**:
```json
{
  "bin": {
    "qcut-pipeline": "dist/electron/native-pipeline/cli.js"
  }
}
```

**Acceptance Criteria**:
- `bun run electron/native-pipeline/cli.ts list-models` works
- `--help` prints usage for all commands
- Unknown commands print error + help
- Missing required args (e.g. `--model` for generation) print specific error
- Exit code `2` for argument errors

---

### Subtask 4: Create CLI Pipeline Runner

**Estimated Time**: 60 min
**Description**: Implement the core CLI runner that bridges parsed arguments to the native pipeline modules.

**Key Files**:
- **Create**: `electron/native-pipeline/cli-runner.ts` — CLI execution logic (no Electron deps)

**Details**:

```typescript
// electron/native-pipeline/cli-runner.ts

import { ModelRegistry } from "./registry.js";
import { PipelineExecutor } from "./executor.js";
import { parseChainConfig, validateChain } from "./chain-parser.js";
import { estimateCost, estimatePipelineCost, listModels } from "./cost-calculator.js";
import { setApiKeyProvider, envApiKeyProvider, downloadOutput } from "./api-caller.js";
import { resolveOutputDir } from "./output-utils.js";
import type { PipelineStep } from "./executor.js";

export interface CLIRunOptions {
  command: string;
  model?: string;
  text?: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  outputDir: string;
  config?: string;
  input?: string;
  params: Record<string, unknown>;
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  saveIntermediates: boolean;
  category?: string;
}

export interface CLIResult {
  success: boolean;
  outputPath?: string;
  outputPaths?: string[];
  error?: string;
  cost?: number;
  duration?: number;
  data?: unknown;
}

export class CLIPipelineRunner {
  private executor = new PipelineExecutor();

  constructor() {
    // CLI always uses env-var API keys
    setApiKeyProvider(envApiKeyProvider);
  }

  async run(options: CLIRunOptions): Promise<CLIResult> {
    switch (options.command) {
      case "list-models": return this.listModels(options);
      case "estimate-cost": return this.estimateCost(options);
      case "generate-image":
      case "create-video":
      case "generate-avatar":
        return this.generate(options);
      case "run-pipeline": return this.runPipeline(options);
      default:
        return { success: false, error: `Unknown command: ${options.command}` };
    }
  }

  private listModels(options: CLIRunOptions): CLIResult { ... }
  private estimateCost(options: CLIRunOptions): CLIResult { ... }
  private async generate(options: CLIRunOptions): Promise<CLIResult> { ... }
  private async runPipeline(options: CLIRunOptions): Promise<CLIResult> { ... }
}
```

**Progress Output Strategy**:

| Context | Behavior |
|---------|----------|
| TTY (interactive terminal) | Inline progress: `\r[35%] Processing with kling_2_6_pro...` |
| Piped / `--json` | JSON lines: `{"stage":"processing","percent":35,"model":"kling_2_6_pro"}` |
| `--quiet` | No progress output, only final result |
| `--verbose` | Full progress + API request details |

```typescript
function createProgressReporter(options: { json: boolean; quiet: boolean; verbose: boolean }) {
  const isTTY = process.stdout.isTTY;

  return (progress: { stage: string; percent: number; message: string; model?: string }) => {
    if (options.quiet) return;

    if (options.json || !isTTY) {
      // JSON lines mode
      console.log(JSON.stringify({ type: "progress", ...progress }));
    } else {
      // Inline TTY mode
      const bar = renderProgressBar(progress.percent, 30);
      process.stdout.write(`\r${bar} ${progress.message}`);
      if (progress.stage === "complete") {
        process.stdout.write("\n");
      }
    }
  };
}

function renderProgressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${"=".repeat(filled)}${" ".repeat(empty)}] ${percent}%`;
}
```

**Acceptance Criteria**:
- `CLIPipelineRunner` has zero Electron imports (verify with grep)
- Single-model generation works end-to-end (with real API key)
- YAML pipeline execution works end-to-end
- Progress renders correctly in TTY and piped modes
- `--json` mode outputs parseable JSON lines + final JSON result
- Failed API calls produce clear error messages with model name and provider

---

### Subtask 5: Wire Up Registry Initialization for CLI

**Estimated Time**: 20 min
**Description**: The barrel export `electron/native-pipeline/index.ts` initializes the registry by calling `registerTextToVideoModels()`, etc. The CLI needs this same initialization but without importing the full barrel (which re-exports `manager.ts` with its Electron deps).

**Key Files**:
- **Create**: `electron/native-pipeline/init.ts` — Registry-only initialization (no Electron deps)
- **Modify**: `electron/native-pipeline/cli.ts` — Import init before running

**Details**:

```typescript
// electron/native-pipeline/init.ts
// Initializes registry without any Electron dependencies.
// CLI imports this; Electron imports index.ts (which does the same + exports manager).

import {
  registerTextToVideoModels,
  registerImageToVideoModels,
  registerImageToImageModels,
} from "./registry-data.js";
import { registerAllPart2Models } from "./registry-data-2.js";

let initialized = false;

export function initRegistry(): void {
  if (initialized) return;
  registerTextToVideoModels();
  registerImageToVideoModels();
  registerImageToImageModels();
  registerAllPart2Models();
  initialized = true;
}
```

```typescript
// electron/native-pipeline/cli.ts (updated)
import { initRegistry } from "./init.js";

export async function main(argv: string[]): Promise<void> {
  initRegistry();
  // ... parse args, run pipeline
}
```

**Acceptance Criteria**:
- `init.ts` has zero Electron imports
- All 70+ models are registered when CLI starts
- Registry initialization is idempotent (safe to call multiple times)
- Existing `index.ts` barrel export unchanged (backward compatible)

---

### Subtask 6: Integration Tests & Documentation

**Estimated Time**: 30 min
**Description**: Tests for CLI argument parsing, runner execution (mocked APIs), and progress output.

**Key Files**:
- **Create**: `electron/__tests__/cli-pipeline.test.ts` — CLI unit/integration tests
- **Modify**: `docs/task/add-cli-to-native-video-agent.md` — Update with results

**Test Scenarios**:

```typescript
describe("CLI Argument Parser", () => {
  test("parses list-models command");
  test("parses generate-image with all flags");
  test("parses run-pipeline with config path");
  test("errors on unknown command");
  test("errors on missing required --model for generate");
  test("--help prints usage and exits");
  test("--json flag sets json output mode");
  test("--output-dir creates directory");
});

describe("CLIPipelineRunner", () => {
  test("list-models returns 70+ models");
  test("list-models --category text_to_video filters correctly");
  test("estimate-cost returns valid CostEstimate");
  test("estimate-cost errors on unknown model");
  test("generate calls executor with correct step");
  test("run-pipeline parses YAML and validates chain");
  test("run-pipeline errors on invalid YAML");
  test("progress reporter outputs JSON lines when not TTY");
  test("progress reporter uses inline overwrite on TTY");
});

describe("CLI E2E (mocked API)", () => {
  test("generate-image produces output file");
  test("create-video produces output file");
  test("run-pipeline executes multi-step chain");
  test("cancellation via SIGINT aborts in-flight request");
  test("missing API key produces actionable error");
});
```

**Acceptance Criteria**:
- All test scenarios pass with `bun run test`
- CLI can be invoked as `bun run electron/native-pipeline/cli.ts`
- `--help` output is accurate and complete
- Error messages include actionable remediation (e.g., "Set FAL_KEY environment variable")

---

## File Structure (New/Modified Files)

```text
electron/native-pipeline/
├── cli.ts              # NEW: CLI entry point + argument parser
├── cli-runner.ts       # NEW: CLI execution logic (Electron-free)
├── init.ts             # NEW: Registry-only initialization
├── output-utils.ts     # NEW: Shared output dir resolution
├── api-caller.ts       # MODIFIED: Injectable API key provider
├── manager.ts          # MODIFIED: Use extracted output-utils
├── index.ts            # UNCHANGED: Barrel export (Electron path)
├── registry.ts         # UNCHANGED
├── registry-data.ts    # UNCHANGED
├── registry-data-2.ts  # UNCHANGED
├── executor.ts         # UNCHANGED
├── step-executors.ts   # UNCHANGED
├── chain-parser.ts     # UNCHANGED
└── cost-calculator.ts  # UNCHANGED

electron/__tests__/
└── cli-pipeline.test.ts  # NEW: CLI tests
```

## Dependency Changes

| Package | Action | Reason |
|---------|--------|--------|
| None | — | Uses `node:util` built-in `parseArgs` |

**Zero new dependencies**.

## Usage Examples

### Basic Commands

```bash
# Set API keys
export FAL_KEY="your-fal-api-key"
export ELEVENLABS_API_KEY="your-key"

# Generate an image
qcut-pipeline generate-image --model flux_dev --text "A cat in space" --output-dir ./output

# Create a video
qcut-pipeline create-video --model kling_2_6_pro \
  --text "Ocean waves crashing on rocks" \
  --duration 5s --aspect-ratio 16:9

# Generate avatar
qcut-pipeline generate-avatar --model omnihuman_v1_5 \
  --image-url https://example.com/face.jpg \
  --audio-url https://example.com/speech.wav

# List all video models
qcut-pipeline list-models --category text_to_video

# Estimate cost
qcut-pipeline estimate-cost --model veo3 --duration 8s

# Run YAML pipeline
qcut-pipeline run-pipeline --config pipelines/cinematic.yaml --input "A sunset over mountains"
```

### Piped/CI Usage

```bash
# JSON output for scripting
qcut-pipeline create-video --model kling_2_6_pro --text "Test" --json | jq '.outputPath'

# Batch processing
for prompt in "Scene 1: intro" "Scene 2: conflict" "Scene 3: resolution"; do
  qcut-pipeline create-video --model kling_2_6_pro --text "$prompt" --output-dir ./batch --json
done

# Pipeline with custom output
qcut-pipeline run-pipeline \
  --config pipeline.yaml \
  --input "A dramatic scene" \
  --output-dir /tmp/renders \
  --save-intermediates \
  --json
```

### .env File Support

```bash
# .env in project root (read automatically)
FAL_KEY=key_xxxxx
GEMINI_API_KEY=AIzayyy
OPENROUTER_API_KEY=sk-or-zzz
ELEVENLABS_API_KEY=el_www
```

The CLI reads `.env` from the current directory using Bun's built-in `.env` loading (no `dotenv` package needed).

## Error Handling Strategy

| Error Type | CLI Behavior | Exit Code |
|-----------|-------------|-----------|
| Unknown command | Print error + help summary | 2 |
| Missing required flag | Print "Missing --model. Run --help for usage." | 2 |
| Unknown model key | Print "Unknown model 'xyz'. Run list-models to see available models." | 2 |
| Missing API key | Print "No FAL_KEY set. Export FAL_KEY=your-key or add to .env" | 1 |
| API error (4xx) | Print "API error 401: Invalid API key for provider fal" | 1 |
| API error (5xx) | Retry per `retries` setting, then print "Server error after 3 attempts" | 1 |
| Network timeout | Print "Request timed out after 600s. Check your connection." | 1 |
| Invalid YAML | Print parse error with line number | 2 |
| Pipeline validation | Print all validation errors | 2 |
| SIGINT (Ctrl+C) | Abort in-flight requests, print "Cancelled", clean up temp files | 130 |

## Signal Handling

```typescript
// In cli.ts main()
const abortController = new AbortController();

process.on("SIGINT", () => {
  if (!options.quiet) console.error("\nCancelling...");
  abortController.abort();
});

process.on("SIGTERM", () => {
  abortController.abort();
});
```

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Electron imports leaking into CLI | CLI crashes on `require('electron')` | CI test: `bun run cli.ts --help` in non-Electron env |
| API caller key provider regression | Electron path loses encrypted key access | Keep existing import as default, only override in CLI |
| Build step needed for `bin` entry | Users can't run from source | Support both `bun run cli.ts` (dev) and compiled `qcut-pipeline` (dist) |
| Different behavior between CLI and Electron | Feature drift | Shared modules (executor, registry, etc.) are identical — only entry point differs |
| `.env` loading differences (Bun vs Node) | Keys not found | Document supported env var names; test with both runtimes |

## Success Metrics

1. **Zero Electron dependency** — CLI runs with plain `bun` or `node`
2. **Same model coverage** — All 70+ models accessible from CLI
3. **Same pipeline support** — YAML pipelines work identically to Electron path
4. **Scriptable output** — `--json` produces machine-parseable results
5. **Graceful errors** — Every failure includes actionable remediation text
6. **Zero new dependencies** — Uses only built-in `node:util.parseArgs`
