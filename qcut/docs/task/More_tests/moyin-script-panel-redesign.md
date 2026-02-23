# Moyin Script Panel Redesign

**Goal**: Redesign the QCut Moyin tab to match the original Moyin Creator's split-panel layout with full script editing workflow.

**Reference**: Original source at `/Users/peter/Desktop/code/moyin/moyin-creator/src/components/panels/script/`

---

## Current vs Target

### Current (QCut)
- 4-step wizard: Script → Characters → Scenes → Generate
- Single-column layout, one step visible at a time
- No language/scene count/shot count options
- Style selector buried in Generate step
- No episode structure view
- No API key status warning

### Target (Original Moyin Creator)
- **Split-panel layout**: Left input panel + Right episode structure panel
- **Left panel**: Import/Create tabs, script textarea, language selector, scene count, shot count, visual style, API key warning, parse/import buttons
- **Right panel**: Episode structure tree, character list, scene hierarchy, filter tabs, AI calibration buttons, progress tracking
- All visible simultaneously (no step-by-step wizard)

---

## Subtasks

### Subtask 1: Restructure MoyinView to Split-Panel Layout
**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/index.tsx` (rewrite)
- `apps/web/src/components/editor/media-panel/views/moyin/step-indicator.tsx` (remove)

**Changes**:
- Replace 4-step wizard with a horizontal `ResizablePanelGroup` (2 panels)
- Left panel (~40%): `ScriptInputPanel` — script input + config
- Right panel (~60%): `StructurePanel` — episode/character/scene hierarchy
- Add a header bar with "剧本编辑" title and status text
- Remove `StepIndicator` component (no longer needed)
- Keep the `useMoyinStore` data flow

**Layout**:
```
┌──────────────────────────────────────────┐
│  📄 剧本编辑              [status text]  │
├──────────────┬───────────────────────────┤
│ ScriptInput  │  StructurePanel           │
│ Panel        │  (episodes, characters,   │
│ (left ~40%)  │   scenes, filters)        │
│              │  (right ~60%)             │
└──────────────┴───────────────────────────┘
```

---

### Subtask 2: Rebuild ScriptInputPanel with Import/Create Tabs
**Time**: ~20 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/script-input.tsx` (rewrite)

**Changes**:
- Add Import/Create tab switcher (导入/创作) using `Tabs` component
- **Import tab**: Textarea for pasting full screenplay text + "导入完整剧本" button + "AI解析剧本" button
- **Create tab**: Idea input for AI-generated scripts (placeholder for now)
- Add **Language selector** dropdown: 中文, English, 日本語
- Add **Scene count** dropdown (optional): Auto, 1-10 scenes
- Add **Shot count** dropdown (optional): Auto, 3-12 shots
- Add **Visual style picker** with category badge (reuse existing `VISUAL_STYLE_PRESETS`)
- Add **API key status banner** — yellow warning if no API key configured
- Move style selector from GenerateActions into this panel

**Props from store**:
```typescript
rawScript, language, sceneCount, shotCount, selectedStyleId,
parseStatus, parseError, chatConfigured
```

**Reference**: Original `script-input.tsx` lines 197-780

---

### Subtask 3: Create StructurePanel (Episode Tree + Characters + Scenes)
**Time**: ~30 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/structure-panel.tsx` (new)

**Changes**:
- Create a right-panel component showing parsed script structure
- **Header**: Title + genre badge + progress (e.g., "0/49")
- **Filter tabs**: 全部 (All) | 未完成 (Incomplete) | 已完成 (Completed)
- **Action buttons**: AI场景校准, 更新全部, 新建集
- **Episode list**: Collapsible episodes with scene counts
  - Each episode shows: icon + title + shot count (e.g., "0/49")
  - Expand to show scenes within the episode
- **Character section**:
  - "角色 (N)" header with add/menu buttons
  - Character cards (reuse existing `CharacterCard` from character-list.tsx)
  - Collapsible "群演配角 (N)" section for extras/minor characters
- Empty state when no script is parsed yet

**Data from store**:
```typescript
scriptData (title, genre, episodes), characters, scenes,
characterCalibrationStatus, sceneCalibrationStatus
```

**Reference**: Original `episode-tree.tsx` lines 558-1140

---

### Subtask 4: Update MoyinStore for New Fields
**Time**: ~10 min
**Files**:
- `apps/web/src/stores/moyin-store.ts`
- `apps/web/src/types/moyin-script.ts`

**Changes**:
- Add `language: string` (default: "English")
- Add `sceneCount: string | undefined` (optional, "auto" default)
- Add `shotCount: string | undefined` (optional, "auto" default)
- Add `chatConfigured: boolean` (derived from API key availability)
- Add `setLanguage`, `setSceneCount`, `setShotCount` actions
- Add `importFullScript` action (calls IPC for structured import)
- Add `selectedItemId` and `selectedItemType` for structure panel selection
- Ensure `ScriptData` type includes `episodes` array properly
- Add `Episode` type to `moyin-script.ts` if not present (id, index, title, description, sceneIds)

---

### Subtask 5: Adapt Character/Scene Views for Inline Display
**Time**: ~15 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/character-list.tsx` (adapt)
- `apps/web/src/components/editor/media-panel/views/moyin/scene-list.tsx` (adapt)

