# Gap Implementation Plan: Python → TypeScript Parity

> **Date:** 2026-02-18
> **Source:** [Gap Analysis](python-vs-typescript-gap-analysis.md)
> **Python Source of Truth:** `packages/video-agent-skill/`
> **Target:** `electron/native-pipeline/`

---

## Overview

This plan closes **all gaps** identified in the gap analysis across 6 priority levels, organized into **42 subtasks**. Each subtask specifies exact files, code structure, dependencies, and priority.

**Total estimated effort:** 29-45 days
**Total new/modified files:** ~40

---

## Phase 1: ViMax Agent Framework (CRITICAL)

### 1.1 Interfaces & Type Definitions

> Port all ViMax data models from Python Pydantic to TypeScript interfaces.

**Priority:** P1 (blocks all agent work)

#### Subtask 1.1.1: Shot & Scene Types

- **Create:** `electron/native-pipeline/vimax/types/shot.ts`
- **Python source:** `vimax/interfaces/shot.py` (112 lines)
- **Structure:**
  ```ts
  - enum ShotType { WIDE, MEDIUM, CLOSE_UP, EXTREME_CLOSE_UP, ESTABLISHING, OVER_THE_SHOULDER, POV, TWO_SHOT, INSERT }
  - enum CameraMovement { STATIC, PAN, TILT, ZOOM, DOLLY, TRACKING, CRANE, HANDHELD }
  - interface ShotDescription { shot_id, shot_type, description, camera_movement, camera_angle, location, time_of_day, lighting, characters, duration_seconds, image_prompt?, video_prompt?, character_references, primary_reference_image? }
  - interface ShotBriefDescription { shot_id, shot_type, brief }
  - interface Scene { scene_id, title, description, location, time, shots: ShotDescription[] }
  - interface Storyboard { title, description, scenes: Scene[] }
  ```
- **Dependencies:** None
- **Est. time:** 0.5 day

#### Subtask 1.1.2: Character Types

- **Create:** `electron/native-pipeline/vimax/types/character.ts`
- **Python source:** `vimax/interfaces/character.py` (187 lines)
- **Structure:**
  ```ts
  - interface CharacterBase { name, description }
  - interface CharacterInNovel extends CharacterBase { age?, gender?, appearance, personality, role, relationships }
  - interface CharacterInScene extends CharacterBase { scene_id?, position?, action, emotion, dialogue? }
  - interface CharacterPortrait { character_name, description, front_view?, side_view?, back_view?, three_quarter_view? }
    - getViews(): Record<string, string>
    - hasViews: boolean
  - class CharacterPortraitRegistry { project_id, portraits: Map<string, CharacterPortrait> }
    - addPortrait(), getPortrait(), getBestView(), listCharacters(), hasCharacter()
    - toJSON() / fromJSON() for serialization
  ```
- **Dependencies:** None
- **Est. time:** 0.5 day

#### Subtask 1.1.3: Camera Types

- **Create:** `electron/native-pipeline/vimax/types/camera.ts`
- **Python source:** `vimax/interfaces/camera.py` (67 lines)
- **Structure:**
  ```ts
  - enum CameraType { MAIN, SECONDARY, DETAIL, ACTION, DIALOGUE }
  - interface CameraPosition { x, y, z }
  - interface CameraConfig { camera_id, camera_type, position, look_at?, focal_length, aperture, movement_type, movement_speed, settings }
  - interface CameraHierarchy { scene_id, primary_camera, secondary_cameras }
  ```
- **Dependencies:** None
- **Est. time:** 0.25 day

#### Subtask 1.1.4: Output Types

- **Create:** `electron/native-pipeline/vimax/types/output.ts`
- **Python source:** `vimax/interfaces/output.py` (82 lines)
- **Structure:**
  ```ts
  - interface ImageOutput { image_path, prompt, model, width, height, generation_time, cost, metadata }
  - interface VideoOutput { video_path, source_image?, prompt, model, duration, width, height, fps, generation_time, cost, metadata }
  - interface PipelineOutput { pipeline_name, started_at, completed_at?, images, videos, final_video?, total_cost, output_directory, config_path?, errors }
  ```
- **Dependencies:** None
- **Est. time:** 0.25 day

#### Subtask 1.1.5: Type Barrel Export

- **Create:** `electron/native-pipeline/vimax/types/index.ts`
- Re-export all types from subtasks 1.1.1-1.1.4
- **Dependencies:** 1.1.1-1.1.4
- **Est. time:** 0.1 day

---

### 1.2 Adapter Layer

> Port the adapter abstraction that bridges agents to external services.

**Priority:** P1 (blocks all agents)

#### Subtask 1.2.1: Base Adapter

- **Create:** `electron/native-pipeline/vimax/adapters/base-adapter.ts`
- **Python source:** `vimax/adapters/base.py` (59 lines)
- **Structure:**
  ```ts
  - interface AdapterConfig { provider, model, timeout, max_retries, extra }
  - abstract class BaseAdapter<T, R> {
      config: AdapterConfig
      _initialized: boolean
      abstract initialize(): Promise<boolean>
      abstract execute(input: T): Promise<R>
      ensureInitialized(): Promise<void>
    }
  ```
- **Dependencies:** None
- **Est. time:** 0.25 day

#### Subtask 1.2.2: LLM Adapter

- **Create:** `electron/native-pipeline/vimax/adapters/llm-adapter.ts`
- **Python source:** `vimax/adapters/llm_adapter.py` (536 lines)
- **Structure:**
  ```ts
  - interface LLMAdapterConfig extends AdapterConfig { model, temperature, max_tokens, timeout, use_native_structured_output }
  - interface Message { role: "system" | "user" | "assistant", content: string }
  - interface LLMResponse { content, model, usage, cost }
  - class LLMAdapter extends BaseAdapter<Message[], LLMResponse> {
      MODEL_ALIASES: Record<string, string>
      initialize(): Promise<boolean>
      execute(messages): Promise<LLMResponse>
      chat(messages, options?): Promise<LLMResponse>
      chatWithStructuredOutput<T>(messages, schema, options?): Promise<T>
    }
  ```
