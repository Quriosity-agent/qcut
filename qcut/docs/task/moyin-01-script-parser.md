# Moyin Integration: Script Parser

> **Date:** 2026-02-22
> **Feature:** Port Moyin's screenplay parser into QCut
> **Phase:** 1 (Portable Libraries)
> **Priority:** P1
> **Est. total effort:** ~1.5 hours (4 subtasks)
> **Parent:** [moyin-creator-integration-plan.md](moyin-creator-integration-plan.md)

---

## Summary

Port Moyin's script parser — which converts raw screenplay text into structured `ScriptData` (scenes, characters, dialogue, shots) — into QCut as a standalone library. This enables future features like script-to-video workflows and AI-assisted storyboarding.

---

## Architecture Decision

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location | `apps/web/src/lib/moyin/script/` | Follows QCut's `lib/` convention for pure-logic modules |
| API dependency | Route through QCut's `ai-pipeline-handler` | Moyin calls LLM APIs directly; QCut should use Electron IPC |
| Types | New `apps/web/src/types/moyin-script.ts` | Keep moyin types separate from QCut's existing `MediaItem` types |
| Storage | None (stateless) | Parser is pure function; state lives in `moyin-store` (Phase 2) |

---

## Implementation Status

| Subtask | Status | Est. |
|---------|--------|------|
| 1. Port core types | Done | 15 min |
| 2. Port script parser | Done | 30 min |
| 3. Port AI finders (scene + character) | Deferred to Phase 2 | 25 min |
| 4. Add unit tests | Done | 20 min |

### Implementation Notes (2026-02-22)

**Subtask 1 — Port Core Types:**
- Created `apps/web/src/types/moyin-script.ts` with all core types
- Includes: `ScriptCharacter`, `ScriptScene`, `ScriptData`, `Shot`, `CharacterIdentityAnchors`
- Includes all camera/lighting union types: `LightingStyle`, `CameraAngle`, `FocalLength`, etc.
- Removed moyin-specific fields: `CompletionStatus` on fields, `characterLibraryId`, `sceneLibraryId`, `baseCharacterId`, `stageInfo`, `ContinuityRef`, `Keyframe` types

**Subtask 2 — Port Script Parser:**
- Created `apps/web/src/lib/moyin/script/script-parser.ts` — LLM adapter pattern (`LLMAdapter` type) decouples from API
- Created `apps/web/src/lib/moyin/script/system-prompts.ts` — 4 system prompt templates (parse, shot generation, creative, storyboard structure)
- Created `apps/web/src/lib/moyin/script/index.ts` — barrel export
- Pure functions ported: `normalizeTimeValue()`, `detectInputType()`, `countShotMarkers()`, `cleanJsonFromResponse()`
- LLM-dependent functions ported: `parseScript()`, `generateScriptFromIdea()` — both accept a `callLLM` adapter

**Subtask 3 — AI Finders:** Deferred. These require LLM calls and will be re-implemented in Phase 2 using QCut IPC.

**Subtask 4 — Unit Tests:**
- Created `apps/web/src/lib/moyin/script/__tests__/script-parser.test.ts`
- Covers: `normalizeTimeValue()`, `detectInputType()`, `countShotMarkers()`, `parseScript()`, `generateScriptFromIdea()`, system prompts

---

## Subtask 1: Port Core Types

**Priority:** P1 (blocks all other subtasks)
**Est. time:** 15 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/types/script.ts`

### Target files
- `apps/web/src/types/moyin-script.ts` (NEW)

### Changes

Extract and adapt these interfaces from moyin's `script.ts`:

```typescript
// Core screenplay types needed by the parser
export type CompletionStatus = "pending" | "in_progress" | "completed"

export interface ScriptCharacter {
  id: string
  name: string
  gender?: string
  age?: string
  personality?: string
  role?: string
  appearance?: string
  relationships?: string
  tags?: string[]
  status?: CompletionStatus
  characterLibraryId?: string
}

export interface ScriptScene {
  id: string
  name?: string
  location: string
  time: string
  atmosphere: string
  visualPrompt?: string
  tags?: string[]
  status?: CompletionStatus
}

