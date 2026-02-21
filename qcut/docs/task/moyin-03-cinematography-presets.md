# Moyin Integration: Cinematography Presets & Visual Styles

> **Date:** 2026-02-22
> **Feature:** Port Moyin's cinematography profiles, visual style presets, and director presets into QCut
> **Phase:** 1 (Portable Libraries)
> **Priority:** P1
> **Est. total effort:** ~45 min (3 subtasks)
> **Parent:** [moyin-creator-integration-plan.md](moyin-creator-integration-plan.md)

---

## Summary

Port three constant/preset modules from Moyin into QCut as pure data files. These provide rich cinematography vocabulary (shot sizes, camera angles, lighting, rigs) and visual style definitions (40+ art styles across 3D, 2D, realistic, stop-motion) that can enhance QCut's AI video generation prompts.

---

## Architecture Decision

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location | `apps/web/src/lib/moyin/presets/` | Pure data — no logic dependencies |
| Format | TypeScript `as const` objects | Type-safe, tree-shakeable, zero runtime cost |
| Usage | Import directly in AI generation components | No store or IPC needed for static data |

---

## Implementation Status

| Subtask | Status | Est. |
|---------|--------|------|
| 1. Port cinematography profiles | Done | 15 min |
| 2. Port visual style presets | Done | 15 min |
| 3. Port director shot/camera presets | Done | 15 min |
| 4. Add unit tests | Done | 15 min |

### Implementation Notes (2026-02-22)

**Subtask 1 — Port Cinematography Profiles:**
- Created `apps/web/src/lib/moyin/presets/cinematography-profiles.ts` — 17 profiles across 5 categories
- Translated all Chinese descriptions/guidance to English
- Imports camera/lighting types from `@/types/moyin-script`
- `buildCinematographyGuidance()` generates formatted text for AI system prompts

**Subtask 2 — Port Visual Style Presets:**
- Created `apps/web/src/lib/moyin/presets/visual-styles.ts` — 48+ style presets across 4 categories
- Removed `thumbnail` field from `StylePreset` (moyin-specific file paths)
- All helper functions ported: `getStyleById`, `getStylePrompt`, `getStyleNegativePrompt`, `getStyleName`, `getStylesByCategory`, `getStyleDescription`, `getMediaType`

**Subtask 3 — Port Director Presets:**
- Created `apps/web/src/lib/moyin/presets/director-presets.ts` — all preset arrays with English labels
- Created `apps/web/src/lib/moyin/presets/index.ts` — barrel export for all presets
- Includes: shot sizes, camera angles/movements, lighting, focal lengths, atmospheric effects, emotions, and more

**Subtask 4 — Unit Tests:**
- Created `apps/web/src/lib/moyin/presets/__tests__/presets.test.ts`
- Covers: profile counts, required fields, lookup functions, style categories, director preset structure

---

## Subtask 1: Port Cinematography Profiles

**Priority:** P1
**Est. time:** 15 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/constants/cinematography-profiles.ts`

### Target files
- `apps/web/src/lib/moyin/presets/cinematography-profiles.ts` (NEW)
- `apps/web/src/lib/moyin/presets/index.ts` (NEW — barrel export)

### Key exports to port

```typescript
// 16 cinematography profiles across 5 categories
type CinematographyCategory = "cinematic" | "documentary" | "stylized" | "genre" | "era"

interface CinematographyProfile {
  id: string
  name: string
  nameEn: string
  category: CinematographyCategory
  description: string
  emoji: string
  defaultLighting: { style: LightingStyle; direction: LightingDirection; colorTemperature: ColorTemperature }
  defaultFocus: { depthOfField: DepthOfField; focusTransition: FocusTransition }
  defaultRig: { cameraRig: CameraRig; movementSpeed: MovementSpeed }
  defaultAtmosphere: { effects: AtmosphericEffect[]; intensity: EffectIntensity }
  promptGuidance: string
  referenceFilms: string[]
}

CINEMATOGRAPHY_PROFILES: readonly CinematographyProfile[]
getCinematographyProfile(profileId: string): CinematographyProfile | undefined
buildCinematographyGuidance(profileId: string): string
DEFAULT_CINEMATOGRAPHY_PROFILE_ID: string
```

### Profiles included
- **Cinematic (5):** Classic, Film Noir, Epic Blockbuster, Intimate Drama, Romantic
- **Documentary (2):** Raw Documentary, News Report
- **Stylized (4):** Cyberpunk Neon, Wuxia Classic, Horror Thriller, Music Video
- **Genre (3):** Family Warmth, Action Intense, Suspense Mystery
- **Era (2):** 90s Hong Kong, Golden Age Hollywood

### Adaptation needed
- None — this is pure data. Copy directly and ensure types are self-contained.

---

## Subtask 2: Port Visual Style Presets

**Priority:** P1
**Est. time:** 15 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/constants/visual-styles.ts`

