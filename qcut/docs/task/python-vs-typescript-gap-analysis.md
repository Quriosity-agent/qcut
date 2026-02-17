# Gap Analysis: Python Video Agent vs Native TypeScript Pipeline

> **Date:** 2026-02-18
> **Python Source:** `packages/video-agent-skill/`
> **TypeScript Source:** `electron/native-pipeline/`

---

## 1. Features in Python Missing from TypeScript

### 1.1 ViMax Agent System (CRITICAL GAP)

The Python codebase has a full agent-based architecture (`vimax/agents/`) with 7 specialized agents. The TypeScript implementation has **none** of these — it uses flat step executors per model category instead.

| Python Agent | Purpose | TS Equivalent |
|-------------|---------|---------------|
| **BaseAgent** | Generic typed agent with retry, validation, result tracking | None — no agent abstraction |
| **Screenwriter** | Idea → structured screenplay (JSON with scenes, shots, prompts) | None |
| **CharacterExtractor** | Script → character list with roles and descriptions | None |
| **CharacterPortraitsGenerator** | Characters → portrait images with consistency registry | None |
| **StoryboardArtist** | Script + portraits → storyboard images with reference consistency | None |
| **CameraImageGenerator** | Storyboard → video clips with camera motions | None |
| **ReferenceImageSelector** | Content-aware reference selection for visual consistency | None |

**Impact:** Without the agent system, the TS pipeline cannot do creative multi-step workflows like idea-to-video, script-to-video, or novel-to-movie. It can only execute single-model API calls or simple sequential chains.

### 1.2 ViMax Pipelines (CRITICAL GAP)

Three high-level creative pipelines are completely absent from TypeScript:

| Python Pipeline | What It Does | Complexity |
|----------------|-------------|------------|
| **Idea2VideoPipeline** | Idea → Script → Characters → Portraits → Storyboard → Videos → Final | 6 stages, full orchestration |
| **Script2VideoPipeline** | Script JSON → Storyboard → Videos → Final (reuses existing scripts) | 4 stages |
| **Novel2MoviePipeline** | Novel text → Chapters → Per-chapter videos → Compiled movie | 6+ stages, chapter-aware |

**What they provide:**
- End-to-end creative video production from text ideas
- Character visual consistency across shots via portrait registry
- Camera motion synthesis (pan, zoom, dolly)
- Intermediate output saving at each stage
- Cost tracking and estimation per pipeline
- Configurable per-agent settings

### 1.3 Parallel Executor (MODERATE GAP)

Python has two parallel execution systems:

| Component | Python | TypeScript |
|-----------|--------|------------|
| **ParallelPipelineExecutor** | ThreadPoolExecutor, dependency analysis, speedup tracking | None — sequential only |
| **ParallelExtension** | YAML `parallel_group` steps, merge strategies (`COLLECT_ALL`, `FIRST_SUCCESS`, `BEST_QUALITY`), thread-safe | None |
| **Parallel config** | `--parallel` flag, `PIPELINE_PARALLEL_ENABLED` env var, `max_workers` | None |
| **Performance tracking** | sequential_time, parallel_time, speedup_factor, threads_used | None |

**TS has:** Multiple AbortControllers per session for concurrent cancellation, but no actual parallel step execution within a pipeline.

### 1.4 ViMax Adapters (MODERATE GAP)

Python has adapter layers that bridge agents to external services:

| Adapter | Purpose | TS Equivalent |
|---------|---------|---------------|
| **LLMAdapter** | Unified interface for LLM calls (Kimi K2.5, OpenRouter, etc.) | None — direct API calls only |
| **ImageAdapter** | Image generation with quality control and validation | None |
| **VideoAdapter** | Video generation with format normalization | None |

### 1.5 ViMax Interfaces & Schemas (MINOR GAP)

Python has rich data models for creative pipelines:

| Interface | Python | TypeScript |
|-----------|--------|------------|
| **Script** | Full screenplay model (title, logline, scenes, shots) | None |
| **Scene** | Scene with shots, descriptions, duration | None |
| **Shot** | Camera angle, motion, image/video prompts | None |
| **CharacterInNovel** | Character model with name, role, description | None |
| **CharacterPortrait** | Portrait image with metadata | None |
| **CharacterPortraitRegistry** | Lookup by character name for consistency | None |
| **StoryboardResult** | Images list with cost tracking | None |
| **CameraMotion** | Pan, zoom, dolly, track definitions | None |
| **ReferenceSelectionResult** | Selected references with similarity scores | None |

