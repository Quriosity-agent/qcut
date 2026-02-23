# QCut AI Director Integration Plan

> Porting Moyin Creator's AI Director capabilities into QCut's Creation section

## Implementation Status (2026-02-22)

> **Architecture Decision:** Instead of a separate `packages/ai-director/` package, the implementation absorbed modules directly into `apps/web/src/lib/moyin/` following QCut's existing patterns. This avoids monorepo package overhead while achieving the same modularity. The `apps/desktop/` path referenced in this plan does not exist — QCut uses `apps/web/` for all frontend code.

| Area | Status | Implemented Location |
|------|--------|---------------------|
| Script parser | **Done** | `apps/web/src/lib/moyin/script/script-parser.ts` |
| System prompts (parse, shot gen, creative) | **Done** | `apps/web/src/lib/moyin/script/system-prompts.ts` |
| Character bible (6-layer identity) | **Done** | `apps/web/src/lib/moyin/character/character-bible.ts` |
| Character types | **Done** | `apps/web/src/lib/moyin/character/types.ts` |
| Cinematography profiles | **Done** | `apps/web/src/lib/moyin/presets/cinematography-profiles.ts` |
| Visual styles | **Done** | `apps/web/src/lib/moyin/presets/visual-styles.ts` |
| Director presets | **Done** | `apps/web/src/lib/moyin/presets/director-presets.ts` |
| Grid calculator | **Done** | `apps/web/src/lib/moyin/storyboard/grid-calculator.ts` |
| Prompt builder | **Done** | `apps/web/src/lib/moyin/storyboard/prompt-builder.ts` |
| Image splitter | **Done** | `apps/web/src/lib/moyin/storyboard/image-splitter.ts` |
| Scene prompt generator | **Done** | `apps/web/src/lib/moyin/storyboard/scene-prompt-generator.ts` |
| Storyboard service | **Done** | `apps/web/src/lib/moyin/storyboard/storyboard-service.ts` |
| API key manager | **Done** | `apps/web/src/lib/moyin/utils/api-key-manager.ts` |
| Retry / rate-limiter / concurrency utils | **Done** | `apps/web/src/lib/moyin/utils/` |
| LLM adapter | **Done** | `apps/web/src/lib/moyin/script/llm-adapter.ts` |
| Core data types (Script, Scene, Shot, Camera) | **Done** | `apps/web/src/types/moyin-script.ts` |
| Zustand store (moyin workflow) | **Done** | `apps/web/src/stores/moyin-store.ts` |
| IPC handler (LLM script parsing) | **Done** | `electron/moyin-handler.ts` |
| Preload API integration | **Done** | `electron/preload-integrations.ts`, `electron/preload.ts` |
| Moyin tab in media panel | **Done** | `apps/web/src/components/editor/media-panel/views/moyin/` (6 components) |
| Type definitions in ElectronAPI | **Done** | `apps/web/src/types/electron.d.ts`, `electron/preload-types.ts` |
| Unit tests | **Done** | 344 tests across 6 test files |
| Episode parser | **Done** | `apps/web/src/lib/moyin/script/episode-parser.ts` |
| Shot generator | **Done** | `apps/web/src/lib/moyin/script/shot-generator.ts` |
| AI character finder | **Done** | `apps/web/src/lib/moyin/script/ai-character-finder.ts` |
| AI scene finder | **Done** | `apps/web/src/lib/moyin/script/ai-scene-finder.ts` |
| Character calibrator | **Done** | `apps/web/src/lib/moyin/script/character-calibrator.ts` + `character-calibrator-enrichment.ts` |
| Scene calibrator | **Done** | `apps/web/src/lib/moyin/script/scene-calibrator.ts` |
| Character stage analyzer | **Done** | `apps/web/src/lib/moyin/script/character-stage-analyzer.ts` |
| AI Provider abstraction (`packages/ai-director/`) | **Skipped** | Uses existing QCut AI pipeline + direct LLM calls via `llm-adapter.ts` |
| Full-script-service orchestrator | **Deferred** | Individual modules ported; orchestrator deferred until UI/store layer ready |
| Director store (split into sub-stores) | **Not started** | — |
| Character library store/UI | **Not started** | — |
| Scene library store/UI | **Not started** | — |
| Director panel UI (advanced storyboard) | **Not started** | — |

**Files: 45 total** (34 lib + 1 store + 7 UI components + 1 type file + 1 IPC handler + 1 preload integration)

---

## Overview

### Goal
Add a "Director" module to QCut's Creation section that enables: **Script → Storyboard → Image Generation → Video Generation** — a complete AI-driven pre-production pipeline.