**Changes**:
- Remove the step navigation buttons (Back/Forward) from both components since we no longer have a wizard
- Make them embeddable within the StructurePanel rather than standalone views
- CharacterList: Add protagonist/extras grouping logic
  - Split characters by tags: `protagonist`/`supporting` vs `minor`/`extra`
  - Collapsible "群演配角" section for extras
- SceneList: Add episode grouping — scenes grouped under their episode
- Both: Keep existing edit/add/remove/enhance functionality

---

### Subtask 6: Wire API Key Status Check
**Time**: ~5 min
**Files**:
- `apps/web/src/stores/moyin-store.ts`
- `apps/web/src/components/editor/media-panel/views/moyin/script-input.tsx`

**Changes**:
- Add `checkApiKeyStatus()` action that calls `window.electronAPI?.apiKeys?.status()`
- Store result as `chatConfigured: boolean` (true if any of openRouterApiKey/geminiApiKey is set)
- Call on mount in MoyinView
- Display yellow warning banner in ScriptInputPanel when `!chatConfigured`:
  ```
  ⚠ API 未配置
  请在设置中配置API密钥
  ```

**Reference**: Original `script-input.tsx` line 731

---

### Subtask 7: Update GenerateActions for New Layout
**Time**: ~10 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/generate-actions.tsx` (simplify)

**Changes**:
- Since style selector moves to ScriptInputPanel, remove it from here
- Keep: Camera Profile selector, Summary box, Generate button, Progress, Result image
- Make this a section within StructurePanel (or a modal/drawer triggered from structure panel)
- Could be shown as a bottom action bar in the structure panel or as a separate "Generate" button that opens a panel

---

### Subtask 8: Update Tests
**Time**: ~10 min
**Files**:
- `apps/web/src/components/editor/media-panel/views/moyin/__tests__/moyin-view.test.tsx`

**Changes**:
- Update test mocks to match new layout (no more step wizard)
- Add mocks for `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`
- Test: renders split layout with both panels
- Test: ScriptInputPanel shows Import/Create tabs
- Test: StructurePanel shows episode list when parsed
- Test: API key warning shows when not configured
- Test: language/scene count/shot count dropdowns work
- Remove old step navigation tests

---

## Dependency Graph

```
Subtask 4 (Store updates)
    ↓
Subtask 1 (Split layout) ──→ Subtask 8 (Tests)
    ↓              ↓
Subtask 2       Subtask 3
(ScriptInput)   (StructurePanel)
    ↓              ↓
Subtask 6       Subtask 5
(API key)       (Character/Scene adapt)
                   ↓
                Subtask 7
                (GenerateActions simplify)
```

**Recommended order**: 4 → 1 → 2 → 3 → 5 → 6 → 7 → 8

---

## Files Impact Summary

| File | Action |
|------|--------|
| `moyin/index.tsx` | Rewrite — split layout |
| `moyin/script-input.tsx` | Rewrite — Import/Create tabs + config |
| `moyin/structure-panel.tsx` | **New** — episode tree + characters + scenes |
| `moyin/character-list.tsx` | Adapt — remove nav, add grouping |
| `moyin/scene-list.tsx` | Adapt — remove nav, add episode grouping |
| `moyin/generate-actions.tsx` | Simplify — remove style selector |
| `moyin/step-indicator.tsx` | **Delete** — no longer needed |
| `stores/moyin-store.ts` | Extend — language, counts, API status |
| `types/moyin-script.ts` | Extend — Episode type |
| `moyin/__tests__/moyin-view.test.tsx` | Rewrite tests |

---

## Out of Scope

- Property panel (right panel in original 3-column layout) — defer to future
- Trailer generation tab (预告片) — defer
- Full script import with structured episode parsing — basic support only
- Shot breakdown view — defer
- Create mode AI script generation — placeholder only
- Viewpoint analysis / second-pass calibration — defer