- **Integration:** Uses existing `callModelApi()` from `api-caller.ts` for OpenRouter calls, or direct `fetch` to OpenRouter API
- **Key detail:** `chatWithStructuredOutput` sends `response_format: { type: "json_schema", json_schema: { schema } }` to OpenRouter for guaranteed JSON
- **Dependencies:** 1.2.1, existing `api-caller.ts`
- **Est. time:** 1 day

#### Subtask 1.2.3: Image Adapter

- **Create:** `electron/native-pipeline/vimax/adapters/image-adapter.ts`
- **Python source:** `vimax/adapters/image_adapter.py` (593 lines)
- **Structure:**
  ```ts
  - interface ImageAdapterConfig extends AdapterConfig { model, output_dir, reference_model?, reference_strength? }
  - class ImageGeneratorAdapter extends BaseAdapter {
      generate(prompt, options): Promise<ImageOutput>
      generateWithReference(prompt, referenceImage, options): Promise<ImageOutput>
    }
  ```
- **Integration:** Uses existing `callModelApi()` + `downloadOutput()` from `api-caller.ts` and step executors
- **Dependencies:** 1.2.1, 1.1.4, existing `api-caller.ts`
- **Est. time:** 1 day

#### Subtask 1.2.4: Video Adapter

- **Create:** `electron/native-pipeline/vimax/adapters/video-adapter.ts`
- **Python source:** `vimax/adapters/video_adapter.py` (397 lines)
- **Structure:**
  ```ts
  - interface VideoAdapterConfig extends AdapterConfig { model, output_dir }
  - class VideoGeneratorAdapter extends BaseAdapter {
      generate(imagePath, prompt, duration, options): Promise<VideoOutput>
      concatenateVideos(videos, outputPath): Promise<VideoOutput>
    }
  ```
- **Integration:** Uses existing `callModelApi()` for video generation; concatenation via FFmpeg (existing FFmpeg infrastructure in QCut)
- **Dependencies:** 1.2.1, 1.1.4, existing `api-caller.ts`
- **Est. time:** 1 day

#### Subtask 1.2.5: Adapter Barrel Export

- **Create:** `electron/native-pipeline/vimax/adapters/index.ts`
- Re-export all adapters
- **Dependencies:** 1.2.1-1.2.4
- **Est. time:** 0.1 day

---

### 1.3 Agent Framework

> Port the agent abstraction and all 7 specialized agents.

**Priority:** P1 (core creative engine)

#### Subtask 1.3.1: Base Agent + JSON Parser

- **Create:** `electron/native-pipeline/vimax/agents/base-agent.ts`
- **Python source:** `vimax/agents/base.py` (172 lines)
- **Structure:**
  ```ts
  - interface AgentConfig { name, model, temperature, max_retries, timeout, extra }
  - interface AgentResult<T> { success, result?, error?, metadata }
    - static ok<T>(result, metadata?): AgentResult<T>
    - static fail<T>(error, metadata?): AgentResult<T>
  - abstract class BaseAgent<T, R> {
      config: AgentConfig
      abstract process(input: T): Promise<AgentResult<R>>
      validateInput(input: T): boolean
    }
  - function parseLlmJson(text: string, expect?: "object" | "array"): unknown
    // Handles: markdown fences, trailing commas, nested extraction, newline escaping
  ```
- **Dependencies:** None
- **Est. time:** 0.5 day

#### Subtask 1.3.2: Response Schemas (Zod)

- **Create:** `electron/native-pipeline/vimax/agents/schemas.ts`
- **Python source:** `vimax/agents/schemas.py` (116 lines)
- **Structure:** Use Zod for runtime validation (already in project deps, or use plain TS interfaces + JSON schema for OpenRouter `response_format`)
  ```ts
  - ShotResponseSchema { shot_id, shot_type, description, camera_movement, characters, duration_seconds, image_prompt, video_prompt }
  - SceneResponseSchema { scene_id, title, location, time, shots }
  - ScreenplayResponseSchema { title, logline, scenes }
  - CharacterResponseSchema { name, description, age, gender, appearance, personality, role, relationships }
  - CharacterListResponseSchema { characters }
  - SceneCompressionSchema { title, description, characters, setting }
  - ChapterCompressionResponseSchema { title, scenes }
  ```
- **Dependencies:** None
- **Est. time:** 0.5 day

#### Subtask 1.3.3: Screenwriter Agent

- **Create:** `electron/native-pipeline/vimax/agents/screenwriter.ts`
- **Python source:** `vimax/agents/screenwriter.py` (291 lines)
- **Structure:**
  ```ts
  - interface Script { title, logline, scenes: Scene[], total_duration }
  - interface ScreenwriterConfig extends AgentConfig { target_duration, shots_per_scene, style }
  - SCREENPLAY_PROMPT template string
  - class Screenwriter extends BaseAgent<string, Script> {
      _llm: LLMAdapter (lazy init)
      process(idea: string): Promise<AgentResult<Script>>
      // Calls LLM with structured output, parses ScreenplayResponse,
      // maps to Scene/ShotDescription with enum normalization
    }
  ```
- **Key logic:** Camera movement mapping (push_in→dolly, track→tracking, etc.), ShotType enum normalization
- **Dependencies:** 1.3.1, 1.3.2, 1.2.2, 1.1.1
- **Est. time:** 1 day

#### Subtask 1.3.4: Character Extractor Agent

- **Create:** `electron/native-pipeline/vimax/agents/character-extractor.ts`
- **Python source:** `vimax/agents/character_extractor.py` (154 lines)
- **Structure:**
  ```ts
  - interface CharacterExtractorConfig extends AgentConfig { max_characters }
  - EXTRACTION_PROMPT template string
  - class CharacterExtractor extends BaseAgent<string, CharacterInNovel[]> {
      process(text): Promise<AgentResult<CharacterInNovel[]>>
      extractMainCharacters(text, maxCharacters?): Promise<CharacterInNovel[]>
    }
  ```