### Approach
- **Port logic layer** (Zustand stores + lib services) from Moyin Creator
- **Rewrite UI** in QCut's existing component style (not copy-paste shadcn/ui)
- **Abstract AI providers** — don't lock into RunningHub; support fal.ai, Replicate, local ComfyUI

### Architecture Principle
Moyin is a standalone app; QCut is a video editor. The Director module is a **feeder** — it produces assets (images, videos, shot lists) that flow into QCut's timeline. Keep this boundary clean.

---

## Phase 1: Script + Director (Core Pipeline) — ~2-3 Weeks

> **Implementation Note (2026-02-22):** Phase 1 was partially implemented via a different approach. Instead of creating `packages/ai-director/`, the core library modules were ported directly into `apps/web/src/lib/moyin/`. The AI provider abstraction (1.1) was skipped in favor of using QCut's existing AI pipeline (`window.electronAPI.aiPipeline`) and direct LLM calls via `electron/moyin-handler.ts`. The script parser (1.2) and storyboard modules (1.3) are implemented. Navigation (1.4) is done as a "Moyin" tab in the media panel's "Create" group.

### 1.1 AI Provider Abstraction Layer (Week 1, Days 1-3) — NOT STARTED

> **Status:** Skipped for initial integration. LLM calls route through `electron/moyin-handler.ts` which uses `getDecryptedApiKeys()` to auto-select OpenRouter or Gemini. Image/video generation uses QCut's existing `aiPipeline` IPC. A dedicated provider abstraction can be added later if multi-provider switching is needed.

**Do this first.** Everything else depends on it.

#### What to Build