### 1.6 Advanced CLI Features (MINOR GAP)

| Feature | Python | TypeScript |
|---------|--------|------------|
| **Rich console output** | Tables, colors, spinners via Rich library | Basic console.log with prefix |
| **Interactive mode** | Prompt-based interactive CLI | None |
| **JSONL streaming** | `--stream` flag for real-time event output | None |
| **XDG directory support** | `--config-dir`, `--cache-dir`, `--state-dir` | OS temp dir only |
| **`--debug` flag** | Debug-level logging toggle | `--verbose` exists but limited |
| **Exit codes** | Structured exit codes (10+ distinct codes) | Process.exit(1) only |
| **Pipeline examples** | `create-examples` command generates sample YAMLs | None |

### 1.7 Service-Level Features (MINOR GAP)

| Feature | Python | TypeScript |
|---------|--------|------------|
| **Google Cloud auth** | gcloud + Vertex AI integration | Direct API key only |
| **Voice cloning** | ElevenLabs voice cloning support | Standard voices only |
| **Prompt optimizer** | MiniMax Hailuo prompt optimization | Prompt passed through |
| **Negative prompts** | Kling 2.1 negative prompt support | Not implemented |
| **Frame interpolation** | Kling 2.1 frame interpolation | Not implemented |

---

## 2. CLI Commands: Python vs TypeScript

### Commands Present in Both

| Command | Python | TypeScript | Parity |
|---------|--------|------------|--------|
| `generate-image` | Full (model, aspect, resolution, seed) | Supported | ~90% |
| `create-video` | Full (text/image → video) | Supported | ~90% |
| `generate-avatar` | Full (image + audio/text → video) | Supported | ~85% |
| `run-chain` / `run-pipeline` | YAML execution with parallel | YAML execution, sequential only | ~70% |
| `list-models` | By category with pricing table | By category, basic output | ~80% |
| `estimate-cost` | Per-model and per-pipeline | Per-model and per-pipeline | ~90% |

### Commands in Python Only (Missing from TypeScript)

| Command | Purpose | Effort to Add |
|---------|---------|---------------|
| `setup` | Create .env file with API key templates | Low |
| `analyze-video` | AI video analysis via Gemini 3 Pro | Medium |
| `transcribe` | Audio transcription with speaker diarization | Medium |
| `transfer-motion` | Motion transfer from video to image (Kling v2.6) | Medium |
| `generate-grid` | Create 2x2/3x3 image grids from markdown | Low |
| `upscale-image` | Image upscaling via SeedVR2 (1-8x) | Low |
| `set-key` / `get-key` / `check-keys` | Secure API key management CLI | Low |
| `create-examples` | Generate sample YAML pipeline configs | Low |
| `list-avatar-models` | Show avatar-specific models | Low (subset of list-models) |
| `list-video-models` | Show video-specific models | Low (subset of list-models) |
| `list-motion-models` | Show motion-specific models | Low (subset of list-models) |
| `list-speech-models` | Show speech-specific models | Low (subset of list-models) |
| `vimax idea2video` | Full idea → video pipeline | Critical (requires agents) |
| `vimax script2video` | Script → video pipeline | Critical (requires agents) |
| `vimax novel2movie` | Novel → movie pipeline | Critical (requires agents) |

---

## 3. Providers & Models: Coverage Comparison

### Provider Coverage

| Provider | Python Models | TS Models | Gap |
|----------|:---:|:---:|-----|
| **FAL.ai** | 34 | 34 | Full parity |
| **Kuaishou (Kling)** | 16 | 16 | Full parity |
| **Google (Veo/Gemini)** | 8 | 8 | Full parity |
| **MiniMax (Hailuo)** | 1 | 1 | Full parity |
| **ElevenLabs** | 4 | 4 | Full parity |
| **OpenAI/OpenRouter** | 3 | 3 | Full parity |
| **xAI (Grok)** | 1 | 1 | Full parity |
| **VEED** | 0 | 3 | TS has more |
| **ByteDance** | 0 | 1 | TS has more |
| **Topaz** | 1 | 1 | Full parity |
| **Runway** | 2 | 0 | Missing in TS |
| **Synthesia** | 1 | 0 | Missing in TS |
| **HeyGen** | 1 | 0 | Missing in TS |
| **D-ID** | 1 | 0 | Missing in TS |