- **Dependencies:** 1.3.1, 1.3.2, 1.2.2, 1.1.2
- **Est. time:** 0.5 day

#### Subtask 1.3.5: Character Portraits Generator Agent

- **Create:** `electron/native-pipeline/vimax/agents/character-portraits.ts`
- **Python source:** `vimax/agents/character_portraits.py` (214 lines)
- **Structure:**
  ```ts
  - interface PortraitsGeneratorConfig extends AgentConfig { image_model, llm_model, views, style, output_dir }
  - PORTRAIT_PROMPT_TEMPLATE template string
  - class CharacterPortraitsGenerator extends BaseAgent<CharacterInNovel, CharacterPortrait> {
      process(character): Promise<AgentResult<CharacterPortrait>>
      generateBatch(characters): Promise<AgentResult<Record<string, CharacterPortrait>>>
      _generatePrompt(character, view): Promise<string>
    }
  ```
- **Key logic:** Generates optimized prompts per view via LLM, then generates images via ImageAdapter; 4 views per character (front, side, back, three_quarter)
- **Dependencies:** 1.3.1, 1.2.2, 1.2.3, 1.1.2
- **Est. time:** 1 day

#### Subtask 1.3.6: Storyboard Artist Agent

- **Create:** `electron/native-pipeline/vimax/agents/storyboard-artist.ts`
- **Python source:** `vimax/agents/storyboard_artist.py` (446 lines)
- **Structure:**
  ```ts
  - interface StoryboardResult extends Storyboard { images: ImageOutput[], total_cost }
  - interface StoryboardArtistConfig extends AgentConfig { image_model, style_prefix, aspect_ratio, output_dir, use_character_references, reference_model, reference_strength }
  - class StoryboardArtist extends BaseAgent<Script, StoryboardResult> {
      process(script, portraitRegistry?, chapterIndex?): Promise<AgentResult<StoryboardResult>>
      processWithReferences(script, portraitRegistry): Promise<AgentResult<StoryboardResult>>
      resolveReferences(script, registry): Promise<number>
      generateFromShots(shots, title?, portraitRegistry?): Promise<ImageOutput[]>
      _buildPrompt(shot, scene, registry?): string
    }
  ```
- **Key logic:** Reference resolution via ReferenceImageSelector, prompt building with character descriptions + reference instructions, safe path validation for reference images
- **Dependencies:** 1.3.1, 1.3.7, 1.2.3, 1.1.1, 1.1.2, 1.1.4
- **Est. time:** 1.5 days

#### Subtask 1.3.7: Reference Image Selector Agent

- **Create:** `electron/native-pipeline/vimax/agents/reference-selector.ts`
- **Python source:** `vimax/agents/reference_selector.py` (320 lines)
- **Structure:**
  ```ts
  - interface ReferenceSelectorConfig extends AgentConfig { use_llm_for_selection, llm_model }
  - interface ReferenceSelectionResult { shot_id, selected_references: Record<string, string>, primary_reference?, selection_reason }
  - class ReferenceImageSelector extends BaseAgent<ShotDescription, ReferenceSelectionResult> {
      ANGLE_TO_VIEW: Record<string, string>  // front, eye_level→front; side, profile→side; etc.
      SHOT_TYPE_PREFERENCE: Record<string, string[]>  // close_up→[front, three_quarter]; etc.
      selectForShot(shot, registry): Promise<ReferenceSelectionResult>
      selectForShots(shots, registry): Promise<ReferenceSelectionResult[]>
      _findPortrait(charName, registry): [CharacterPortrait | null, string]  // Fuzzy matching: exact→case-insensitive→substring→word overlap
      _selectBestView(portrait, cameraAngle, shotType): string | null
    }
  ```
- **Dependencies:** 1.3.1, 1.1.1, 1.1.2
- **Est. time:** 0.75 day

#### Subtask 1.3.8: Camera Image Generator Agent

- **Create:** `electron/native-pipeline/vimax/agents/camera-generator.ts`
- **Python source:** `vimax/agents/camera_generator.py` (211 lines)
- **Structure:**
  ```ts
  - interface CameraGeneratorConfig extends AgentConfig { video_model, default_duration, output_dir }
  - class CameraImageGenerator extends BaseAgent<StoryboardResult, PipelineOutput> {
      process(storyboard): Promise<AgentResult<PipelineOutput>>
      generateFromImages(images, prompts, durations?): Promise<VideoOutput[]>
      _getMotionPrompt(shot): string  // Maps camera movements to motion hints
    }
  ```
- **Key logic:** Matches storyboard images with shots, generates motion prompts from camera movement enums, concatenates final video via VideoAdapter
- **Dependencies:** 1.3.1, 1.3.6 (StoryboardResult), 1.2.4, 1.1.4
- **Est. time:** 0.75 day

#### Subtask 1.3.9: Agent Barrel Export

- **Create:** `electron/native-pipeline/vimax/agents/index.ts`
- Re-export all agents, configs, and result types
- **Dependencies:** 1.3.1-1.3.8
- **Est. time:** 0.1 day

---

### Phase 1 Summary

