# Moyin Creator Integration Plan

> **Date:** 2026-02-22
> **Feature:** Integrate Moyin Creator (魔因漫创) capabilities into QCut
> **Source repo:** `/Users/peter/Desktop/code/moyin/moyin-creator`
> **Scope:** Identify reusable modules, integration strategy, and implementation phases

---

## Summary

Moyin Creator is a standalone Electron + React desktop app for AI-driven manga/short-video creation. It provides an end-to-end pipeline: **Script → Characters → Scenes → Storyboard → Video**. This document maps how its capabilities can be absorbed into QCut's existing architecture.

---

## What Moyin Creator Does

### Five-Panel Pipeline

| Panel | Purpose | Key Output |
|-------|---------|------------|
| **Script** | Parse raw screenplay text into structured scenes/characters/dialogue | `AIScreenplay` object |
| **Characters** | Generate consistent character portraits with 6-layer identity anchors | Character reference images |
| **Scenes** | Generate environment/background reference images | Scene reference images |
| **Director** | Frame-by-frame storyboard with cinematic parameters (shot size, camera angle, lighting) | Contact sheets, first/end frames |
| **S-Class** | Seedance 2.0 multi-modal narrative video generation (images + video + audio → video) | Final video clips |

### Tech Stack Overlap

| Area | Moyin Creator | QCut | Compatible? |
|------|---------------|------|-------------|
| Framework | React 18 + TypeScript | React + TypeScript | Yes |
| Build | electron-vite 5 | Vite + Electron | Yes |
| State | Zustand 5 + persist | Zustand + persist | Yes |
| UI | Radix UI + Tailwind CSS 4 | Radix UI + Tailwind CSS | Yes |
| Panels | react-resizable-panels 2 | react-resizable-panels 4 | Close (v2 vs v4) |
| Desktop | Electron 30 | Electron | Yes |
| Storage | IndexedDB + OPFS + file system | IndexedDB + localStorage + IPC | Yes |

---

## Integration Strategy

### Approach: Feature Absorption (not embedding)

Rather than running Moyin Creator as a subprocess or iframe, extract its valuable modules and integrate them natively into QCut's existing patterns. This avoids dependency conflicts, maintains a single Electron process, and gives users a unified experience.

### What to Integrate (Priority Order)

#### P1 — High Value, Low Friction

| Feature | Source Files | QCut Target | Effort |
|---------|-------------|-------------|--------|
| Script Parser | `src/lib/script/script-parser.ts` | New media panel tab | Medium |
| Character Consistency (6-layer anchors) | `src/lib/character/character-prompt-service.ts`, `src/packages/ai-core/services/character-bible.ts` | Extend AI generation | Medium |
| Cinematography Presets | `src/stores/director-presets.ts`, `src/lib/constants/cinematography-profiles.ts` | Extend AI video prompts | Low |
| Prompt Compiler | `src/packages/ai-core/services/prompt-compiler.ts` | Improve AI prompt building | Low |
| API Key Rotation | `src/lib/api-key-manager.ts` | Extend API config | Low |

#### P2 — High Value, Medium Friction

| Feature | Source Files | QCut Target | Effort |
|---------|-------------|-------------|--------|
| Storyboard Grid Generator | `src/lib/storyboard/` (5 files) | New media panel view | High |
| Director Panel (frame-by-frame control) | `src/stores/director-store.ts`, `src/components/panels/director/` | New editor workflow | High |
| Scene Generation | `src/stores/scene-store.ts`, `src/components/panels/scenes/` | Extend AI image tab | Medium |

#### P3 — Nice to Have, High Friction

| Feature | Source Files | QCut Target | Effort |
|---------|-------------|-------------|--------|
| S-Class (Seedance 2.0 multi-modal) | `src/stores/sclass-store.ts`, `src/components/panels/sclass/` | New generation mode | Very High |
| Full Script-to-Video Pipeline | All five panels connected | Orchestration layer | Very High |
| Project Import/Export | `electron/main.ts` (storage handlers) | Cross-app projects | Medium |

---

## Architecture Mapping

### Where Features Fit in QCut