Create `packages/ai-director/` as a new package (don't pollute `@opencut/ai-core` which handles transcription/editing):

```
packages/ai-director/
├── src/
│   ├── providers/
│   │   ├── types.ts              # ImageGenProvider, VideoGenProvider interfaces
│   │   ├── fal-provider.ts       # fal.ai implementation (primary)
│   │   ├── replicate-provider.ts # Replicate implementation
│   │   ├── runninghub-provider.ts# RunningHub/ComfyUI implementation
│   │   └── local-comfy-provider.ts # Local ComfyUI (future)
│   ├── feature-router.ts         # Maps features → configured provider
│   ├── prompt-builder.ts         # Shared prompt construction utilities
│   └── index.ts
├── package.json
└── tsconfig.json
```

#### Key Interfaces

```typescript
interface ImageGenProvider {
  id: string;
  name: string;
  generate(params: ImageGenParams): Promise<ImageGenResult>;
  checkStatus(taskId: string): Promise<TaskStatus>;
  estimateCost(params: ImageGenParams): CostEstimate;
}

interface VideoGenProvider {
  id: string;
  name: string;
  generate(params: VideoGenParams): Promise<VideoGenResult>;
  checkStatus(taskId: string): Promise<TaskStatus>;
}

interface ImageGenParams {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  model?: string;
  seed?: number;
  referenceImages?: string[]; // For character/scene consistency
}
```

#### Port from Moyin

| Source (Moyin) | Target (QCut) | Notes |
|---|---|---|
| `src/lib/ai/feature-router.ts` | `packages/ai-director/src/feature-router.ts` | Simplify; remove RunningHub-specific logic |
| `src/lib/ai/image-generator.ts` | `packages/ai-director/src/providers/types.ts` | Extract interface, rewrite implementations |
| `src/lib/ai/runninghub-client.ts` | `packages/ai-director/src/providers/runninghub-provider.ts` | Keep as one provider option |
| `src/stores/api-config-store.ts` | `apps/desktop/src/stores/ai-provider-config-store.ts` | Multi-provider key management |

#### Provider Config Store

Port `api-config-store.ts` concept into QCut. UI: Settings panel where user configures API keys for each provider and selects default provider for image gen / video gen.

```typescript
// ai-provider-config-store.ts
interface AIProviderConfig {
  imageGen: {
    provider: 'fal' | 'replicate' | 'runninghub' | 'local';
    apiKeys: Record<string, string>;
    defaultModel: string;
  };
  videoGen: {
    provider: 'fal' | 'replicate' | 'runninghub';
    apiKeys: Record<string, string>;
    defaultModel: string;
  };
  textGen: {
    // Already handled by @opencut/ai-core (Claude)
    // Just reference it here
  };
}
```

**Decision: fal.ai as primary** — API key already configured, good model selection, simple REST API. RunningHub as secondary for users with ComfyUI workflows.

---

### 1.2 Script Module (Week 1, Days 3-5 + Week 2, Days 1-2) — PARTIALLY DONE

> **Status (2026-02-22):** All library modules ported. Core script parser at `apps/web/src/lib/moyin/script/script-parser.ts` with system prompts. LLM-based parsing works via `electron/moyin-handler.ts` IPC channel (`moyin:parse-script`). Types in `apps/web/src/types/moyin-script.ts`. Shot generator, episode parser, character/scene calibrators, AI finders, and character-stage-analyzer are all ported. The full-script-service orchestrator (2320 lines) is **deferred** — it coordinates all individual modules, which are already independently usable. LLM adapter (`llm-adapter.ts`) provides `callFeatureAPI` routing through `moyin:call-llm` IPC.

#### What to Port

The script module converts raw text/outline into a structured hierarchy: **Episode → Scene → Shot**, with auto-extracted characters and scene descriptions.

**Library files** — port all 14 files from `src/lib/script/`:

| Source (Moyin) | Target (QCut) | Priority | Status | Notes |
|---|---|---|---|---|
| `src/lib/script/script-parser.ts` | `apps/web/src/lib/moyin/script/script-parser.ts` | P0 | **Done** | Core parser — text → structured script |
| `src/lib/script/full-script-service.ts` | — | P0 | **Deferred** | 2320-line orchestrator; individual modules ported, orchestrator deferred until UI/store layer ready |
| `src/lib/script/shot-generator.ts` | `apps/web/src/lib/moyin/script/shot-generator.ts` | P0 | **Done** | Image/video generation for individual shots with task polling |
| `src/lib/script/episode-parser.ts` | `apps/web/src/lib/moyin/script/episode-parser.ts` | P0 | **Done** | Splits script into episodes, extracts scenes/dialogues/actions |
| `src/lib/script/character-calibrator.ts` | `apps/web/src/lib/moyin/script/character-calibrator.ts` + `character-calibrator-enrichment.ts` | P1 | **Done** | Split into 2 files (800-line limit); AI calibration + 6-layer identity enrichment |
| `src/lib/script/scene-calibrator.ts` | `apps/web/src/lib/moyin/script/scene-calibrator.ts` | P1 | **Done** | Scene calibration with art direction and visual prompts |
| `src/lib/script/ai-character-finder.ts` | `apps/web/src/lib/moyin/script/ai-character-finder.ts` | P1 | **Done** | NL character search + AI character data generation |
| `src/lib/script/ai-scene-finder.ts` | `apps/web/src/lib/moyin/script/ai-scene-finder.ts` | P1 | **Done** | NL scene search + AI scene data generation |
| `src/lib/script/character-stage-analyzer.ts` | `apps/web/src/lib/moyin/script/character-stage-analyzer.ts` | P2 | **Done** | Multi-stage character detection + variation generation |
| `src/lib/script/trailer-service.ts` | `apps/web/src/lib/moyin/script/` | P3 | Not started | Trailer generation (Phase 3) |
| LLM adapter (new) | `apps/web/src/lib/moyin/script/llm-adapter.ts` | P0 | **Done** | Routes `callFeatureAPI` through `moyin:call-llm` IPC channel |

**Store:**

| Source (Moyin) | Target (QCut) | Status | Notes |
|---|---|---|---|
| `src/stores/script-store.ts` | `apps/web/src/stores/moyin-store.ts` | **Done** (simplified) | Session-scoped Zustand store with 4-step workflow (script → characters → scenes → generate). Does not yet support episodes or shot-level editing. |

#### Script Store Structure

```typescript
interface ScriptStore {
  // Input
  rawScript: string;
  scriptType: 'full' | 'outline' | 'shot-list';
  
  // Parsed output
  episodes: Episode[];
  characters: ExtractedCharacter[];
  scenes: ExtractedScene[];
  
  // State
  parsingStatus: 'idle' | 'parsing' | 'done' | 'error';
  
  // Actions
  setRawScript: (text: string) => void;
  parseScript: () => Promise<void>;
  updateShot: (episodeId: string, sceneId: string, shotId: string, updates: Partial<Shot>) => void;
}
```

#### UI Components

> **Status:** Implemented as a media panel tab (not a standalone two-column layout). The current implementation is simpler — a step-based wizard flow rather than the two-column script editor proposed here. The advanced tree view / property panel can be built later.

Implemented in `apps/web/src/components/editor/media-panel/views/moyin/`:

```
moyin/
├── index.tsx            # Root component with step routing (DONE)
├── step-indicator.tsx   # Step navigation bar (DONE)
├── script-input.tsx     # Textarea for raw script + parse button (DONE)
├── character-list.tsx   # Extracted characters as cards (DONE)
├── scene-list.tsx       # Extracted scenes as cards (DONE)
├── generate-actions.tsx # Storyboard generation controls (DONE)
└── __tests__/moyin-view.test.tsx # 20 component tests (DONE)
```

**Not yet implemented** (from original plan):
```
script/
├── ScriptTreeView.tsx       # Episode → Scene → Shot hierarchy (left sidebar)
├── ShotPropertyPanel.tsx    # Edit shot details (right panel)
├── ScriptToolbar.tsx        # Parse button, script type selector
└── CharacterScenePreview.tsx # Preview extracted characters/scenes
```

Layout: Original plan called for **two-column** — Script input / tree view on left, property panel on right. Current implementation is a **single-column step wizard** in the media panel. The two-column layout should be implemented when the Director panel (1.3) is built.

---

### 1.3 Director Module (Week 2, Days 2-5 + Week 3) — PARTIALLY DONE

> **Status (2026-02-22):** All storyboard library modules are ported — grid calculator, prompt builder, image splitter, scene-prompt-generator, and storyboard-service (contact sheet + video gen). Director presets are ported. The director store split and advanced Director UI are **not yet implemented**. The existing `moyin-store.ts` handles basic workflow but lacks the scene management, generation queue, and UI state sub-stores described below.

This is the core feature. Script output feeds in; storyboard images and videos come out.

#### Store Refactoring

The `director-store.ts` (1800+ lines) must be split:

| Source (Moyin) | Target (QCut) | Status | Notes |
|---|---|---|---|
| `src/stores/director-store.ts` (state types) | `apps/web/src/types/moyin-script.ts` | **Partial** | Shot/Scene/Camera types ported; director-specific state types not yet split out |
| `src/stores/director-store.ts` (scene management) | `apps/web/src/stores/director/director-scenes-store.ts` | Not started | Scene CRUD, split, merge (~400 lines) |
| `src/stores/director-store.ts` (generation logic) | `apps/web/src/stores/director/director-gen-store.ts` | Not started | Image/video generation queue (~500 lines) |
| `src/stores/director-store.ts` (UI state) | `apps/web/src/stores/director/director-ui-store.ts` | Not started | Selection, view mode, panels (~300 lines) |
| `src/stores/director-presets.ts` | `apps/web/src/lib/moyin/presets/director-presets.ts` | **Done** | Shot sizes, camera rigs, lighting, emotions — pure data, no UI dependency |

#### Library Files

| Source (Moyin) | Target (QCut) | Priority | Status | Notes |
|---|---|---|---|---|
| `src/lib/storyboard/storyboard-service.ts` | `apps/web/src/lib/moyin/storyboard/storyboard-service.ts` | P0 | **Done** | Contact sheet image gen + scene video gen with task polling |
| `src/lib/storyboard/prompt-builder.ts` | `apps/web/src/lib/moyin/storyboard/prompt-builder.ts` | P0 | **Done** | Builds generation prompts from scene data |
| `src/lib/storyboard/scene-prompt-generator.ts` | `apps/web/src/lib/moyin/storyboard/scene-prompt-generator.ts` | P0 | **Done** | Three-tier prompts (image/endFrame/video) per split scene |
| `src/lib/storyboard/image-splitter.ts` | `apps/web/src/lib/moyin/storyboard/image-splitter.ts` | P0 | **Done** | Splits storyboard grid into individual shots |
| `src/lib/storyboard/grid-calculator.ts` | `apps/web/src/lib/moyin/storyboard/grid-calculator.ts` | P1 | **Done** | Calculates grid layout for storyboard |
| `src/lib/ai/image-generator.ts` | Uses QCut's existing `aiPipeline` IPC | P0 | **Done** (via existing infra) | No separate provider needed |

#### Director Presets (Pure Data)

Port as-is — these are just constants:

```typescript
// director-presets.ts — example structure
export const SHOT_SIZES = ['extreme-close-up', 'close-up', 'medium-close-up', 'medium', 'medium-long', 'long', 'extreme-long'];
export const CAMERA_RIGS = ['static', 'handheld', 'dolly', 'crane', 'drone', 'steadicam'];
export const LIGHTING_PRESETS = ['natural', 'golden-hour', 'blue-hour', 'studio', 'dramatic', 'noir', 'neon'];
export const EMOTION_TAGS = ['calm', 'tense', 'joyful', 'melancholic', 'mysterious', 'epic', 'intimate'];
// + depth of field, focal length, photography techniques
```

#### Core Pipeline Flow

```
1. Script text → Parse → Episode/Scene/Shot tree
2. Shot tree → Storyboard Service → Composite storyboard image (grid)
3. Storyboard image → Image Splitter → Individual scene images
4. Scene images → Per-scene refinement (adjust prompt, regenerate)
5. Scene images → Video Generation → Per-scene video clips
6. Video clips → Export to QCut timeline
```

#### UI Components — NOT YET STARTED

> **Status:** The advanced Director UI is not yet implemented. Current storyboard workflow is handled by the simpler Moyin tab (`apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx`). The full Director panel below should be built when the director stores (scene management, generation queue, UI state) are ported.

Create in `apps/web/src/components/editor/director/` (future):

```
director/
├── DirectorPanel.tsx         # Main container
├── StoryboardView.tsx        # Grid view of storyboard
├── SceneCardGrid.tsx         # Split scenes as cards
├── SceneCard.tsx             # Individual scene: image + metadata + actions
├── SceneDetailPanel.tsx      # Edit scene: prompt, shot size, camera, lighting, etc.
├── GenerationQueue.tsx       # Progress for image/video generation tasks
├── PresetSelectors/
│   ├── ShotSizeSelector.tsx
│   ├── CameraRigSelector.tsx
│   ├── LightingSelector.tsx
│   └── EmotionSelector.tsx
└── DirectorToolbar.tsx       # Generate storyboard, split, batch generate buttons
```

---

### 1.4 Navigation Integration (Week 3, Days 3-5) — DONE (simplified)

> **Status:** Implemented as a "Moyin" tab in the media panel's "Create" group (`tabGroups["ai-create"]`), alongside AI Video, AI Images, and Sounds. Uses `ClapperboardIcon`. Registered in `apps/web/src/components/editor/media-panel/store.ts` and `index.tsx`. The sub-tab routing (Script / Storyboard) is handled by the step-based workflow in `moyin-store.ts` rather than a separate router.

#### QCut Creation Section Updates

Add "Director" as a tab in the Creation section alongside existing tools:

```
Creation
├── [Existing tools...]
├── Director          ← NEW
│   ├── Script        ← Sub-tab: write/paste/import script
│   └── Storyboard    ← Sub-tab: visual storyboard + generation
```

#### Integration Points

1. **Script → Director**: Parsed shot list auto-populates Director scenes
2. **Director → Timeline**: "Send to Timeline" action exports generated images/videos as clips
3. **Director → Media Library**: Generated assets saved to project media

#### Router/Navigation Changes

In QCut's creation section router, add:

```typescript
// Wherever creation routes are defined
{ path: 'director', component: DirectorLayout, children: [
  { path: 'script', component: ScriptPanel },
  { path: 'storyboard', component: DirectorPanel },
]}
```

---

## Phase 2: Characters + Scenes (Asset Library) — ~1-2 Weeks

### 2.1 Character Library (Week 4)

| Source (Moyin) | Target (QCut) | Priority | Notes |
|---|---|---|---|
| `src/stores/character-library-store.ts` | `apps/desktop/src/stores/director/character-library-store.ts` | P1 | Character CRUD, generation, folders |
| `src/lib/script/character-stage-analyzer.ts` | Already ported in 1.2 | — | — |
| `src/lib/script/ai-character-finder.ts` | Already ported in 1.2 | — | — |
| `src/components/panels/characters/` | Rewrite in QCut style | P1 | Three-column layout |

#### UI Components

```
director/characters/
├── CharacterLibrary.tsx       # Main container (three-column)
├── CharacterGenConsole.tsx    # Left: generation settings (prompt, style, poses)
├── CharacterGallery.tsx       # Center: grid of generated characters
├── CharacterDetail.tsx        # Right: selected character details, variants
└── CharacterFolderTree.tsx    # Folder organization
```

#### Key Feature: Consistency
Characters must look consistent across generations. This requires:
- Reference image support in the provider abstraction (IP-Adapter, face reference)
- Character description stored as structured data (not just prompt text)
- fal.ai supports reference images via `image_url` parameter in many models

### 2.2 Scene Library (Week 4-5)

| Source (Moyin) | Target (QCut) | Priority | Notes |
|---|---|---|---|
| `src/stores/scene-store.ts` | `apps/desktop/src/stores/director/scene-library-store.ts` | P1 | Scene/background CRUD, generation |
| `src/lib/script/ai-scene-finder.ts` | Already ported in 1.2 | — | — |
| `src/components/panels/scenes/` | Rewrite in QCut style | P1 | Same three-column layout |

#### UI Components

```
director/scenes/
├── SceneLibrary.tsx           # Main container (three-column)
├── SceneGenConsole.tsx        # Left: generation settings
├── SceneGallery.tsx           # Center: grid of scene backgrounds
└── SceneDetail.tsx            # Right: selected scene details
```

### 2.3 Cross-Module Integration (Week 5)

1. **Script ↔ Character Library**: When script parsing extracts characters, auto-create entries in Character Library. When generating storyboard, pull character reference images from library.

2. **Script ↔ Scene Library**: Same — extracted locations auto-link to Scene Library entries.

3. **Director → Characters/Scenes**: Storyboard prompt builder incorporates character descriptions and scene references for visual consistency.

4. **Shared Asset Storage**: Characters and scenes persist in QCut's project data. Optional: cross-project sharing via a global library (toggle in settings).

---

## Phase 3 (Future): SClass + Advanced Features

### 3.1 SClass / Multi-Shot Video Generation

| Source (Moyin) | Target (QCut) | Notes |
|---|---|---|
| `src/stores/sclass-store.ts` | Future | Depends on Seedance 2.0 / equivalent API |
| `src/components/panels/sclass/` | Future | — |

**Dependency**: Seedance 2.0 via RunningHub API. If fal.ai or Replicate offer equivalent multi-shot video models, adapt. Don't build until API is stable and accessible.

### 3.2 Trailer Auto-Generation
- Port `trailer-service.ts` — auto-selects key shots from script for trailer
- Requires video generation pipeline from Phase 1 to be mature

### 3.3 Advanced Cinematography Profiles
- Expand `director-presets.ts` with genre-specific profiles (horror, comedy, action, romance)
- Community-shared preset packs (future)

---

## Complete File-by-File Porting Guide

> **Note:** Actual target paths use `apps/web/src/lib/moyin/` instead of `packages/ai-director/src/`. The table below shows the actual implemented paths where applicable.

### Library Files (`src/lib/`)

| # | Source (Moyin) | Actual Target (QCut) | Phase | Priority | Status |
|---|---|---|---|---|---|
| 1 | `lib/ai/feature-router.ts` | Uses existing QCut AI pipeline | 1.1 | P0 | **Skipped** — not needed with current approach |
| 2 | `lib/ai/image-generator.ts` | Uses existing `aiPipeline` IPC | 1.1 | P0 | **Skipped** — covered by existing infra |
| 3 | `lib/ai/runninghub-client.ts` | — | 1.1 | P2 | Not started |
| 4 | `lib/ai/worker-bridge.ts` | — | 1.1 | P1 | Not started |
| 5 | `lib/script/script-parser.ts` | `apps/web/src/lib/moyin/script/script-parser.ts` | 1.2 | P0 | **Done** |
| 6 | `lib/script/full-script-service.ts` | — | 1.2 | P0 | **Deferred** — 2320-line orchestrator; individual modules ported |
| 7 | `lib/script/shot-generator.ts` | `apps/web/src/lib/moyin/script/shot-generator.ts` | 1.2 | P0 | **Done** |
| 8 | `lib/script/episode-parser.ts` | `apps/web/src/lib/moyin/script/episode-parser.ts` | 1.2 | P0 | **Done** |
| 9 | `lib/script/character-calibrator.ts` | `apps/web/src/lib/moyin/script/character-calibrator.ts` + `character-calibrator-enrichment.ts` | 1.2 | P1 | **Done** |
| 10 | `lib/script/scene-calibrator.ts` | `apps/web/src/lib/moyin/script/scene-calibrator.ts` | 1.2 | P1 | **Done** |
| 11 | `lib/script/ai-character-finder.ts` | `apps/web/src/lib/moyin/script/ai-character-finder.ts` | 1.2 | P1 | **Done** |
| 12 | `lib/script/ai-scene-finder.ts` | `apps/web/src/lib/moyin/script/ai-scene-finder.ts` | 1.2 | P1 | **Done** |
| 13 | `lib/script/character-stage-analyzer.ts` | `apps/web/src/lib/moyin/script/character-stage-analyzer.ts` | 2.1 | P2 | **Done** |
| 14 | `lib/script/trailer-service.ts` | `apps/web/src/lib/moyin/script/` | 3 | P3 | Not started |
| 15 | `lib/storyboard/storyboard-service.ts` | `apps/web/src/lib/moyin/storyboard/storyboard-service.ts` | 1.3 | P0 | **Done** |
| 16 | `lib/storyboard/prompt-builder.ts` | `apps/web/src/lib/moyin/storyboard/prompt-builder.ts` | 1.3 | P0 | **Done** |
| 17 | `lib/storyboard/scene-prompt-generator.ts` | `apps/web/src/lib/moyin/storyboard/scene-prompt-generator.ts` | 1.3 | P0 | **Done** |
| 18 | `lib/storyboard/image-splitter.ts` | `apps/web/src/lib/moyin/storyboard/image-splitter.ts` | 1.3 | P0 | **Done** |
| 19 | `lib/storyboard/grid-calculator.ts` | `apps/web/src/lib/moyin/storyboard/grid-calculator.ts` | 1.3 | P1 | **Done** |

### Additional Files Ported (not in original plan)

| # | Source (Moyin) | Actual Target (QCut) | Status |
|---|---|---|---|
| 20 | `lib/constants/cinematography-profiles.ts` | `apps/web/src/lib/moyin/presets/cinematography-profiles.ts` | **Done** |
| 21 | `lib/constants/visual-styles.ts` | `apps/web/src/lib/moyin/presets/visual-styles.ts` | **Done** |
| 22 | `packages/ai-core/services/character-bible.ts` | `apps/web/src/lib/moyin/character/character-bible.ts` | **Done** |
| 23 | `lib/character/character-prompt-service.ts` | `apps/web/src/lib/moyin/character/types.ts` | **Done** |
| 24 | `lib/api-key-manager.ts` | `apps/web/src/lib/moyin/utils/api-key-manager.ts` | **Done** |
| 25 | `lib/utils/retry.ts` | `apps/web/src/lib/moyin/utils/retry.ts` | **Done** |
| 26 | `lib/utils/rate-limiter.ts` | `apps/web/src/lib/moyin/utils/rate-limiter.ts` | **Done** |
| 27 | `lib/utils/concurrency.ts` | `apps/web/src/lib/moyin/utils/concurrency.ts` | **Done** |
| 28 | `types/script.ts` | `apps/web/src/types/moyin-script.ts` | **Done** |
| 29 | System prompts (inline in parser) | `apps/web/src/lib/moyin/script/system-prompts.ts` | **Done** |
| 30 | New: LLM adapter | `apps/web/src/lib/moyin/script/llm-adapter.ts` | **Done** |

### Store Files (`src/stores/`)

| # | Source (Moyin) | Actual Target (QCut) | Phase | Status | Notes |
|---|---|---|---|---|---|
| 1 | `stores/api-config-store.ts` | — | 1.1 | Not started | Uses existing QCut API key config |
| 2 | `stores/script-store.ts` | `apps/web/src/stores/moyin-store.ts` | 1.2 | **Done** (simplified) | Session-scoped, 4-step workflow |
| 3 | `stores/director-store.ts` | `apps/web/src/stores/director/` | 1.3 | Not started | Split: scene management |
| 4 | `stores/director-store.ts` | `apps/web/src/stores/director/` | 1.3 | Not started | Split: generation queue |
| 5 | `stores/director-store.ts` | `apps/web/src/stores/director/` | 1.3 | Not started | Split: UI state |
| 6 | `stores/director-presets.ts` | `apps/web/src/lib/moyin/presets/director-presets.ts` | 1.3 | **Done** | Pure data, no deps |
| 7 | `stores/character-library-store.ts` | `apps/web/src/stores/director/` | 2.1 | Not started | Character assets |
| 8 | `stores/scene-store.ts` | `apps/web/src/stores/director/` | 2.2 | Not started | Scene/background assets |
| 9 | `stores/sclass-store.ts` | Future | 3 | Not started | Seedance 2.0 dependent |

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **AI API costs** — image/video gen at scale | High | High | Add cost estimation UI, usage limits, confirmation dialogs before batch generation |
| **RunningHub dependency** — Moyin is tightly coupled | Medium | Medium | Provider abstraction (1.1) handles this; fal.ai as primary |
| **director-store.ts complexity** (1800+ lines) | Medium | Medium | Split into 4 stores during porting; don't port as-is |
| **UI component mismatch** (shadcn vs QCut) | Low | High | Rewrite UI from scratch using QCut components; only port logic |
| **Character consistency** across generations | High | High | Leverage reference image APIs (IP-Adapter); store character embeddings |
| **Prompt quality** — results depend on prompt engineering | Medium | Medium | Port Moyin's presets as-is (they're battle-tested); iterate |
| **Scope creep** into video editing features | Medium | Medium | Keep Director as asset producer; timeline integration is a thin bridge |