| Subtask | File | Lines (est.) | Deps | Time |
|---------|------|:---:|------|:---:|
| 1.1.1 Shot types | `vimax/types/shot.ts` | ~120 | - | 0.5d |
| 1.1.2 Character types | `vimax/types/character.ts` | ~200 | - | 0.5d |
| 1.1.3 Camera types | `vimax/types/camera.ts` | ~70 | - | 0.25d |
| 1.1.4 Output types | `vimax/types/output.ts` | ~90 | - | 0.25d |
| 1.1.5 Types index | `vimax/types/index.ts` | ~10 | 1.1.* | 0.1d |
| 1.2.1 Base adapter | `vimax/adapters/base-adapter.ts` | ~60 | - | 0.25d |
| 1.2.2 LLM adapter | `vimax/adapters/llm-adapter.ts` | ~300 | 1.2.1 | 1d |
| 1.2.3 Image adapter | `vimax/adapters/image-adapter.ts` | ~250 | 1.2.1 | 1d |
| 1.2.4 Video adapter | `vimax/adapters/video-adapter.ts` | ~200 | 1.2.1 | 1d |
| 1.2.5 Adapters index | `vimax/adapters/index.ts` | ~10 | 1.2.* | 0.1d |
| 1.3.1 Base agent | `vimax/agents/base-agent.ts` | ~150 | - | 0.5d |
| 1.3.2 Schemas | `vimax/agents/schemas.ts` | ~120 | - | 0.5d |
| 1.3.3 Screenwriter | `vimax/agents/screenwriter.ts` | ~250 | 1.3.1,1.2.2 | 1d |
| 1.3.4 CharacterExtractor | `vimax/agents/character-extractor.ts` | ~130 | 1.3.1,1.2.2 | 0.5d |
| 1.3.5 Portraits gen | `vimax/agents/character-portraits.ts` | ~200 | 1.3.1,1.2.* | 1d |
| 1.3.6 Storyboard artist | `vimax/agents/storyboard-artist.ts` | ~350 | 1.3.1,1.3.7 | 1.5d |
| 1.3.7 Reference selector | `vimax/agents/reference-selector.ts` | ~250 | 1.3.1,1.1.* | 0.75d |
| 1.3.8 Camera generator | `vimax/agents/camera-generator.ts` | ~180 | 1.3.1,1.2.4 | 0.75d |
| 1.3.9 Agents index | `vimax/agents/index.ts` | ~20 | 1.3.* | 0.1d |
| **Phase 1 total** | **19 files** | **~2,960** | | **~11.5d** |

---

## Phase 2: ViMax Creative Pipelines (CRITICAL)

### 2.1 Idea2Video Pipeline

- **Create:** `electron/native-pipeline/vimax/pipelines/idea2video.ts`
- **Python source:** `vimax/pipelines/idea2video.py` (302 lines)
- **Structure:**
  ```
  - interface Idea2VideoConfig { output_dir, save_intermediate, target_duration, video_model, image_model, llm_model, screenwriter?, character_extractor?, portraits_generator?, storyboard_artist?, camera_generator?, generate_portraits, use_character_references, parallel_generation }
  - interface Idea2VideoResult { success, idea, script?, characters, portraits, portrait_registry?, storyboard?, output?, started_at, completed_at?, total_cost, errors }
  - class Idea2VideoPipeline {
      screenwriter, character_extractor, portraits_generator, storyboard_artist, camera_generator
      run(idea: string): Promise<Idea2VideoResult>
      // 5-step orchestration:
      // 1. Screenwriter.process(idea) → Script
      // 2. CharacterExtractor.process(scriptText) → Characters
      // 3. CharacterPortraitsGenerator.generateBatch(characters) → Portraits + Registry
      // 4. StoryboardArtist.process(script, registry) → Storyboard
      // 5. CameraImageGenerator.process(storyboard) → Videos + Final
    }
  ```
- **Dependencies:** All Phase 1 agents
- **Est. time:** 2 days

### 2.2 Script2Video Pipeline

- **Create:** `electron/native-pipeline/vimax/pipelines/script2video.ts`
- **Python source:** `vimax/pipelines/script2video.py` (163 lines)
- **Structure:**
  ```ts
  - interface Script2VideoConfig { output_dir, video_model, image_model, use_character_references, storyboard_artist?, camera_generator? }
  - interface Script2VideoResult { success, script, portrait_registry?, used_references, output?, started_at, completed_at?, total_cost, errors }
  - class Script2VideoPipeline {
      run(script: Script | object | string, portraitRegistry?): Promise<Script2VideoResult>
      // 2-step: Storyboard → Videos
      _loadScript(path: string): Script  // Load from JSON file
    }
  ```
- **Dependencies:** Storyboard artist, Camera generator agents
- **Est. time:** 1 day

### 2.3 Novel2Movie Pipeline

- **Create:** `electron/native-pipeline/vimax/pipelines/novel2movie.ts`
- **Python source:** `vimax/pipelines/novel2movie.py` (452 lines)
- **Structure:**
  ```
  - interface Novel2MovieConfig { output_dir, max_scenes, scene_duration, video_model, image_model, llm_model, generate_portraits, use_character_references, max_characters, scripts_only, storyboard_only, save_intermediate, chunk_size, overlap }
  - interface ChapterSummary { chapter_id, title, summary, key_events, characters, setting }
  - interface Novel2MovieResult { success, novel_title, chapters, scripts, characters, portraits, portrait_registry?, output?, started_at, completed_at?, total_cost, errors }
  - class Novel2MoviePipeline {
      run(novelText: string, title?: string): Promise<Novel2MovieResult>
      _compressNovel(text): Promise<ChapterSummary[]>  // LLM-based chapter extraction with structured output
      _splitText(text): string[]  // Overlapping chunk splitting with sentence boundary detection
      _chapterToIdea(chapter): string
      // 4-step per chapter: Extract chars → Portraits → Storyboard → Videos → Concatenate all
    }
  ```
- **Key features:** `scripts_only` and `storyboard_only` mode flags, per-chapter subfolders, intermediate saving
- **Dependencies:** All Phase 1 agents, LLM adapter
- **Est. time:** 2.5 days

### 2.4 Pipelines Barrel Export

- **Create:** `electron/native-pipeline/vimax/pipelines/index.ts`
- **Dependencies:** 2.1-2.3
- **Est. time:** 0.1 day

### 2.5 ViMax Module Root Export

- **Create:** `electron/native-pipeline/vimax/index.ts`
- Re-exports: types, adapters, agents, pipelines
- **Dependencies:** All Phase 1 + Phase 2
- **Est. time:** 0.1 day

### Phase 2 Summary

