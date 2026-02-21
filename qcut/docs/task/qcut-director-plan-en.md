# QCut AI Director Integration Plan

> Porting Moyin Creator's AI Director capabilities into QCut's Creation section

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

### 1.1 AI Provider Abstraction Layer (Week 1, Days 1-3)

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

### 1.2 Script Module (Week 1, Days 3-5 + Week 2, Days 1-2)

#### What to Port

The script module converts raw text/outline into a structured hierarchy: **Episode → Scene → Shot**, with auto-extracted characters and scene descriptions.

**Library files** — port all 14 files from `src/lib/script/`:

| Source (Moyin) | Target (QCut) | Priority | Notes |
|---|---|---|---|
| `src/lib/script/script-parser.ts` | `packages/ai-director/src/script/script-parser.ts` | P0 | Core parser — text → structured script |
| `src/lib/script/full-script-service.ts` | `packages/ai-director/src/script/full-script-service.ts` | P0 | Orchestrates full script processing |
| `src/lib/script/shot-generator.ts` | `packages/ai-director/src/script/shot-generator.ts` | P0 | Generates shot list from scenes |
| `src/lib/script/episode-parser.ts` | `packages/ai-director/src/script/episode-parser.ts` | P0 | Splits script into episodes |
| `src/lib/script/character-calibrator.ts` | `packages/ai-director/src/script/character-calibrator.ts` | P1 | Auto-extracts character info |
| `src/lib/script/scene-calibrator.ts` | `packages/ai-director/src/script/scene-calibrator.ts` | P1 | Auto-extracts scene/location info |
| `src/lib/script/ai-character-finder.ts` | `packages/ai-director/src/script/ai-character-finder.ts` | P1 | AI-powered character detection |
| `src/lib/script/ai-scene-finder.ts` | `packages/ai-director/src/script/ai-scene-finder.ts` | P1 | AI-powered scene detection |
| `src/lib/script/character-stage-analyzer.ts` | `packages/ai-director/src/script/character-stage-analyzer.ts` | P2 | Character pose/expression analysis |
| `src/lib/script/trailer-service.ts` | `packages/ai-director/src/script/trailer-service.ts` | P3 | Trailer generation (Phase 3) |
| Remaining 4 files | Assess during porting | P2 | Port as needed |

**Store:**

| Source (Moyin) | Target (QCut) | Notes |
|---|---|---|
| `src/stores/script-store.ts` | `apps/desktop/src/stores/director/script-store.ts` | Zustand + persist, same pattern as QCut |

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

Create in `apps/desktop/src/components/director/script/`:

```
script/
├── ScriptPanel.tsx          # Main container
├── ScriptInput.tsx          # Text area for raw script input
├── ScriptTreeView.tsx       # Episode → Scene → Shot hierarchy (left sidebar)
├── ShotPropertyPanel.tsx    # Edit shot details (right panel)
├── ScriptToolbar.tsx        # Parse button, script type selector
└── CharacterScenePreview.tsx # Preview extracted characters/scenes
```

Layout: **Two-column** — Script input / tree view on left, property panel on right. Simple, functional.

---

### 1.3 Director Module (Week 2, Days 2-5 + Week 3)

This is the core feature. Script output feeds in; storyboard images and videos come out.

#### Store Refactoring

The `director-store.ts` (1800+ lines) must be split:

| Source (Moyin) | Target (QCut) | Notes |
|---|---|---|
| `src/stores/director-store.ts` (state types) | `apps/desktop/src/stores/director/director-state.ts` | Type definitions only (~200 lines) |
| `src/stores/director-store.ts` (scene management) | `apps/desktop/src/stores/director/director-scenes-store.ts` | Scene CRUD, split, merge (~400 lines) |
| `src/stores/director-store.ts` (generation logic) | `apps/desktop/src/stores/director/director-gen-store.ts` | Image/video generation queue (~500 lines) |
| `src/stores/director-store.ts` (UI state) | `apps/desktop/src/stores/director/director-ui-store.ts` | Selection, view mode, panels (~300 lines) |
| `src/stores/director-presets.ts` | `packages/ai-director/src/presets/director-presets.ts` | Shot sizes, camera rigs, lighting, emotions — pure data, no UI dependency |

#### Library Files

| Source (Moyin) | Target (QCut) | Priority | Notes |
|---|---|---|---|
| `src/lib/storyboard/storyboard-service.ts` | `packages/ai-director/src/storyboard/storyboard-service.ts` | P0 | Core: text → storyboard image |
| `src/lib/storyboard/prompt-builder.ts` | `packages/ai-director/src/storyboard/prompt-builder.ts` | P0 | Builds generation prompts from scene data |
| `src/lib/storyboard/scene-prompt-generator.ts` | `packages/ai-director/src/storyboard/scene-prompt-generator.ts` | P0 | Per-scene prompt construction |
| `src/lib/storyboard/image-splitter.ts` | `packages/ai-director/src/storyboard/image-splitter.ts` | P0 | Splits storyboard grid into individual shots |
| `src/lib/storyboard/grid-calculator.ts` | `packages/ai-director/src/storyboard/grid-calculator.ts` | P1 | Calculates grid layout for storyboard |
| `src/lib/ai/image-generator.ts` | Already in 1.1 provider layer | P0 | — |

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

#### UI Components

