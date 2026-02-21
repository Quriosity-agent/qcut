# Moyin Integration: S-Class Seedance 2.0 Multi-Modal Generation

> **Date:** 2026-02-22
> **Feature:** Port Moyin's S-Class panel for Seedance 2.0 multi-modal narrative video generation
> **Phase:** 3 (Future)
> **Priority:** P3
> **Est. total effort:** ~4 hours (5 subtasks)
> **Depends on:** [moyin-05-moyin-panel-tab.md](moyin-05-moyin-panel-tab.md), [moyin-06-storyboard-generator.md](moyin-06-storyboard-generator.md)
> **Parent:** [moyin-creator-integration-plan.md](moyin-creator-integration-plan.md)

---

## Summary

Port Moyin's S-Class panel — the most advanced generation mode — that uses Seedance 2.0's multi-modal input capabilities. Unlike standard text-to-video, Seedance 2.0 accepts combined inputs: up to 9 images + 3 videos + 3 audio clips in a single prompt, producing cohesive narrative video output.

This is the most complex integration task and should only be attempted after Phases 1-2 are validated.

---

## Architecture Decision

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI location | Sub-tab within existing AI Video tab, or dedicated sub-view in Moyin tab | Seedance 2.0 is a specific model; could fit either pattern |
| Asset management | Reference QCut's `media-store` items | Assets are already in the editor |
| Prompt format | Seedance-specific `@Image`, `@Video`, `@Audio` tags | Required by Seedance 2.0 API spec |
| Generation | New pipeline command via `ai-pipeline-handler` | Needs custom multi-modal request building |

---

## Seedance 2.0 Constraints

| Parameter | Limit |
|-----------|-------|
| Images | max 9 |
| Videos | max 3 |
| Audio | max 3 |
| Prompt length | max 5000 characters |
| Duration | 4-15 seconds |
| Resolution | 480p, 720p, 1080p |
| Aspect ratios | 16:9, 9:16, 4:3, 3:4, 21:9, 1:1 |

---

## Implementation Status

| Subtask | Status | Est. |
|---------|--------|------|
| 1. Port asset reference types and validation | Pending | 30 min |
| 2. Build multi-modal prompt composer | Pending | 45 min |
| 3. Add Seedance 2.0 generation handler | Pending | 45 min |
| 4. Build S-Class UI component | Pending | 60 min |
| 5. Add unit tests | Pending | 30 min |

---

## Subtask 1: Port Asset Reference Types and Validation

**Priority:** P1
**Est. time:** 30 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/stores/sclass-store.ts` (type definitions)

### Target files
- `apps/web/src/lib/moyin/sclass/types.ts` (NEW)
- `apps/web/src/lib/moyin/sclass/validation.ts` (NEW)
- `apps/web/src/lib/moyin/sclass/index.ts` (NEW — barrel export)

### Key types to port

```typescript
type AssetType = "image" | "video" | "audio"

type AssetPurpose =
  | "character_ref"     // Character reference image
  | "scene_ref"         // Scene reference image
  | "first_frame"       // First frame of video
  | "grid_image"        // Storyboard grid
  | "camera_replicate"  // Camera movement reference
  | "action_replicate"  // Action reference
  | "beat_sync"         // Audio beat sync
  | "bgm"               // Background music
  | "voice_ref"         // Voice reference
  | "prev_video"        // Previous segment (for continuation)
  | "video_extend"      // Video extension source
  | "general"           // General reference

interface AssetRef {
  id: string
  type: AssetType
  tag: string          // @Image1, @Video1, @Audio1, etc.
  localUrl: string
  httpUrl: string | null
  fileName: string
  fileSize: number
  duration: number | null
  purpose?: AssetPurpose
}

type SClassAspectRatio = "16:9" | "9:16" | "4:3" | "3:4" | "21:9" | "1:1"
type SClassResolution = "480p" | "720p" | "1080p"
type SClassDuration = 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15
```

### Validation functions

```typescript
interface ValidationResult {
  valid: boolean
  errors: string[]
}

validateAssetCounts(assets: AssetRef[]): ValidationResult
// max 9 images, 3 videos, 3 audio

validatePromptLength(prompt: string): ValidationResult
// max 5000 characters

validateDuration(duration: number): ValidationResult
// 4-15 seconds

validateSClassRequest(request: SClassRequest): ValidationResult
// combined validation
```

---

## Subtask 2: Build Multi-Modal Prompt Composer

**Priority:** P1
**Est. time:** 45 min

### Target files
- `apps/web/src/lib/moyin/sclass/prompt-composer.ts` (NEW)

### Key exports

```typescript
interface SClassPromptConfig {
  narrative: string                    // Main story/action description
  assets: AssetRef[]                   // Referenced media assets
  characterDescriptions?: string[]     // Character consistency prompts
  cinematographyGuidance?: string      // Camera/lighting guidance
  duration: SClassDuration
  aspectRatio: SClassAspectRatio
  resolution: SClassResolution
}