| Subtask | File | Lines (est.) | Deps | Time |
|---------|------|:---:|------|:---:|
| 2.1 Idea2Video | `vimax/pipelines/idea2video.ts` | ~300 | Phase 1 | 2d |
| 2.2 Script2Video | `vimax/pipelines/script2video.ts` | ~170 | Agents | 1d |
| 2.3 Novel2Movie | `vimax/pipelines/novel2movie.ts` | ~450 | Phase 1 | 2.5d |
| 2.4 Pipelines index | `vimax/pipelines/index.ts` | ~10 | 2.1-2.3 | 0.1d |
| 2.5 ViMax root | `vimax/index.ts` | ~15 | All | 0.1d |
| **Phase 2 total** | **5 files** | **~945** | | **~5.7d** |

---

## Phase 3: Parallel Execution (HIGH)

### 3.1 Parallel Step Executor

- **Create:** `electron/native-pipeline/parallel-executor.ts`
- **Python source:** `core/parallel_executor.py` (570 lines)
- **Structure:**
  ```
  - interface ParallelConfig { enabled: boolean, maxWorkers: number }
  - interface ParallelStats { sequential_time, parallel_time, speedup_factor, threads_used, parallel_groups }
  - interface ParallelGroup { type: "explicit" | "implicit", steps: PipelineStep[], merge_strategy: MergeStrategy }
  - enum MergeStrategy { COLLECT_ALL, FIRST_SUCCESS, BEST_QUALITY, MERGE_OUTPUTS }
  - class ParallelPipelineExecutor extends PipelineExecutor {
      executeChain(chain, input, onProgress, signal?): Promise<PipelineResult>
      _analyzeParallelOpportunities(steps): ParallelGroup[]
      _canParallelizeStep(step, index): boolean
      _executeParallelGroup(group, input, signal?): Promise<StepResult[]>
      _mergeResults(results, strategy): StepResult
      _calculatePerformanceStats(): ParallelStats
    }
  ```
- **TypeScript approach:** Use `Promise.all()` / `Promise.allSettled()` instead of ThreadPoolExecutor (Node.js is async I/O native, no need for threads for API calls)
- **Dependencies:** Existing `executor.ts`
- **Est. time:** 1.5 days

### 3.2 YAML Parallel Group Support

- **Modify:** `electron/native-pipeline/chain-parser.ts`
- **Changes:**
  ```
  - Add PipelineStep.type = "parallel_group" parsing
  - Add parallel_group YAML schema:
    steps:
      - type: parallel_group
        merge_strategy: COLLECT_ALL
        steps:
          - type: text_to_image
            model: flux_dev
            params: { prompt: "..." }
          - type: text_to_image
            model: flux_pro
            params: { prompt: "..." }
  - Update validateChain() to validate parallel groups
  - Add getDataTypeForCategory() support for parallel_group
  ```
- **Dependencies:** 3.1
- **Est. time:** 0.75 day

### 3.3 Executor Integration

- **Modify:** `electron/native-pipeline/executor.ts`
- **Changes:**
  - Import and delegate to ParallelPipelineExecutor when parallel steps detected
  - Add `parallel` flag to `PipelineChain.config`
  - Emit parallel performance stats in result metadata
- **Dependencies:** 3.1, 3.2
- **Est. time:** 0.5 day

### 3.4 CLI Parallel Flag

- **Modify:** `electron/native-pipeline/cli.ts`
- **Changes:**
  - Add `--parallel` flag
  - Add `--max-workers` option
  - Pass to executor config
  - Display speedup stats in output
- **Modify:** `electron/native-pipeline/cli-runner.ts`
  - Wire parallel config to executor
- **Dependencies:** 3.1, 3.3
- **Est. time:** 0.25 day

### Phase 3 Summary

| Subtask | File | Lines (est.) | Deps | Time |
|---------|------|:---:|------|:---:|
| 3.1 Parallel executor | `parallel-executor.ts` | ~350 | executor.ts | 1.5d |
| 3.2 YAML parallel | `chain-parser.ts` (mod) | +80 | 3.1 | 0.75d |
| 3.3 Executor integration | `executor.ts` (mod) | +40 | 3.1, 3.2 | 0.5d |
| 3.4 CLI parallel flag | `cli.ts` + `cli-runner.ts` (mod) | +30 | 3.1 | 0.25d |
| **Phase 3 total** | **1 new + 3 modified** | **~500** | | **~3d** |

---

## Phase 4: Missing CLI Commands (MEDIUM)

### 4.1 `analyze-video` Command

- **Modify:** `electron/native-pipeline/cli.ts` (add command)
- **Modify:** `electron/native-pipeline/cli-runner.ts` (add handler)
- **Structure:**
  ```
  Command: analyze-video
  Options: --input/-i (video path/URL), --model (default: gemini_2_0_flash), --prompt (analysis question)
  Handler: Calls Gemini/GPT-4V via callModelApi with video input
  Output: Analysis text (or JSON with --json flag)
  ```
- **Dependencies:** Existing `api-caller.ts`, image understanding models
- **Est. time:** 0.75 day

### 4.2 `transcribe` Command

- **Modify:** `electron/native-pipeline/cli.ts`
- **Modify:** `electron/native-pipeline/cli-runner.ts`
- **Structure:**
  ```
  Command: transcribe
  Options: --input/-i (audio path/URL), --model (default: openai_whisper)
  Handler: Calls Whisper via callModelApi with audio input
  Output: Transcription text with timestamps (or JSON)
  ```
- **Dependencies:** Existing `api-caller.ts`, STT models
- **Est. time:** 0.5 day

### 4.3 `transfer-motion` Command

- **Modify:** `electron/native-pipeline/cli.ts`
- **Modify:** `electron/native-pipeline/cli-runner.ts`
- **Structure:**
  ```
  Command: transfer-motion
  Options: --image-url, --video-url, --model (default: kling motion transfer model)
  Handler: Calls Kling v2.6 motion transfer API
  Output: Generated video path
  ```
- **Dependencies:** Existing `api-caller.ts`, need to register motion transfer model in registry
- **Est. time:** 0.5 day

