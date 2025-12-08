# AI Panel Subfolder Organization Plan

**Created**: 2025-12-09
**Status**: Proposed
**Related**: ai-tsx-implementation-steps.md

---

## Problem

The `views/` directory now contains 25+ AI-related files from the refactoring, making it cluttered and harder to navigate. Other features like `stickers/` already use subfolders effectively.

## Current AI Files (Flat Structure)

```
views/
├── ai.tsx                      # Main component (1083 lines)
├── ai-constants.ts             # Constants and model configs
├── ai-types.ts                 # TypeScript types
├── ai-cost-calculators.ts      # Cost calculation utilities
├── ai-model-options.ts         # Model option definitions
├── ai-history-panel.tsx        # History panel component
├── ai-image-upload.tsx         # Image upload component
├── ai-select-fields.tsx        # Reusable select fields
├── ai-settings-panel.tsx       # Collapsible settings panel
├── ai-text-tab.tsx             # Text tab UI component
├── ai-image-tab.tsx            # Image tab UI component
├── ai-avatar-tab.tsx           # Avatar tab UI component
├── ai-upscale-tab.tsx          # Upscale tab UI component
├── ai-sora-settings.tsx        # Sora 2 settings panel
├── ai-veo-settings.tsx         # Veo 3.1 settings panel
├── ai-reve-settings.tsx        # Reve settings panel
├── text2video-models-config.ts # T2V model capabilities
├── use-ai-generation.ts        # Generation hook
├── use-ai-history.ts           # History management hook
├── use-ai-tab-state-base.ts    # Base state hook utilities
├── use-ai-text-tab-state.ts    # Text tab state hook
├── use-ai-image-tab-state.ts   # Image tab state hook
├── use-ai-avatar-tab-state.ts  # Avatar tab state hook
├── use-ai-upscale-tab-state.ts # Upscale tab state hook
└── __tests__/
    └── ai-constants.test.ts    # Tests
```

---

## Proposed Subfolder Structure

```
views/
├── ai/
│   ├── index.tsx               # Re-export main component (was ai.tsx)
│   │
│   ├── components/             # UI Components
│   │   ├── ai-history-panel.tsx
│   │   ├── ai-image-upload.tsx
│   │   ├── ai-select-fields.tsx
│   │   └── ai-settings-panel.tsx
│   │
│   ├── tabs/                   # Tab Components
│   │   ├── ai-text-tab.tsx
│   │   ├── ai-image-tab.tsx
│   │   ├── ai-avatar-tab.tsx
│   │   └── ai-upscale-tab.tsx
│   │
│   ├── settings/               # Model-Specific Settings
│   │   ├── ai-sora-settings.tsx
│   │   ├── ai-veo-settings.tsx
│   │   └── ai-reve-settings.tsx
│   │
│   ├── hooks/                  # React Hooks
│   │   ├── use-ai-generation.ts
│   │   ├── use-ai-history.ts
│   │   ├── use-ai-tab-state-base.ts
│   │   ├── use-ai-text-tab-state.ts
│   │   ├── use-ai-image-tab-state.ts
│   │   ├── use-ai-avatar-tab-state.ts
│   │   └── use-ai-upscale-tab-state.ts
│   │
│   ├── types/                  # TypeScript Types
│   │   └── ai-types.ts
│   │
│   ├── constants/              # Constants & Config
│   │   ├── ai-constants.ts
│   │   ├── ai-model-options.ts
│   │   └── text2video-models-config.ts
│   │
│   ├── utils/                  # Utility Functions
│   │   └── ai-cost-calculators.ts
│   │
│   └── __tests__/              # Tests
│       └── ai-constants.test.ts
│
└── ... (other views)
```

---

## Migration Steps

### Phase 1: Create Subfolder Structure
```bash
mkdir -p views/ai/{components,tabs,settings,hooks,types,constants,utils,__tests__}
```

### Phase 2: Move Files
```bash
# Components
mv views/ai-history-panel.tsx views/ai/components/
mv views/ai-image-upload.tsx views/ai/components/
mv views/ai-select-fields.tsx views/ai/components/
mv views/ai-settings-panel.tsx views/ai/components/

# Tabs
mv views/ai-text-tab.tsx views/ai/tabs/
mv views/ai-image-tab.tsx views/ai/tabs/
mv views/ai-avatar-tab.tsx views/ai/tabs/
mv views/ai-upscale-tab.tsx views/ai/tabs/

# Settings
mv views/ai-sora-settings.tsx views/ai/settings/
mv views/ai-veo-settings.tsx views/ai/settings/
mv views/ai-reve-settings.tsx views/ai/settings/

# Hooks
mv views/use-ai-*.ts views/ai/hooks/

# Types
mv views/ai-types.ts views/ai/types/

# Constants
mv views/ai-constants.ts views/ai/constants/
mv views/ai-model-options.ts views/ai/constants/
mv views/text2video-models-config.ts views/ai/constants/

# Utils
mv views/ai-cost-calculators.ts views/ai/utils/

# Main component
mv views/ai.tsx views/ai/index.tsx

# Tests
mv views/__tests__/ai-constants.test.ts views/ai/__tests__/
```

### Phase 3: Update Imports
All imports will need to be updated to reflect new paths:

```typescript
// Before
import { AITextTab } from "./ai-text-tab";
import { useTextTabState } from "./use-ai-text-tab-state";

// After
import { AITextTab } from "./tabs/ai-text-tab";
import { useTextTabState } from "./hooks/use-ai-text-tab-state";
```

### Phase 4: Create Barrel Exports
Create `index.ts` files in each subfolder for cleaner imports:

```typescript
// views/ai/hooks/index.ts
export * from "./use-ai-generation";
export * from "./use-ai-history";
export * from "./use-ai-text-tab-state";
// ... etc

// views/ai/index.tsx
export { AiView } from "./ai-view";
export * from "./types/ai-types";
```

---

## Benefits

1. **Organization**: Clear separation of concerns
2. **Discoverability**: Easier to find related files
3. **Consistency**: Matches existing patterns (e.g., `stickers/`)
4. **Scalability**: Easy to add new models/tabs
5. **Import Clarity**: Barrel exports simplify imports

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking imports | Use find-and-replace, run type check |
| Git history | Use `git mv` to preserve history |
| Merge conflicts | Coordinate with team, do in single PR |
| IDE caching | Restart IDE/clear caches after move |

---

## Estimated Effort

- **Phase 1**: 5 minutes (create folders)
- **Phase 2**: 10 minutes (move files)
- **Phase 3**: 30-60 minutes (update imports)
- **Phase 4**: 15 minutes (barrel exports)
- **Testing**: 15 minutes (verify build)

**Total**: ~1-2 hours

---

## Decision

- [ ] Approve and implement
- [ ] Modify structure (specify changes)
- [ ] Defer to later
- [ ] Reject (keep flat structure)

---

## Notes

- The `stickers/` folder already uses this pattern successfully
- Consider doing this before adding more AI models
- Can be done incrementally if needed