**Total:** Python 73 models, TypeScript 73 models — count matches but composition differs slightly.

### Model Categories

| Category | Python | TypeScript | Notes |
|----------|:---:|:---:|-------|
| Text-to-Image | 8 | 8+ | Parity (TS has recraft_v3) |
| Text-to-Video | 10 | 10+ | Parity |
| Image-to-Video | 15 | 10+ | Python has more Runway/community models |
| Avatar | 10 | 6+ | Python has Synthesia, HeyGen, D-ID |
| Video-to-Video | 4 | 3+ | Close parity |
| Image-to-Image | 8 | 5+ | Python has more utility models |
| Speech-to-Text | 1 | 2+ | TS added deepgram |
| Text-to-Speech | 1 | 3+ | TS added google_tts |
| Image Understanding | 1 | 2+ | TS added claude_vision |
| Prompt Generation | 1 | 2+ | TS added claude_prompt |
| Upscale Video | 0 | 1 | TS has topaz category |
| Add Audio | 0 | 1 | TS has thinksound |

**Summary:** Model registry has rough parity. TS is missing some community/enterprise avatar models (HeyGen, D-ID, Synthesia) and some Runway models, but adds newer models like deepgram, claude_vision, and thinksound.

---

## 4. Migration Priority Order

### Priority 1: ViMax Agent Framework (CRITICAL)

**Why:** The entire creative pipeline system depends on this. Without agents, the TS pipeline is just a model-calling wrapper, not a content creation engine.

**Items:**
1. **BaseAgent abstraction** — Generic typed agent class with retry, validation, result tracking
2. **LLM Adapter** — Unified interface for LLM calls (Kimi K2.5, Claude, OpenRouter)
3. **Screenwriter agent** — Idea → structured screenplay JSON
4. **CharacterExtractor agent** — Script → character list
5. **CharacterPortraitsGenerator agent** — Characters → portrait images + registry
6. **StoryboardArtist agent** — Script + references → storyboard images
7. **CameraImageGenerator agent** — Storyboard → video clips with camera motion
8. **ReferenceImageSelector** — Content-aware reference image selection

### Priority 2: ViMax Pipelines (CRITICAL)

**Why:** These are the user-facing creative features that make the video agent valuable.

**Items:**
1. **Idea2VideoPipeline** — Full end-to-end pipeline orchestrator
2. **Script2VideoPipeline** — Faster pipeline from existing scripts
3. **Novel2MoviePipeline** — Long-form content pipeline

### Priority 3: Parallel Execution (HIGH)

**Why:** Multi-step pipelines (especially ViMax) are slow without parallelism. 2-3x speedup.

**Items:**
1. **Parallel step executor** — Run independent steps concurrently
2. **Dependency analysis** — Identify parallelizable steps
3. **YAML parallel_group** — Support `type: parallel_group` in pipeline configs
4. **Merge strategies** — COLLECT_ALL, FIRST_SUCCESS, BEST_QUALITY
5. **Performance tracking** — Speedup metrics

### Priority 4: Missing CLI Commands (MEDIUM)

**Why:** Quality-of-life features for CLI users. Not blocking core functionality.

**Items:**
1. `analyze-video` — Video analysis via Gemini
2. `transcribe` — Audio transcription with diarization
3. `transfer-motion` — Motion transfer
4. `generate-grid` — Image grid creation
5. `upscale-image` — Image upscaling
6. `setup` / key management — API key setup wizard
7. `create-examples` — Sample pipeline generation

### Priority 5: Missing Models & Providers (LOW)

**Why:** Current model coverage is sufficient for most workflows.

**Items:**
1. Runway Gen-2 / Runway V2V
2. HeyGen Avatar 2.1
3. D-ID Studio
4. Synthesia Avatar
5. Community models (Deforum, Morph Studio, etc.)

### Priority 6: Polish & Parity (LOW)

**Why:** Nice-to-have improvements, not functional gaps.

**Items:**
1. Rich console output (tables, colors, spinners)
2. JSONL streaming output
3. XDG directory support
4. Structured exit codes
5. Interactive CLI mode
6. Voice cloning support
7. Negative prompts / frame interpolation

---

## 5. Effort Estimates