Create in `apps/desktop/src/components/director/`:

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

### 1.4 Navigation Integration (Week 3, Days 3-5)

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

### Library Files (`src/lib/`)

| # | Source (Moyin) | Target (QCut) | Phase | Priority | Notes |
|---|---|---|---|---|---|
| 1 | `lib/ai/feature-router.ts` | `packages/ai-director/src/feature-router.ts` | 1.1 | P0 | Simplify, remove RunningHub-specific |
| 2 | `lib/ai/image-generator.ts` | `packages/ai-director/src/providers/types.ts` | 1.1 | P0 | Extract interface |
| 3 | `lib/ai/runninghub-client.ts` | `packages/ai-director/src/providers/runninghub-provider.ts` | 1.1 | P2 | Optional provider |
| 4 | `lib/ai/worker-bridge.ts` | `packages/ai-director/src/worker-bridge.ts` | 1.1 | P1 | Web Worker for heavy ops |
| 5 | `lib/script/script-parser.ts` | `packages/ai-director/src/script/script-parser.ts` | 1.2 | P0 | Core parser |
| 6 | `lib/script/full-script-service.ts` | `packages/ai-director/src/script/full-script-service.ts` | 1.2 | P0 | Orchestrator |
| 7 | `lib/script/shot-generator.ts` | `packages/ai-director/src/script/shot-generator.ts` | 1.2 | P0 | Scene → shots |
| 8 | `lib/script/episode-parser.ts` | `packages/ai-director/src/script/episode-parser.ts` | 1.2 | P0 | Script → episodes |
| 9 | `lib/script/character-calibrator.ts` | `packages/ai-director/src/script/character-calibrator.ts` | 1.2 | P1 | Character extraction |
| 10 | `lib/script/scene-calibrator.ts` | `packages/ai-director/src/script/scene-calibrator.ts` | 1.2 | P1 | Scene extraction |
| 11 | `lib/script/ai-character-finder.ts` | `packages/ai-director/src/script/ai-character-finder.ts` | 1.2 | P1 | AI character detection |
| 12 | `lib/script/ai-scene-finder.ts` | `packages/ai-director/src/script/ai-scene-finder.ts` | 1.2 | P1 | AI scene detection |
| 13 | `lib/script/character-stage-analyzer.ts` | `packages/ai-director/src/script/character-stage-analyzer.ts` | 2.1 | P2 | Pose/expression analysis |
| 14 | `lib/script/trailer-service.ts` | `packages/ai-director/src/script/trailer-service.ts` | 3 | P3 | Future |
| 15 | `lib/storyboard/storyboard-service.ts` | `packages/ai-director/src/storyboard/storyboard-service.ts` | 1.3 | P0 | Core storyboard |
| 16 | `lib/storyboard/prompt-builder.ts` | `packages/ai-director/src/storyboard/prompt-builder.ts` | 1.3 | P0 | Prompt construction |
| 17 | `lib/storyboard/scene-prompt-generator.ts` | `packages/ai-director/src/storyboard/scene-prompt-generator.ts` | 1.3 | P0 | Per-scene prompts |
| 18 | `lib/storyboard/image-splitter.ts` | `packages/ai-director/src/storyboard/image-splitter.ts` | 1.3 | P0 | Grid → individual images |
| 19 | `lib/storyboard/grid-calculator.ts` | `packages/ai-director/src/storyboard/grid-calculator.ts` | 1.3 | P1 | Layout math |

### Store Files (`src/stores/`)

| # | Source (Moyin) | Target (QCut) | Phase | Notes |
|---|---|---|---|---|
| 1 | `stores/api-config-store.ts` | `stores/ai-provider-config-store.ts` | 1.1 | Multi-provider key management |
| 2 | `stores/script-store.ts` | `stores/director/script-store.ts` | 1.2 | Script state |
| 3 | `stores/director-store.ts` | `stores/director/director-scenes-store.ts` | 1.3 | Split: scene management |
| 4 | `stores/director-store.ts` | `stores/director/director-gen-store.ts` | 1.3 | Split: generation queue |
| 5 | `stores/director-store.ts` | `stores/director/director-ui-store.ts` | 1.3 | Split: UI state |
| 6 | `stores/director-presets.ts` | `packages/ai-director/src/presets/director-presets.ts` | 1.3 | Pure data, no deps |
| 7 | `stores/character-library-store.ts` | `stores/director/character-library-store.ts` | 2.1 | Character assets |
| 8 | `stores/scene-store.ts` | `stores/director/scene-library-store.ts` | 2.2 | Scene/background assets |
| 9 | `stores/sclass-store.ts` | Future | 3 | Seedance 2.0 dependent |

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

1. [ ] Create `packages/ai-director/` with package.json, tsconfig
2. [ ] Define `ImageGenProvider` and `VideoGenProvider` interfaces
3. [ ] Implement fal.ai provider with basic image generation
4. [ ] Port `script-parser.ts` and `full-script-service.ts`
5. [ ] Create minimal Script UI (text input → parsed tree)
6. [ ] Port `storyboard-service.ts` and `prompt-builder.ts`
7. [ ] Create minimal Director UI (scene cards → generate button)
8. [ ] End-to-end test: paste script → see generated storyboard images
9. [ ] Iterate on UI, add presets, refine prompts
10. [ ] Phase 2: Character and Scene libraries