```
QCut Editor
├── Media Panel Tabs (17 existing + 1 new)
│   ├── Group: "ai-create"
│   │   ├── ai             → add character consistency, cinematography presets
│   │   ├── text2image     → unchanged
│   │   ├── sounds         → unchanged (WIP)
│   │   └── moyin (NEW)    → script parser + storyboard + director workflow
│   ├── Group: "edit"
│   │   ├── Subgroup "ai-edit": word-timeline, upscale, video-edit, segmentation
│   │   └── Subgroup "manual-edit": text, stickers, effects, filters, transitions
│   ├── Group: "media"
│   │   ├── media          → unchanged
│   │   └── project-folder → unchanged
│   └── Group: "agents"
│       ├── nano-edit      → unchanged (Skills)
│       ├── pty            → unchanged (Terminal)
│       └── remotion       → unchanged
│
├── Stores (existing)
│   ├── timeline-store → unchanged (storyboard outputs feed into this)
│   ├── media-store    → unchanged (generated assets go here)
│   └── moyin-store (NEW) → script, characters, scenes, director state
│
├── Electron IPC (existing)
│   ├── ai-pipeline-handler → extend with moyin generation commands
│   └── moyin-handler (NEW) → character/scene/storyboard IPC
│
└── Lib (existing)
    ├── ai-video/      → integrate prompt compiler + character bible
    └── moyin/ (NEW)   → script parser, storyboard service, presets
```

### Data Flow

```
User Script Input
  → Script Parser (moyin) → AIScreenplay
  → Character Extractor → Character Bible (6-layer anchors)
  → Scene Extractor → Scene Descriptions
  → Prompt Compiler (moyin) → Enhanced AI Prompts
  → AI Pipeline (QCut existing) → Generated Images/Videos
  → Media Store (QCut existing) → Timeline
```

---

## Implementation Plan

### Phase 1: Portable Libraries (no UI changes)

Extract pure-logic modules that enhance QCut's existing AI generation without any new UI.

**Files to copy/adapt:**

| Source (moyin-creator) | Target (QCut) | Purpose |
|------------------------|----------------|---------|
| `src/lib/script/script-parser.ts` | `apps/web/src/lib/moyin/script-parser.ts` | Parse screenplay text |
| `src/lib/script/ai-scene-finder.ts` | `apps/web/src/lib/moyin/ai-scene-finder.ts` | LLM scene extraction |
| `src/lib/script/ai-character-finder.ts` | `apps/web/src/lib/moyin/ai-character-finder.ts` | Character detection |
| `src/packages/ai-core/services/prompt-compiler.ts` | `apps/web/src/lib/moyin/prompt-compiler.ts` | Multi-layer prompt building |
| `src/packages/ai-core/services/character-bible.ts` | `apps/web/src/lib/moyin/character-bible.ts` | Character consistency |
| `src/lib/character/character-prompt-service.ts` | `apps/web/src/lib/moyin/character-prompt-service.ts` | 6-layer identity anchors |
| `src/lib/constants/cinematography-profiles.ts` | `apps/web/src/lib/moyin/cinematography-profiles.ts` | Shot size, angle, lighting presets |
| `src/lib/constants/visual-styles.ts` | `apps/web/src/lib/moyin/visual-styles.ts` | Art style definitions |
| `src/stores/director-presets.ts` | `apps/web/src/lib/moyin/director-presets.ts` | Cinematic preset data |
| `src/lib/api-key-manager.ts` | `apps/web/src/lib/moyin/api-key-manager.ts` | Key rotation logic |
| `src/lib/utils/retry.ts` | `apps/web/src/lib/moyin/utils/retry.ts` | Exponential backoff |
| `src/lib/utils/rate-limiter.ts` | `apps/web/src/lib/moyin/utils/rate-limiter.ts` | Token bucket |
| `src/lib/utils/concurrency.ts` | `apps/web/src/lib/moyin/utils/concurrency.ts` | Parallel execution control |
| `src/types/script.ts` | `apps/web/src/types/moyin-script.ts` | Core data types |

**Adaptation needed:**
- Remove moyin-specific imports (replace with QCut equivalents)
- Align API call patterns with QCut's `ai-pipeline-handler`
- Use QCut's storage service instead of moyin's `project-storage`

### Phase 2: Moyin Tab in Media Panel

Add a new `"moyin"` tab to QCut's media panel with script-to-storyboard workflow.

**New files:**

| File | Purpose |
|------|---------|
| `apps/web/src/stores/moyin-store.ts` | Zustand store for script, characters, scenes, director state |
| `apps/web/src/components/editor/media-panel/views/moyin/index.tsx` | Tab root component |
| `apps/web/src/components/editor/media-panel/views/moyin/script-input.tsx` | Script text input + parse button |
| `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx` | Extracted characters display |
| `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx` | Scene breakdown display |
| `apps/web/src/components/editor/media-panel/views/moyin/storyboard-grid.tsx` | N×N contact sheet preview |
| `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx` | Batch generation controls |

**Modifications:**