### Target files
- `apps/web/src/lib/moyin/presets/visual-styles.ts` (NEW)

### Key exports to port

```typescript
type StyleCategory = "3d" | "2d" | "real" | "stop_motion"
type MediaType = "cinematic" | "animation" | "stop-motion" | "graphic"

interface StylePreset {
  id: string
  name: string
  category: StyleCategory
  mediaType: MediaType
  prompt: string           // Positive prompt text for this style
  negativePrompt: string   // Negative prompt text
  description: string
  thumbnail: string
}

VISUAL_STYLE_PRESETS: readonly StylePreset[]  // 40+ styles
getStyleById(styleId: string): StylePreset | undefined
getStylePrompt(styleId: string): string
getStyleNegativePrompt(styleId: string): string
getStylesByCategory(categoryId: string): StylePreset[]
DEFAULT_STYLE_ID: string
```

### Styles included
- **3D (8):** Xuanhuan, American, Q-version, Realistic, Block, Voxel, Mobile, Render 2D
- **2D Animation (23):** Ghibli, Retro, American, Shonen, JOJO, Pixel, Watercolor, Comic, etc.
- **Realistic (5):** Movie, Costume, HK Retro, Wuxia, Bloom
- **Stop Motion (5):** General, Figure, Clay, Lego, Felt

### Adaptation needed
- Remove `thumbnail` URLs (moyin-specific local paths) — set to empty string or placeholder
- `getStyleTokens()` is deprecated in moyin — skip it

---

## Subtask 3: Port Director Shot/Camera Presets

**Priority:** P1
**Est. time:** 15 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/stores/director-presets.ts`

### Target files
- `apps/web/src/lib/moyin/presets/director-presets.ts` (NEW)

### Key exports to port

All `as const` preset arrays with their corresponding types:

| Preset | Count | Examples |
|--------|-------|---------|
| `SHOT_SIZE_PRESETS` | 8 | WS, LS, MLS, MS, MCU, CU, ECU, POV |
| `CAMERA_ANGLE_PRESETS` | 9 | eye-level, high, low, bird's-eye, dutch, over-shoulder |
| `CAMERA_MOVEMENT_PRESETS` | 16 | static, tracking, orbit, zoom, pan, tilt, dolly, crane, drone |
| `LIGHTING_STYLE_PRESETS` | 8 | high-key, low-key, silhouette, chiaroscuro, natural, neon |
| `LIGHTING_DIRECTION_PRESETS` | 7 | front, side, back, top, bottom, rim, three-point |
| `COLOR_TEMPERATURE_PRESETS` | 6 | warm, neutral, cool, golden-hour, blue-hour, mixed |
| `DEPTH_OF_FIELD_PRESETS` | 5 | ultra-shallow, shallow, medium, deep, split-diopter |
| `CAMERA_RIG_PRESETS` | 8 | tripod, handheld, steadicam, dolly, crane, drone |
| `FOCAL_LENGTH_PRESETS` | 10 | 8mm to 400mm |
| `DURATION_PRESETS` | 9 | 4-12 seconds |
| `EMOTION_PRESETS` | 3 categories | basic, atmosphere, tone |
| `SPECIAL_TECHNIQUE_PRESETS` | 12 | hitchcock-zoom, timelapse, bullet-time, fpv, macro |

### Adaptation needed
- None — pure `as const` data. Copy directly.
- These presets integrate with Phase 3 (AI prompt enhancement) where users can select cinematography parameters before generating video.

---

## Unit Tests

No dedicated tests needed for this task — these are pure constant definitions with simple lookup functions. The getter functions (`getCinematographyProfile`, `getStyleById`) are trivial enough to be covered by integration tests in Phase 3.

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Preset UI selectors | Phase 2 (Moyin tab) and Phase 3 (AI prompt enhancement) |
| `SOUND_EFFECT_PRESETS` | Audio effects not yet used in QCut's AI generation |
| `PLAYBACK_SPEED_PRESETS` | QCut handles playback speed in timeline, not generation |