### 4.4 `generate-grid` Command

- **Modify:** `electron/native-pipeline/cli.ts`
- **Modify:** `electron/native-pipeline/cli-runner.ts`
- **Create:** `electron/native-pipeline/grid-generator.ts` (new utility)
- **Structure:**
  ```
  Command: generate-grid
  Options: --text (prompt), --layout (2x2, 3x3, default: 2x2), --model, --output-dir
  Handler: Generate N images, composite into grid using sharp/canvas
  Output: Grid image path
  ```
- **Dependencies:** Existing image generation, needs `sharp` or canvas library for compositing
- **Est. time:** 0.75 day

### 4.5 `upscale-image` Command

- **Modify:** `electron/native-pipeline/cli.ts`
- **Modify:** `electron/native-pipeline/cli-runner.ts`
- **Structure:**
  ```
  Command: upscale-image
  Options: --image (path/URL), --upscale (1-8x, default: 2), --model (default: seedvr2 or topaz)
  Handler: Calls upscale API via callModelApi
  Output: Upscaled image path
  ```
- **Dependencies:** Existing `api-caller.ts`, upscale models
- **Est. time:** 0.5 day

### 4.6 `setup` / Key Management Commands

- **Modify:** `electron/native-pipeline/cli.ts`
- **Create:** `electron/native-pipeline/key-manager.ts` (new utility)
- **Structure:**
  ```
  Commands: setup, set-key, get-key, check-keys
  setup: Interactive .env file creation with API key templates
  set-key --name FAL_KEY --value xxx: Store key in .env or Electron encrypted storage
  get-key --name FAL_KEY: Read key (masked)
  check-keys: Validate all configured keys have values
  ```
- **Dependencies:** Node.js fs, existing Electron encrypted storage
- **Est. time:** 0.75 day

### 4.7 `create-examples` Command

- **Modify:** `electron/native-pipeline/cli.ts`
- **Create:** `electron/native-pipeline/example-pipelines.ts` (new utility)
- **Structure:**
  ```
  Command: create-examples
  Options: --output-dir (default: ./examples)
  Handler: Generate 3-5 sample YAML pipeline configs:
    - text-to-video-basic.yaml
    - image-to-video-chain.yaml
    - multi-step-pipeline.yaml
    - parallel-pipeline.yaml (if Phase 3 complete)
  ```
- **Dependencies:** None
- **Est. time:** 0.5 day

### 4.8 ViMax CLI Commands

- **Modify:** `electron/native-pipeline/cli.ts` (add vimax subcommands)
- **Modify:** `electron/native-pipeline/cli-runner.ts` (add handlers)
- **Structure:**
  ```
  Commands: vimax:idea2video, vimax:script2video, vimax:novel2movie

  vimax:idea2video:
    Options: --idea (text), --duration, --video-model, --image-model, --llm-model, --output-dir, --no-portraits
    Handler: Instantiate Idea2VideoPipeline, call run()

  vimax:script2video:
    Options: --script (JSON path), --portraits (JSON path), --video-model, --image-model, --output-dir
    Handler: Instantiate Script2VideoPipeline, call run()

  vimax:novel2movie:
    Options: --novel (text file path), --title, --max-scenes, --scripts-only, --storyboard-only, --output-dir
    Handler: Read novel file, instantiate Novel2MoviePipeline, call run()
  ```
- **Dependencies:** Phase 2 pipelines
- **Est. time:** 1.5 days

### 4.9 Category-Specific List Commands

- **Modify:** `electron/native-pipeline/cli.ts`
- **Modify:** `electron/native-pipeline/cli-runner.ts`
- **Structure:**
  ```
  Commands: list-avatar-models, list-video-models, list-motion-models, list-speech-models
  Handler: Wrapper around existing list-models with category filter
  Output: Filtered model list
  ```
- **Dependencies:** Existing `list-models` command
- **Est. time:** 0.25 day

### Phase 4 Summary

| Subtask | Files | Lines (est.) | Time |
|---------|-------|:---:|:---:|
| 4.1 analyze-video | cli.ts, cli-runner.ts (mod) | +60 | 0.75d |
| 4.2 transcribe | cli.ts, cli-runner.ts (mod) | +50 | 0.5d |
| 4.3 transfer-motion | cli.ts, cli-runner.ts (mod) | +50 | 0.5d |
| 4.4 generate-grid | cli.ts (mod) + grid-generator.ts | +120 | 0.75d |
| 4.5 upscale-image | cli.ts, cli-runner.ts (mod) | +40 | 0.5d |
| 4.6 Key management | cli.ts (mod) + key-manager.ts | +150 | 0.75d |
| 4.7 create-examples | cli.ts (mod) + example-pipelines.ts | +100 | 0.5d |
| 4.8 ViMax CLI | cli.ts, cli-runner.ts (mod) | +200 | 1.5d |
| 4.9 List filters | cli.ts, cli-runner.ts (mod) | +30 | 0.25d |
| **Phase 4 total** | **2 new + 2 modified** | **~800** | **~6d** |

---

## Phase 5: Missing Models & Providers (LOW)

### 5.1 Runway Provider

- **Modify:** `electron/native-pipeline/registry-data.ts` or `registry-data-2.ts`
- **Modify:** `electron/native-pipeline/api-caller.ts` (add Runway provider headers/auth)
- **Models to add:**
  - `runway_gen2` - Text/Image to video (Gen-2)
  - `runway_v2v` - Video to video
- **Auth:** Runway API key, bearer token
- **Est. time:** 0.5 day

### 5.2 HeyGen Provider

- **Modify:** `electron/native-pipeline/registry-data-2.ts`
- **Modify:** `electron/native-pipeline/api-caller.ts`
- **Models to add:**
  - `heygen_avatar_2_1` - Avatar generation
- **Auth:** HeyGen API key
- **Est. time:** 0.5 day

### 5.3 D-ID Provider