| Item | Scope | Files | Est. Effort | Dependencies |
|------|-------|:-----:|:-----------:|-------------|
| **P1: BaseAgent abstraction** | New agent framework | 2-3 | 1-2 days | None |
| **P1: LLM Adapter** | Unified LLM interface | 1-2 | 1 day | BaseAgent |
| **P1: Screenwriter agent** | Idea → screenplay | 2-3 | 2-3 days | BaseAgent, LLM Adapter |
| **P1: CharacterExtractor** | Script → characters | 1-2 | 1 day | BaseAgent, LLM Adapter |
| **P1: CharacterPortraitsGenerator** | Characters → portraits | 2-3 | 2-3 days | BaseAgent, Image executor |
| **P1: StoryboardArtist** | Script → storyboard | 2-3 | 2-3 days | BaseAgent, Image executor, ReferenceSelector |
| **P1: CameraImageGenerator** | Storyboard → video clips | 2-3 | 2-3 days | BaseAgent, Video executor |
| **P1: ReferenceImageSelector** | Content-aware ref selection | 1-2 | 1-2 days | BaseAgent |
| **P1 Subtotal** | Agent framework | ~15 | **10-17 days** | — |
| | | | | |
| **P2: Idea2VideoPipeline** | Full pipeline orchestrator | 2-3 | 3-4 days | All P1 agents |
| **P2: Script2VideoPipeline** | Script → video | 1-2 | 1-2 days | StoryboardArtist, CameraGen |
| **P2: Novel2MoviePipeline** | Novel → movie | 2-3 | 3-4 days | All P1 agents + chapter logic |
| **P2 Subtotal** | Creative pipelines | ~7 | **7-10 days** | P1 complete |
| | | | | |
| **P3: Parallel executor** | Concurrent step execution | 2-3 | 2-3 days | None |
| **P3: YAML parallel_group** | Config + merge strategies | 1-2 | 1-2 days | Parallel executor |
| **P3: Performance tracking** | Metrics and reporting | 1 | 0.5 day | Parallel executor |
| **P3 Subtotal** | Parallel execution | ~5 | **3-5 days** | None |
| | | | | |
| **P4: analyze-video** | Gemini video analysis CLI | 1-2 | 1 day | None |
| **P4: transcribe** | Audio transcription CLI | 1-2 | 1 day | None |
| **P4: transfer-motion** | Motion transfer CLI | 1-2 | 1 day | None |
| **P4: generate-grid** | Image grid creation | 1 | 0.5 day | None |
| **P4: upscale-image** | Image upscaling CLI | 1 | 0.5 day | None |
| **P4: Key management CLI** | setup, set-key, get-key, check-keys | 1-2 | 1 day | None |
| **P4: create-examples** | Sample YAML generation | 1 | 0.5 day | None |
| **P4 Subtotal** | Missing CLI commands | ~8 | **5-6 days** | None |
| | | | | |
| **P5: Missing models** | Runway, HeyGen, D-ID, Synthesia | 1-2 | 1-2 days | None |
| **P6: Polish items** | Rich output, streaming, XDG, etc. | 3-5 | 3-5 days | None |
| | | | | |
| **GRAND TOTAL** | Full parity | ~40 files | **29-45 days** | — |

---

## 6. Summary

### What TypeScript Does Well
- **Model registry parity** — 73 models registered with full metadata
- **Clean architecture** — Modular, no Electron deps in core, <800 lines per file
- **IPC integration** — Seamless Electron bridge with feature flag toggle
- **API calling** — Unified provider caller with retry, polling, download
- **CLI basics** — 6 core commands working end-to-end
- **Cost estimation** — Per-model and per-pipeline cost calculations
- **Cancellation** — AbortSignal-based cancellation per session
- **Tests** — 38+ E2E test scenarios

### What TypeScript Is Missing
- **Creative pipeline system** — The ViMax agents + pipelines are the core value proposition and are entirely absent
- **Parallel execution** — Only sequential pipeline execution
- **7 CLI commands** — Video analysis, transcription, motion transfer, image utilities, key management
- **4 enterprise avatar providers** — Runway, HeyGen, D-ID, Synthesia
- **Rich CLI UX** — Tables, streaming, interactive mode, structured exit codes

### Recommended Next Step
Start with **P1: BaseAgent abstraction + LLM Adapter** — this unblocks all creative pipeline work and is the highest-impact gap to close.
