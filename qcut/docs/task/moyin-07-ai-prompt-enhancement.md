# Moyin Integration: AI Prompt Enhancement

> **Date:** 2026-02-22
> **Feature:** Wire character bible + cinematography presets into QCut's existing AI Video generation tab
> **Phase:** 3 (Enhancement)
> **Priority:** P2
> **Est. total effort:** ~2 hours (4 subtasks)
> **Depends on:** [moyin-02-character-bible.md](moyin-02-character-bible.md), [moyin-03-cinematography-presets.md](moyin-03-cinematography-presets.md)
> **Parent:** [moyin-creator-integration-plan.md](moyin-creator-integration-plan.md)

---

## Summary

Enhance QCut's existing AI Video generation tab with two new capabilities from Moyin:
1. **Character Bible toggle** — prepend character consistency prompts to generation requests
2. **Cinematography preset selector** — add professional camera/lighting vocabulary to prompts

These wire into the existing AI generation pipeline without changing the generation flow — they only enhance the prompt text sent to AI models.

---

## Architecture Decision

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Prompt injection point | `model-handlers.ts` routing functions | Central point before any model-specific handler |
| Character state | Import from `moyin-store` | Characters already parsed in Moyin tab workflow |
| Cinematography state | Local component state | Simple dropdown selection, no persistence needed |
| UI placement | Collapsible section in `ai-text-tab.tsx` | Non-intrusive; power users can expand |

---

## Implementation Status

| Subtask | Status | Est. |
|---------|--------|------|
| 1. Add character bible toggle to AI Text Tab | Pending | 30 min |
| 2. Add cinematography preset selector | Pending | 30 min |
| 3. Wire prompt enhancement into model handlers | Pending | 30 min |
| 4. Add unit tests | Pending | 30 min |

---

## Subtask 1: Add Character Bible Toggle to AI Text Tab

**Priority:** P1
**Est. time:** 30 min

### Files to modify
- `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-text-tab.tsx`

### Changes

Add a collapsible "Character Consistency" section below the prompt textarea:

```typescript
// New imports
import { useCharacterBibleManager } from "@/lib/moyin/character/character-bible"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { Checkbox } from "@/components/ui/checkbox"

// Inside AITextTab component:
// 1. Get available characters from character bible
const bibleManager = useCharacterBibleManager()
const characters = bibleManager.exportAll()

// 2. State for selected character IDs
const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([])
const [useCharacterBible, setUseCharacterBible] = useState(false)

// 3. Render collapsible section
<Collapsible>
  <CollapsibleTrigger>
    <Checkbox checked={useCharacterBible} />
    Character Consistency ({characters.length} characters)
  </CollapsibleTrigger>
  <CollapsibleContent>
    {characters.map(char => (
      <label key={char.id}>
        <Checkbox
          checked={selectedCharacterIds.includes(char.id)}
          onCheckedChange={...}
        />
        {char.name} — {char.role}
      </label>
    ))}
  </CollapsibleContent>
</Collapsible>
```

### Props addition

Add to `AITextTabProps` interface:
```typescript
export interface AITextTabProps {
  // ... existing props
  useCharacterBible?: boolean
  onUseCharacterBibleChange?: (value: boolean) => void
  selectedCharacterIds?: string[]
  onSelectedCharacterIdsChange?: (ids: string[]) => void
}
```

---

## Subtask 2: Add Cinematography Preset Selector

**Priority:** P1
**Est. time:** 30 min

### Files to modify
- `apps/web/src/components/editor/media-panel/views/ai/tabs/ai-text-tab.tsx`

### Changes

Add a "Cinematography" section below the character bible toggle:

```typescript
// New imports
import {
  CINEMATOGRAPHY_PROFILES,
  CINEMATOGRAPHY_PROFILE_CATEGORIES,
  getCinematographyProfile,
} from "@/lib/moyin/presets/cinematography-profiles"
import { Select, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select"

// State
const [cinematographyProfileId, setCinematographyProfileId] = useState<string | null>(null)

// Render
<div>
  <Label>Cinematography Style</Label>
  <Select value={cinematographyProfileId ?? ""} onValueChange={setCinematographyProfileId}>
    <SelectTrigger>
      {cinematographyProfileId
        ? getCinematographyProfile(cinematographyProfileId)?.name
        : "None (default)"}
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="">None</SelectItem>
      {CINEMATOGRAPHY_PROFILE_CATEGORIES.map(category => (
        <React.Fragment key={category.id}>
          <SelectLabel>{category.emoji} {category.name}</SelectLabel>
          {category.profiles.map(profile => (
            <SelectItem key={profile.id} value={profile.id}>
              {profile.emoji} {profile.name}
            </SelectItem>
          ))}
        </React.Fragment>
      ))}
    </SelectContent>
  </Select>
  {cinematographyProfileId && (
    <p className="text-xs text-muted-foreground mt-1">
      {getCinematographyProfile(cinematographyProfileId)?.description}
    </p>
  )}
</div>
```