// Compose prompt with @Image/@Video/@Audio tags
composeSClassPrompt(config: SClassPromptConfig): string

// Auto-generate asset tags from asset list
assignAssetTags(assets: AssetRef[]): AssetRef[]
// Images: @Image1, @Image2, ...
// Videos: @Video1, @Video2, ...
// Audio: @Audio1, @Audio2, ...

// Build the final API request body
buildSClassRequest(config: SClassPromptConfig): SClassAPIRequest
```

### Prompt format example
```
@Image1 is the main character, a young woman with red hair.
@Image2 is the background, a cyberpunk city at night.
@Video1 shows the camera movement reference.
@Audio1 is the background music.

The character walks through the neon-lit streets, looking up at holographic advertisements.
Camera follows from behind in a tracking shot, slowly rising to reveal the cityscape.
```

---

## Subtask 3: Add Seedance 2.0 Generation Handler

**Priority:** P1
**Est. time:** 45 min

### Files to modify
- `electron/ai-pipeline-handler.ts` (MODIFY — add `"seedance-sclass"` command)
- `apps/web/src/types/electron.d.ts` (MODIFY — add command type)

### Or alternatively

- `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers/` — add `sclass-handlers.ts` (NEW)
- `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts` (MODIFY — add routing)

### Handler responsibilities

1. Upload local assets to temporary HTTP URLs (required by Seedance API)
2. Build multi-modal request with `@Tag` references
3. Submit to Seedance 2.0 API endpoint
4. Poll for completion (async task)
5. Download result video
6. Add to media store

### Integration with existing patterns

QCut already has `ai-seedance-settings.tsx` component at:
- `apps/web/src/components/editor/media-panel/views/ai/components/ai-seedance-settings.tsx`

And Seedance handlers in:
- `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/handlers/image-to-video-handlers.ts` (handles Seedance I2V)

The S-Class handler extends this with multi-modal asset support.

---

## Subtask 4: Build S-Class UI Component

**Priority:** P2
**Est. time:** 60 min

### Target files
- `apps/web/src/components/editor/media-panel/views/moyin/sclass-composer.tsx` (NEW)

### Component structure

```
SClassComposer
├── Asset slots panel
│   ├── Image slots (up to 9, drag-from-media-store)
│   ├── Video slots (up to 3)
│   └── Audio slots (up to 3)
├── Narrative prompt textarea
│   ├── Auto-inserts @Tags when assets are added
│   ├── Character count indicator (max 5000)
│   └── Character bible integration (optional toggle)
├── Settings bar
│   ├── Duration selector (4-15s)
│   ├── Aspect ratio selector
│   └── Resolution selector
├── Validation messages (real-time)
└── Generate button
```

### Interaction pattern
1. User drags media items from QCut's media panel into asset slots
2. Each slot auto-assigns a tag (@Image1, @Video1, etc.)
3. Tags are auto-inserted into the prompt textarea
4. User writes narrative around the tags
5. Real-time validation shows constraint violations
6. "Generate" submits via S-Class handler

---

## Subtask 5: Unit Tests

**Priority:** P2
**Est. time:** 30 min

### Target files
- `apps/web/src/lib/moyin/sclass/__tests__/validation.test.ts` (NEW)
- `apps/web/src/lib/moyin/sclass/__tests__/prompt-composer.test.ts` (NEW)

### Test coverage

**validation.test.ts:**
- `validateAssetCounts()` — passes with 9 images, 3 videos, 3 audio
- `validateAssetCounts()` — fails with 10 images
- `validateAssetCounts()` — fails with 4 videos
- `validatePromptLength()` — passes at 5000 chars
- `validatePromptLength()` — fails at 5001 chars
- `validateDuration(4)` — passes
- `validateDuration(3)` — fails
- `validateDuration(16)` — fails
- `validateSClassRequest()` — combined validation

**prompt-composer.test.ts:**
- `assignAssetTags()` — assigns sequential @Image tags
- `assignAssetTags()` — assigns @Video and @Audio tags independently
- `composeSClassPrompt()` — includes all @Tags in output
- `composeSClassPrompt()` — includes narrative text
- `composeSClassPrompt()` — stays under 5000 char limit
- `composeSClassPrompt()` — includes character descriptions when provided

---

## Risk Notes

| Risk | Mitigation |
|------|------------|
| Seedance 2.0 API may change | Abstract behind `SClassAPIRequest` interface; only update handler |
| Asset upload latency | Show per-asset upload progress; allow pre-uploading |
| Large files (video/audio) | Validate file sizes before upload; show warnings |
| QCut already has Seedance I2V support | S-Class extends existing Seedance handlers, doesn't replace them |

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Storyboard mode (`SClassMode = "storyboard"`) | Complex orchestration; start with "free" mode |
| Video extend/edit modes | `GroupGenerationType` variants — add after basic generation works |
| Multi-shot chaining | Connecting multiple S-Class outputs sequentially — Phase 4 |
| Moyin's S-Class store (700+ lines) | Too coupled to moyin's UI; build fresh store for QCut |
