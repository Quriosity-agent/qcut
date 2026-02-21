# Moyin Integration: Character Bible & Consistency System

> **Date:** 2026-02-22
> **Feature:** Port Moyin's 6-layer character identity system into QCut
> **Phase:** 1 (Portable Libraries)
> **Priority:** P1
> **Est. total effort:** ~1.5 hours (4 subtasks)
> **Parent:** [moyin-creator-integration-plan.md](moyin-creator-integration-plan.md)

---

## Summary

Port Moyin's character consistency system — the `CharacterBibleManager`, `PromptCompiler` character methods, and 6-layer identity anchor definitions — into QCut. This gives QCut's AI generation the ability to maintain consistent character appearances across multiple generated images and videos.

### What is the 6-Layer Identity Anchor System?

Each character is described across six visual layers that AI models can use for consistency:

1. **Bone Structure** — face shape, jawline, cheekbones
2. **Facial Features** — eye shape, nose, lips
3. **Identifying Marks** — birthmarks, scars (strongest anchor for consistency)
4. **Color Anchors** — iris, hair, skin, lip colors (Hex values)
5. **Skin Texture** — pores, smile lines, wrinkles
6. **Hair Details** — style, hairline, length

---

## Architecture Decision

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location | `apps/web/src/lib/moyin/character/` | Separate from script parser; different domain |
| State | In-memory singleton (like moyin) | No persistence until Phase 2 adds `moyin-store` |
| Prompt output | Returns prompt strings | Integrates with any AI generation flow via string concatenation |

---

## Implementation Status

| Subtask | Status | Est. |
|---------|--------|------|
| 1. Port CharacterBible types and manager | Done | 25 min |
| 2. Port character prompt service | Deferred to Phase 2 | 20 min |
| 3. Port prompt compiler (character methods) | Deferred to Phase 2 | 20 min |
| 4. Add unit tests | Done | 25 min |

### Implementation Notes (2026-02-22)

**Subtask 1 — Port CharacterBible Types and Manager:**
- Created `apps/web/src/lib/moyin/character/types.ts` — `CharacterBible`, `ReferenceImage`, `CharacterType` interfaces
- Created `apps/web/src/lib/moyin/character/character-bible.ts` — `CharacterBibleManager` class with full CRUD
- Created `apps/web/src/lib/moyin/character/index.ts` — barrel export
- Singleton via `getCharacterBibleManager()` + React hook `useCharacterBibleManager()`
- Utility functions: `generateConsistencyPrompt()`, `mergeCharacterAnalyses()`
- Adapted: Removed multi-stage character support; used `Record<string, unknown>` instead of `any`

**Subtask 2 — Character Prompt Service:** Deferred. Requires multi-stage character design which depends on LLM API — will implement in Phase 2.

**Subtask 3 — Prompt Compiler:** Deferred. Scene/character compilation depends on Phase 2 UI integration. The core `generateConsistencyPrompt()` function covers the main use case.

**Subtask 4 — Unit Tests:**
- Created `apps/web/src/lib/moyin/character/__tests__/character-bible.test.ts`
- Covers: `CharacterBibleManager` CRUD, `generateConsistencyPrompt()`, `mergeCharacterAnalyses()`, singleton pattern

---

## Subtask 1: Port CharacterBible Types and Manager

**Priority:** P1
**Est. time:** 25 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/packages/ai-core/services/character-bible.ts`
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/packages/ai-core/types/index.ts` (CharacterBible interface)

### Target files
- `apps/web/src/lib/moyin/character/character-bible.ts` (NEW)
- `apps/web/src/lib/moyin/character/types.ts` (NEW)
- `apps/web/src/lib/moyin/character/index.ts` (NEW — barrel export)

### Key exports to port

```typescript
// types.ts
interface CharacterBible {
  id: string
  screenplayId: string
  name: string
  role: string
  appearance: string
  personality: string
  visualTraits: string[]
  consistencyAnchors: CharacterIdentityAnchors
  referenceImages: ReferenceImage[]
  createdAt: number
  updatedAt: number
}

interface CharacterIdentityAnchors {
  boneStructure: string
  facialFeatures: string
  identifyingMarks: string
  colorAnchors: { iris: string; hair: string; skin: string; lips: string }
  skinTexture: string
  hairDetails: string
}

interface ReferenceImage {
  url: string
  type: "portrait" | "full-body" | "expression"
  description: string
}

// character-bible.ts
class CharacterBibleManager {
  addCharacter(character: Omit<CharacterBible, "id" | "createdAt" | "updatedAt">): CharacterBible
  updateCharacter(id: string, updates: Partial<CharacterBible>): CharacterBible | null
  getCharacter(id: string): CharacterBible | null
  getCharactersForScreenplay(screenplayId: string): CharacterBible[]
  deleteCharacter(id: string): boolean
  buildCharacterPrompt(characterIds: string[]): string
  buildStyleTokens(characterIds: string[]): string[]
  createFromAnalysis(screenplayId: string, analysisResult: unknown, refImageUrl?: string): CharacterBible
  exportAll(): CharacterBible[]
  importAll(characters: CharacterBible[]): void
  clear(): void
}

function generateConsistencyPrompt(character: CharacterBible): string
function getCharacterBibleManager(): CharacterBibleManager
```