---

## Recommended Tech Choices

| Decision | Choice | Rationale |
|---|---|---|
| **Primary image gen** | fal.ai | API key already configured; good model selection (FLUX, SD3); simple API |
| **Secondary image gen** | Replicate | Broader model ecosystem; good fallback |
| **Optional image gen** | RunningHub / local ComfyUI | For power users with custom workflows |
| **Video gen** | fal.ai (Kling, minimax) or Replicate | Evaluate cost/quality when Phase 1 image gen is stable |
| **Text AI** | Existing `@opencut/ai-core` (Claude) | Script parsing, character extraction already uses Claude |
| **Store architecture** | Split director-store into 4 files | Maintainability; each store < 500 lines |
| **Package structure** | New `packages/ai-director/` | Clean separation; doesn't bloat `@opencut/ai-core` |
| **UI components** | QCut's existing set | Consistency; adopt shadcn/ui only where QCut lacks equivalents |
| **State persistence** | Zustand + persist (same as QCut) | Zero friction; same middleware pattern |

---

## Timeline Summary

| Phase | Duration | Deliverable |
|---|---|---|
| **1.1** AI Provider Layer | 3 days | Provider abstraction, fal.ai integration, config store |
| **1.2** Script Module | 4 days | Script parser, store, basic UI |
| **1.3** Director Module | 6 days | Storyboard pipeline, scene cards, image generation |
| **1.4** Navigation | 2 days | Director tab in Creation, routing, timeline bridge |
| **2.1** Character Library | 4 days | Character generation, gallery, cross-module linking |
| **2.2** Scene Library | 3 days | Scene generation, gallery |
| **2.3** Cross-module Integration | 3 days | Auto-linking, consistency features |
| **Phase 3** | TBD | SClass, trailers, advanced presets |