export interface ScriptData {
  title: string
  characters: ScriptCharacter[]
  scenes: ScriptScene[]
  rawText: string
}
```

**Adaptation:**
- Remove moyin-specific fields (`characterLibraryId` links, multi-stage support) that reference moyin stores
- Keep interface shapes compatible so future sync is possible

---

## Subtask 2: Port Script Parser

**Priority:** P1
**Est. time:** 30 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/script/script-parser.ts`

### Target files
- `apps/web/src/lib/moyin/script/script-parser.ts` (NEW)
- `apps/web/src/lib/moyin/script/index.ts` (NEW — barrel export)

### Key exports to port

```typescript
// From moyin's script-parser.ts
parseScript(rawScript: string, options: ParseOptions): Promise<ScriptData>
generateShotList(scriptData: ScriptData, options: ShotGenerationOptions): Promise<Shot[]>
generateScriptFromIdea(idea: string, options: ScriptGenerationOptions): Promise<string>
```

### Adaptation needed

1. **Replace `callChatAPI` with QCut's IPC pattern:**
   - Moyin calls LLM APIs directly via `fetch()`
   - QCut should call through `window.electronAPI.aiPipeline.generate()` or a new IPC channel
   - Create an adapter function: `callLLM(systemPrompt, userPrompt, options)` that uses QCut's pipeline

2. **Replace `ApiKeyManager` references:**
   - Moyin's `ParseOptions` includes `apiKey`, `provider`, `baseUrl`, `model`, `keyManager`
   - QCut manages keys via `electron/api-key-handler.ts` — the parser should accept a simpler config

3. **Simplified options interface:**
   ```typescript
   export interface ParseOptions {
     language?: string
     sceneCount?: number
     shotCount?: number
     temperature?: number
   }
   ```

---

## Subtask 3: Port AI Finders (Scene + Character)

**Priority:** P2
**Est. time:** 25 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/script/ai-scene-finder.ts`
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/script/ai-character-finder.ts`

### Target files
- `apps/web/src/lib/moyin/script/ai-scene-finder.ts` (NEW)
- `apps/web/src/lib/moyin/script/ai-character-finder.ts` (NEW)

### Key exports to port

```typescript
// Scene finder
findSceneByDescription(query: string, scenes: ScriptScene[]): Promise<SceneSearchResult>
quickSearchScene(query: string, scenes: ScriptScene[]): { name: string | null; found: boolean }

// Character finder
findCharacterByDescription(query: string, characters: ScriptCharacter[]): Promise<CharacterSearchResult>
quickSearchCharacter(query: string, characters: ScriptCharacter[]): { name: string | null; found: boolean }
```

### Adaptation needed
- Remove `ProjectBackground` and `EpisodeRawScript[]` params (moyin-specific multi-episode structure)
- Simplify to work against flat `ScriptScene[]` / `ScriptCharacter[]` arrays
- Route LLM calls through QCut IPC (same adapter as Subtask 2)

---

## Subtask 4: Unit Tests

**Priority:** P2
**Est. time:** 20 min

### Target files
- `apps/web/src/lib/moyin/script/__tests__/script-parser.test.ts` (NEW)
- `apps/web/src/lib/moyin/script/__tests__/ai-finders.test.ts` (NEW)

### Test coverage

**script-parser.test.ts:**
- `parseScript()` — returns valid `ScriptData` from raw screenplay text
- `parseScript()` — handles empty input gracefully
- `parseScript()` — extracts characters with names and roles
- `parseScript()` — extracts scenes with location and time
- `generateShotList()` — produces shots from parsed `ScriptData`
- `generateScriptFromIdea()` — returns non-empty screenplay string

**ai-finders.test.ts:**
- `quickSearchScene()` — exact match returns `{ found: true }`
- `quickSearchScene()` — no match returns `{ found: false }`
- `quickSearchCharacter()` — exact match returns `{ found: true }`
- `quickSearchCharacter()` — no match returns `{ found: false }`

**Pattern:** Follow QCut's existing test convention using Vitest + `@testing-library/react` (see `apps/web/src/components/editor/media-panel/views/ai/__tests__/` for examples).

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| `export-service.ts` | Moyin's markdown/JSON export — not needed until Phase 2 UI |
| Multi-episode support | QCut projects are single-timeline; defer until demand exists |
| `shot-generator.ts` | Merged into `script-parser.ts` via `generateShotList()` |