### Adaptation needed
- Remove dependency on moyin's `ai-core/types` — inline the interfaces
- Keep `CharacterBibleManager` as an in-memory singleton (same as moyin)
- The `generateConsistencyPrompt()` function is the main integration point — it takes a `CharacterBible` and returns a prompt string that can be prepended to any image/video generation prompt

---

## Subtask 2: Port Character Prompt Service

**Priority:** P1
**Est. time:** 20 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/lib/character/character-prompt-service.ts`

### Target files
- `apps/web/src/lib/moyin/character/character-prompt-service.ts` (NEW)

### Key exports to port

```typescript
interface CharacterDesign {
  characterName: string
  stages: CharacterStageAppearance[]
  overallDescription: string
  identityAnchors: CharacterIdentityAnchors
}

interface CharacterStageAppearance {
  stageName: string
  promptEn: string
  promptZh: string
  ageDescription?: string
}

getCharacterPromptForEpisode(design: CharacterDesign, episodeIndex: number): {
  promptEn: string
  promptZh: string
  stageName: string
}

getCharacterUpdatesFromDesign(design: CharacterDesign): {
  description: string
  visualTraits: string
}
```

### Adaptation needed
- Remove `generateCharacterDesign()` — it calls moyin's LLM API directly; will re-implement in Phase 2 using QCut's IPC
- Keep the pure functions: `getCharacterPromptForEpisode()`, `getCharacterUpdatesFromDesign()`, `convertDesignToVariations()`

---

## Subtask 3: Port Prompt Compiler (Character Methods)

**Priority:** P1
**Est. time:** 20 min

### Source files
- `/Users/peter/Desktop/code/moyin/moyin-creator/src/packages/ai-core/services/prompt-compiler.ts`

### Target files
- `apps/web/src/lib/moyin/character/prompt-compiler.ts` (NEW)

### Key exports to port

```typescript
class PromptCompiler {
  compileSceneImagePrompt(scene: AIScene, characters: AICharacter[], config: GenerationConfig): string
  compileSceneVideoPrompt(scene: AIScene, characters: AICharacter[]): string
  getNegativePrompt(additionalTerms?: string[]): string
  compile(templateId: string, variables: Record<string, string | number | undefined>): string
}

const promptCompiler: PromptCompiler  // singleton
```

### Adaptation needed
- Extract only the character-related compilation methods
- Generic `compile()` template method is useful as-is
- `getNegativePrompt()` returns standard negative prompt strings — directly reusable
- `compileSceneImagePrompt()` and `compileSceneVideoPrompt()` combine character descriptions with scene context — this is the core value

---

## Subtask 4: Unit Tests

**Priority:** P2
**Est. time:** 25 min

### Target files
- `apps/web/src/lib/moyin/character/__tests__/character-bible.test.ts` (NEW)
- `apps/web/src/lib/moyin/character/__tests__/prompt-compiler.test.ts` (NEW)

### Test coverage

**character-bible.test.ts:**
- `CharacterBibleManager.addCharacter()` — creates character with generated id
- `CharacterBibleManager.getCharacter()` — retrieves by id
- `CharacterBibleManager.getCharactersForScreenplay()` — filters by screenplayId
- `CharacterBibleManager.deleteCharacter()` — removes and returns true
- `CharacterBibleManager.buildCharacterPrompt()` — returns non-empty prompt string
- `generateConsistencyPrompt()` — includes all 6 identity anchor layers in output
- `generateConsistencyPrompt()` — handles missing optional anchors gracefully

**prompt-compiler.test.ts:**
- `PromptCompiler.compile()` — substitutes template variables
- `PromptCompiler.compileSceneImagePrompt()` — includes character + scene context
- `PromptCompiler.getNegativePrompt()` — returns default negative terms
- `PromptCompiler.getNegativePrompt(["extra"])` — appends additional terms

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| `generateCharacterDesign()` | Requires LLM API call — re-implement in Phase 2 via QCut IPC |
| Character image generation | Handled by QCut's existing AI Video tab |
| `mergeCharacterAnalyses()` | Moyin-specific batch analysis workflow |