**Total Phase 1+2: ~5 weeks** (single developer, focused)

---

## Getting Started Checklist

1. [x] ~~Create `packages/ai-director/`~~ → Implemented in `apps/web/src/lib/moyin/` instead
2. [ ] Define `ImageGenProvider` and `VideoGenProvider` interfaces (skipped — using existing AI pipeline)
3. [ ] Implement fal.ai provider with basic image generation (skipped — using existing AI pipeline)
4. [x] Port `script-parser.ts` → `apps/web/src/lib/moyin/script/script-parser.ts`
5. [x] Create minimal Script UI → `apps/web/src/components/editor/media-panel/views/moyin/script-input.tsx`
6. [x] Port `prompt-builder.ts` → `apps/web/src/lib/moyin/storyboard/prompt-builder.ts`
7. [x] Create minimal Director UI → `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx`
8. [ ] End-to-end test: paste script → see generated storyboard images (IPC wired, needs Electron runtime test)
9. [ ] Iterate on UI, add presets, refine prompts
10. [ ] Phase 2: Character and Scene libraries

### Additional completed items (beyond original checklist)

11. [x] Port grid calculator → `apps/web/src/lib/moyin/storyboard/grid-calculator.ts`
12. [x] Port image splitter → `apps/web/src/lib/moyin/storyboard/image-splitter.ts`
13. [x] Port character bible (6-layer identity) → `apps/web/src/lib/moyin/character/character-bible.ts`
14. [x] Port cinematography profiles → `apps/web/src/lib/moyin/presets/cinematography-profiles.ts`
15. [x] Port visual styles → `apps/web/src/lib/moyin/presets/visual-styles.ts`
16. [x] Port director presets → `apps/web/src/lib/moyin/presets/director-presets.ts`
17. [x] Port utility modules (retry, rate-limiter, concurrency, API key manager) → `apps/web/src/lib/moyin/utils/`
18. [x] Create IPC handler for LLM-based script parsing → `electron/moyin-handler.ts`
19. [x] Register Moyin tab in media panel (store, preload, main.ts, electron.d.ts)
20. [x] Write 344 unit tests across 6 test files
21. [x] Port shot-generator.ts → `apps/web/src/lib/moyin/script/shot-generator.ts`
22. [x] Port episode-parser.ts → `apps/web/src/lib/moyin/script/episode-parser.ts`
23. [x] Port scene-prompt-generator.ts → `apps/web/src/lib/moyin/storyboard/scene-prompt-generator.ts`
24. [x] Port storyboard-service.ts → `apps/web/src/lib/moyin/storyboard/storyboard-service.ts`
25. [x] Port ai-character-finder.ts → `apps/web/src/lib/moyin/script/ai-character-finder.ts`
26. [x] Port ai-scene-finder.ts → `apps/web/src/lib/moyin/script/ai-scene-finder.ts`
27. [x] Port character-calibrator.ts → split into `character-calibrator.ts` + `character-calibrator-enrichment.ts`
28. [x] Port scene-calibrator.ts → `apps/web/src/lib/moyin/script/scene-calibrator.ts`
29. [x] Port character-stage-analyzer.ts → `apps/web/src/lib/moyin/script/character-stage-analyzer.ts`
30. [x] Create LLM adapter → `apps/web/src/lib/moyin/script/llm-adapter.ts`
31. [x] Update barrel exports (`script/index.ts`, `storyboard/index.ts`)
32. [x] Pass TypeScript type-check and Biome lint