- **Modify:** `electron/native-pipeline/registry-data-2.ts`
- **Modify:** `electron/native-pipeline/api-caller.ts`
- **Models to add:**
  - `did_studio` - Avatar generation
- **Auth:** D-ID API key, basic auth
- **Est. time:** 0.5 day

### 5.4 Synthesia Provider

- **Modify:** `electron/native-pipeline/registry-data-2.ts`
- **Modify:** `electron/native-pipeline/api-caller.ts`
- **Models to add:**
  - `synthesia_avatar` - Enterprise avatar generation
- **Auth:** Synthesia API key
- **Est. time:** 0.5 day

### Phase 5 Summary

| Subtask | Files | Time |
|---------|-------|:---:|
| 5.1 Runway | registry-data.ts, api-caller.ts (mod) | 0.5d |
| 5.2 HeyGen | registry-data-2.ts, api-caller.ts (mod) | 0.5d |
| 5.3 D-ID | registry-data-2.ts, api-caller.ts (mod) | 0.5d |
| 5.4 Synthesia | registry-data-2.ts, api-caller.ts (mod) | 0.5d |
| **Phase 5 total** | **4 modified** | **~2d** |

---

## Phase 6: Polish & Parity (LOW)

### 6.1 Structured Exit Codes

- **Modify:** `electron/native-pipeline/cli.ts`
- **Create:** `electron/native-pipeline/exit-codes.ts`
- **Structure:**
  ```
  enum ExitCode {
    SUCCESS = 0,
    GENERAL_ERROR = 1,
    INVALID_ARGS = 2,
    MODEL_NOT_FOUND = 3,
    API_KEY_MISSING = 4,
    API_CALL_FAILED = 5,
    PIPELINE_FAILED = 6,
    FILE_NOT_FOUND = 7,
    PERMISSION_DENIED = 8,
    TIMEOUT = 9,
    CANCELLED = 10,
    COST_LIMIT = 11,
  }
  ```
- **Est. time:** 0.25 day

### 6.2 JSONL Streaming Output

- **Modify:** `electron/native-pipeline/cli-runner.ts`
- **Changes:**
  - Add `--stream` flag to CLI
  - When enabled, emit JSONL events to stdout for each step: `{ event: "step_start" | "step_complete" | "progress", data: {...} }`
  - Compatible with piping to other tools
- **Est. time:** 0.5 day

### 6.3 XDG Directory Support

- **Modify:** `electron/native-pipeline/output-utils.ts`
- **Changes:**
  - Add `--config-dir`, `--cache-dir`, `--state-dir` CLI options
  - Resolve paths per XDG spec on Linux, `~/Library/Application Support/` on macOS, `%APPDATA%` on Windows
  - Use for: config files, cached responses, pipeline state
- **Est. time:** 0.5 day

### 6.4 Rich Console Output

- **Modify:** `electron/native-pipeline/cli-runner.ts`
- **Create:** `electron/native-pipeline/cli-formatter.ts`
- **Structure:**
  - Table formatting for `list-models` (columns: key, name, provider, category, cost)
  - Colored output using ANSI codes (no external deps)
  - Spinner for long-running operations
  - Progress bar with percentage and ETA
- **Est. time:** 1 day

### 6.5 Interactive CLI Mode

- **Modify:** `electron/native-pipeline/cli.ts`
- **Changes:**
  - Add `--interactive` / `-I` flag
  - When enabled, use Node.js `readline` for prompt-based interaction
  - Menu: select command, enter parameters, confirm before execution
- **Est. time:** 0.75 day

### 6.6 Service-Level Feature Gaps

- **Modify:** `electron/native-pipeline/step-executors.ts`
- **Changes:**
  - **Voice cloning:** Add `voice_id` and `voice_settings` params to ElevenLabs TTS executor
  - **Negative prompts:** Add `negative_prompt` param to Kling 2.1 models
  - **Frame interpolation:** Add `interpolation_frames` param to Kling 2.1 models
  - **Prompt optimizer:** Add MiniMax Hailuo prompt optimization call before video generation
- **Est. time:** 1 day

### Phase 6 Summary

| Subtask | Files | Time |
|---------|-------|:---:|
| 6.1 Exit codes | cli.ts (mod) + exit-codes.ts | 0.25d |
| 6.2 JSONL streaming | cli-runner.ts (mod) | 0.5d |
| 6.3 XDG dirs | output-utils.ts (mod) | 0.5d |
| 6.4 Rich console | cli-runner.ts (mod) + cli-formatter.ts | 1d |
| 6.5 Interactive mode | cli.ts (mod) | 0.75d |
| 6.6 Service features | step-executors.ts (mod) | 1d |
| **Phase 6 total** | **1 new + 4 modified** | **~4d** |

---

## Phase 7: Tests

### 7.1 Unit Tests for ViMax Types & Agents

- **Create:** `electron/__tests__/vimax-types.test.ts`
- **Create:** `electron/__tests__/vimax-agents.test.ts`
- **Create:** `electron/__tests__/vimax-adapters.test.ts`
- **Coverage:** Type construction, JSON serialization, agent process() with mocked adapters, parseLlmJson edge cases, reference selector fuzzy matching
- **Est. time:** 1.5 days

### 7.2 Unit Tests for Pipelines

- **Create:** `electron/__tests__/vimax-pipelines.test.ts`
- **Coverage:** Idea2Video, Script2Video, Novel2Movie with fully mocked agents, intermediate saving, error handling, config from YAML
- **Est. time:** 1 day

### 7.3 Unit Tests for Parallel Executor

- **Create:** `electron/__tests__/parallel-executor.test.ts`
- **Coverage:** Parallel group detection, merge strategies, performance stats, YAML parallel_group parsing, abort signal handling
- **Est. time:** 0.75 day

### 7.4 CLI Command Tests

- **Modify:** `electron/__tests__/cli-pipeline.test.ts` (add new command tests)
- **Coverage:** analyze-video, transcribe, transfer-motion, generate-grid, upscale-image, key management, create-examples, vimax subcommands
- **Est. time:** 0.75 day