### Props addition

```typescript
export interface AITextTabProps {
  // ... existing props
  cinematographyProfileId?: string | null
  onCinematographyProfileIdChange?: (id: string | null) => void
}
```

---

## Subtask 3: Wire Prompt Enhancement into Model Handlers

**Priority:** P1
**Est. time:** 30 min

### Files to modify
- `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handlers.ts`
- `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/model-handler-types.ts`

### Changes to `model-handler-types.ts`

Add enhancement fields to `TextToVideoSettings`:
```typescript
export interface TextToVideoSettings {
  // ... existing fields
  characterBiblePrompt?: string       // Pre-built character consistency prompt
  cinematographyGuidance?: string     // Pre-built cinematography guidance string
}
```

### Changes to `model-handlers.ts`

In `routeTextToVideoHandler()`, prepend enhancement prompts before routing to model-specific handler:

```typescript
export async function routeTextToVideoHandler(
  ctx: ModelHandlerContext,
  settings: TextToVideoSettings
): Promise<ModelHandlerResult> {
  // Enhance prompt with character bible and cinematography
  const enhancedPrompt = buildEnhancedPrompt(
    ctx.prompt,
    settings.characterBiblePrompt,
    settings.cinematographyGuidance,
  )

  const enhancedCtx = { ...ctx, prompt: enhancedPrompt }

  // Route to model-specific handler (existing logic)
  // ...
}

function buildEnhancedPrompt(
  basePrompt: string,
  characterBiblePrompt?: string,
  cinematographyGuidance?: string,
): string {
  const parts: string[] = []
  if (characterBiblePrompt) parts.push(characterBiblePrompt)
  if (cinematographyGuidance) parts.push(cinematographyGuidance)
  parts.push(basePrompt)
  return parts.join("\n\n")
}
```

### Wiring in `use-ai-generation.ts` or parent component

The AI Video tab's parent component needs to pass the enhancement strings down:

```typescript
// In the AI view component that calls useAIGeneration:
import { getCharacterBibleManager } from "@/lib/moyin/character/character-bible"
import { buildCinematographyGuidance } from "@/lib/moyin/presets/cinematography-profiles"

// Build enhancement strings from UI state
const characterBiblePrompt = useCharacterBible && selectedCharacterIds.length > 0
  ? getCharacterBibleManager().buildCharacterPrompt(selectedCharacterIds)
  : undefined

const cinematographyGuidance = cinematographyProfileId
  ? buildCinematographyGuidance(cinematographyProfileId)
  : undefined
```

---

## Subtask 4: Unit Tests

**Priority:** P2
**Est. time:** 30 min

### Target files
- `apps/web/src/components/editor/media-panel/views/ai/hooks/generation/__tests__/prompt-enhancement.test.ts` (NEW)
- `apps/web/src/components/editor/media-panel/views/ai/tabs/__tests__/ai-text-tab-moyin.test.tsx` (NEW)

### Test coverage

**prompt-enhancement.test.ts:**
- `buildEnhancedPrompt()` — returns base prompt when no enhancements
- `buildEnhancedPrompt()` — prepends character bible prompt
- `buildEnhancedPrompt()` — prepends cinematography guidance
- `buildEnhancedPrompt()` — combines both enhancements with base prompt
- `buildEnhancedPrompt()` — separates sections with double newline

**ai-text-tab-moyin.test.tsx:**
- Renders character bible toggle (collapsed by default)
- Shows character count badge when characters exist
- Renders cinematography selector with "None" default
- Selecting a profile shows its description text
- Follow test patterns from `apps/web/src/components/editor/media-panel/views/ai/components/__tests__/`

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Visual style selector in AI tab | Moyin has 40+ styles but QCut's AI tab already has model-specific settings |
| Character reference image upload | Separate feature; QCut already has image upload in AI Image tab |
| Negative prompt presets | `getNegativePrompt()` available but not yet surfaced in UI — defer |
| Image-to-video enhancement | Same prompt enhancement works; no separate UI needed |