| File | Change |
|------|--------|
| `apps/web/src/components/editor/media-panel/store.ts` | Add `"moyin"` to `Tab` union type (line 25), add entry to `tabs` object (line 44), add `"moyin"` to `tabGroups["ai-create"].tabs` array (line 149) |
| `apps/web/src/components/editor/media-panel/index.tsx` | Import `MoyinView`, add `moyin: <MoyinView />` to `viewMap` (type: `Record<Exclude<Tab, "pty">, React.ReactNode>`) |

### Phase 3: Enhanced AI Prompts

Wire the prompt compiler and character bible into QCut's existing AI Video generation tab.

**Modifications:**

| File | Change |
|------|--------|
| `apps/web/src/components/editor/media-panel/views/ai/index.tsx` | Add "Use Character Bible" toggle to generation UI |
| `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-text-tab.tsx` | Integrate cinematography preset selector |
| `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts` | Pass compiled prompts through prompt-compiler before API call |

### Phase 4: Director Workflow (Future)

Full frame-by-frame direction panel with cinematic controls. This is the most complex integration and should be deferred until Phases 1-3 are validated.

---

## Key Data Models from Moyin Creator

### AIScreenplay

```typescript
interface AIScreenplay {
  id: string
  title: string
  aspectRatio: "16:9" | "9:16"
  characters: AICharacter[]
  scenes: AIScene[]
}
```

### Character (6-Layer Identity Anchors)

```typescript
interface CharacterIdentity {
  boneStructure: string    // Face shape, jawline, cheekbones
  facialFeatures: string   // Eye shape, nose, lips
  identifyingMarks: string // Birthmarks, scars (strongest anchor)
  colorAnchors: {          // Hex values for consistency
    iris: string
    hair: string
    skin: string
    lips: string
  }
  skinTexture: string      // Pores, smile lines, wrinkles
  hairDetails: string      // Style, hairline, length
}
```

### SplitScene (Director)

```typescript
interface SplitScene {
  id: number
  sceneName: string
  sceneLocation: string
  imagePrompt: string
  endFramePrompt: string
  videoPrompt: string
  shotSize: "ECU" | "CU" | "MCU" | "MS" | "MLS" | "FS" | "WS" | "EWS"
  cameraAngle: "eye" | "low" | "high" | "bird" | "worm" | "dutch" | "over-shoulder"
  lightingStyle: string
  imageUrl?: string
  videoUrl?: string
  status: "idle" | "generating" | "done" | "error"
}
```

---

## API Providers in Moyin Creator

| Provider | Models | Services | Reusable in QCut? |
|----------|--------|----------|-------------------|
| **MemeFast** (魔因API) | deepseek-v3.2, glm-4.7, gemini-3-pro, gpt-image-1.5, seedance-1.5, wan2.6, sora-2, veo3.1 | chat, image, video, vision | Yes — add as provider in QCut's AI pipeline |
| **RunningHub** | Custom workflows | image, vision, multi-angle | Partial — needs custom client |
| **OpenAI** | GPT-4o etc. | chat, vision | Already in QCut |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Moyin's `director-store.ts` is 1900+ lines | Hard to maintain | Split into sub-stores when porting |
| Moyin uses react-resizable-panels v2, QCut uses v4 | API differences | Use QCut's v4 patterns, don't port panel code |
| Moyin stores per-project data differently | Storage conflicts | Adapt to QCut's `storageService` |
| MemeFast API may need separate keys | Config complexity | Add MemeFast to QCut's existing API config UI |
| License: AGPL-3.0 | Copyleft concerns | Both repos are same-owner — no issue |

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Running Moyin Creator as a subprocess | Adds process management complexity, prefer native integration |
| Porting Moyin's Electron IPC verbatim | QCut has its own IPC patterns, adapt instead |
| Moyin's theme system | QCut already has theming |
| Moyin's project management UI (Dashboard) | QCut has its own project management |
| Demo data seeding | Not relevant to QCut |
| Windows-only packaging (NSIS) | QCut handles its own packaging |

---

## Summary Decision Matrix

| Integration Approach | Pros | Cons | Recommendation |
|---------------------|------|------|----------------|
| **A. Feature Absorption** (extract modules) | Clean, unified UX, no dep conflicts | More initial work | **Recommended** |
| B. Iframe/WebView embed | Fast to prototype | Two Electron renderers, UX mismatch | Not recommended |
| C. Shared npm package | Clean separation | Moyin not structured as a library | Future option after refactor |
| D. Git submodule | Easy to pull updates | Build complexity, version drift | Not recommended |