### Phase 7 Summary

| Subtask | Files | Time |
|---------|-------|:---:|
| 7.1 Types & agents | 3 test files | 1.5d |
| 7.2 Pipelines | 1 test file | 1d |
| 7.3 Parallel | 1 test file | 0.75d |
| 7.4 CLI commands | 1 test file (mod) | 0.75d |
| **Phase 7 total** | **5 test files** | **~4d** |

---

## Phase 8: Integration

### 8.1 Manager Integration

- **Modify:** `electron/native-pipeline/manager.ts`
- **Changes:**
  - Add ViMax pipeline commands to `GenerateOptions.command` union type:
    `"vimax:idea2video" | "vimax:script2video" | "vimax:novel2movie"`
  - Route to pipeline instances from `execute()`
  - Add progress reporting from pipeline stages
  - Update `PipelineStatus.features` with: `vimaxPipelines: true, parallelExecution: true`
- **Est. time:** 0.75 day

### 8.2 IPC Handler Integration

- **Modify:** `electron/ai-pipeline-ipc.ts`
- **Changes:** None expected (NativePipelineManager already implements the same interface)
- **Verify:** ViMax commands work via IPC from renderer process
- **Est. time:** 0.25 day

### 8.3 Index Barrel Update

- **Modify:** `electron/native-pipeline/index.ts`
- **Changes:** Export ViMax types, agents, pipelines, parallel executor
- **Est. time:** 0.1 day

### Phase 8 Summary

| Subtask | Files | Time |
|---------|-------|:---:|
| 8.1 Manager | manager.ts (mod) | 0.75d |
| 8.2 IPC verification | ai-pipeline-ipc.ts (verify) | 0.25d |
| 8.3 Index update | index.ts (mod) | 0.1d |
| **Phase 8 total** | **3 modified** | **~1.1d** |

---

## Directory Structure (Final)

```
electron/native-pipeline/
├── api-caller.ts              (existing)
├── chain-parser.ts            (modified: parallel groups)
├── cli.ts                     (modified: new commands)
├── cli-runner.ts              (modified: new handlers)
├── cli-formatter.ts           (NEW: rich output)
├── cost-calculator.ts         (existing)
├── example-pipelines.ts       (NEW: sample YAMLs)
├── executor.ts                (modified: parallel delegation)
├── exit-codes.ts              (NEW: structured codes)
├── grid-generator.ts          (NEW: image grid)
├── index.ts                   (modified: exports)
├── init.ts                    (existing)
├── key-manager.ts             (NEW: API key management)
├── manager.ts                 (modified: vimax routing)
├── output-utils.ts            (modified: XDG)
├── parallel-executor.ts       (NEW: parallel steps)
├── registry.ts                (existing)
├── registry-data.ts           (modified: new models)
├── registry-data-2.ts         (modified: new models)
├── step-executors.ts          (modified: service features)
└── vimax/                     (NEW: entire directory)
    ├── index.ts
    ├── types/
    │   ├── index.ts
    │   ├── shot.ts
    │   ├── character.ts
    │   ├── camera.ts
    │   └── output.ts
    ├── adapters/
    │   ├── index.ts
    │   ├── base-adapter.ts
    │   ├── llm-adapter.ts
    │   ├── image-adapter.ts
    │   └── video-adapter.ts
    ├── agents/
    │   ├── index.ts
    │   ├── base-agent.ts
    │   ├── schemas.ts
    │   ├── screenwriter.ts
    │   ├── character-extractor.ts
    │   ├── character-portraits.ts
    │   ├── storyboard-artist.ts
    │   ├── reference-selector.ts
    │   └── camera-generator.ts
    └── pipelines/
        ├── index.ts
        ├── idea2video.ts
        ├── script2video.ts
        └── novel2movie.ts
```

---

## Execution Order & Dependencies

```
Phase 1.1 (Types)          ─┐
Phase 1.2 (Adapters)       ─┤─→ Phase 1.3 (Agents) ─→ Phase 2 (Pipelines) ─→ Phase 8 (Integration)
Phase 1.3.1-2 (Base/Schema)─┘

Phase 3 (Parallel) ── independent, can run concurrently with Phase 2
Phase 4 (CLI) ── partially independent (4.1-4.7 parallel with Phase 2; 4.8 requires Phase 2)
Phase 5 (Models) ── fully independent
Phase 6 (Polish) ── fully independent
Phase 7 (Tests) ── after corresponding implementation phases
```

**Recommended parallel tracks:**

| Track A (Critical Path) | Track B (Independent) |
|---|---|
| Phase 1.1 → 1.2 → 1.3 | Phase 3 (Parallel) |
| Phase 2 → Phase 8 | Phase 4.1-4.7 (CLI commands) |
| Phase 4.8 (ViMax CLI) | Phase 5 (Models) |
| Phase 7 (Tests) | Phase 6 (Polish) |

---

## Grand Total

| Phase | Files | Est. Time | Priority |
|-------|:---:|:---:|:---:|
| **Phase 1:** Agent Framework | 19 new | 11.5 days | CRITICAL |
| **Phase 2:** Creative Pipelines | 5 new | 5.7 days | CRITICAL |
| **Phase 3:** Parallel Execution | 1 new + 3 mod | 3 days | HIGH |
| **Phase 4:** CLI Commands | 2 new + 2 mod | 6 days | MEDIUM |
| **Phase 5:** Missing Models | 4 mod | 2 days | LOW |
| **Phase 6:** Polish & Parity | 1 new + 4 mod | 4 days | LOW |
| **Phase 7:** Tests | 5 new | 4 days | MEDIUM |
| **Phase 8:** Integration | 3 mod | 1.1 days | HIGH |
| **TOTAL** | **33 new + 16 mod** | **~37 days** | |

### Start Here

**Day 1:** Subtasks 1.1.1-1.1.5 (all types) + 1.2.1 (base adapter) + 1.3.1 (base agent) + 1.3.2 (schemas) — all independent, can be done in parallel.
