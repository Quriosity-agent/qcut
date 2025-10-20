# Veo 3.1 Integration - Files to Modify

**Quick Reference Guide**
**Last Updated:** 2025-10-20

This document provides a quick reference for all files that need to be modified during the Veo 3.1 integration. For detailed implementation instructions, see [veo31-integration-plan.md](./veo31-integration-plan.md).

---

## 📂 Files to Modify (Existing Files)

### 1. Model Configuration
```
📄 qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts
```
**Changes:**
- Add 3 new model entries to `AI_MODELS` array
- Add Veo 3.1-specific error messages to `ERROR_MESSAGES`
- Add upload constants for frame validation

**Lines to Add:** ~60 lines
**Complexity:** Low

---

### 2. FAL AI Client
```
📄 qcut/apps/web/src/lib/fal-ai-client.ts
```
**Changes:**
- Add `generateVeo31TextToVideo()` method
- Add `generateVeo31ImageToVideo()` method
- Add `generateVeo31FrameToVideo()` method
- Extend `GenerationResult` interface if needed

**Lines to Add:** ~150 lines
**Complexity:** Medium

---

### 3. Generation Hook
```
📄 qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts
```
**Changes:**
- Add Veo 3.1 settings state (resolution, duration, audio)
- Add `hasVeo31Selected` computed value
- Add Veo 3.1 generation logic to `handleGenerate()`
- Add validation logic for images/frames

**Lines to Add:** ~100 lines
**Complexity:** Medium

---

### 4. AI Panel UI
```
📄 qcut/apps/web/src/components/editor/media-panel/views/ai.tsx
```
**Changes:**
- Add Veo 3.1 settings panel (conditional render)
- Add first/last frame upload UI (for frame-to-video)
- Update cost calculation to include Veo 3.1 pricing
- Add validation error displays

**Lines to Add:** ~200 lines
**Complexity:** Medium-High

---

## 📂 Files to Create (New Files)

### 5. Type Definitions
```
📄 qcut/apps/web/src/types/ai-generation.ts (NEW)
```
**Purpose:** TypeScript interfaces for Veo 3.1
**Contents:**
- `Veo31TextToVideoInput`
- `Veo31ImageToVideoInput`
- `Veo31FrameToVideoInput`
- `Veo31Response`
- `Veo31Settings`

**Lines to Add:** ~80 lines
**Complexity:** Low

---

### 6. Unit Tests (Optional but Recommended)
```
📄 qcut/apps/web/src/lib/__tests__/fal-ai-client-veo31.test.ts (NEW)
```
**Purpose:** Test Veo 3.1 client methods
**Contents:**
- Test text-to-video generation
- Test image-to-video generation
- Test frame-to-video generation
- Test error handling
- Test validation logic

**Lines to Add:** ~200 lines
**Complexity:** Medium

---

### 7. Integration Tests (Optional)
```
📄 qcut/apps/web/src/components/editor/media-panel/views/__tests__/ai-veo31-integration.test.tsx (NEW)
```
**Purpose:** Test UI integration
**Contents:**
- Test settings panel rendering
- Test cost calculation
- Test validation UI
- Test multi-model selection

**Lines to Add:** ~150 lines
**Complexity:** Medium

---

## 📋 File Modification Checklist

### Phase 1: Foundation
- [ ] Create `qcut/apps/web/src/types/ai-generation.ts`
- [ ] Modify `ai-constants.ts` (add models + error messages)

### Phase 2: Client Layer
- [ ] Modify `fal-ai-client.ts` (add 3 methods)
- [ ] Create `fal-ai-client-veo31.test.ts` (optional)

### Phase 3: Hook Layer
- [ ] Modify `use-ai-generation.ts` (add state + logic)

### Phase 4: UI Layer
- [ ] Modify `ai.tsx` (add settings panel + frame uploads)
- [ ] Create `ai-veo31-integration.test.tsx` (optional)

---

## 🔍 Detailed File Paths

### Core Implementation Files

| # | File Path | Purpose | Status |
|---|-----------|---------|--------|
| 1 | `qcut/apps/web/src/components/editor/media-panel/views/ai-constants.ts` | Model definitions & constants | Existing |
| 2 | `qcut/apps/web/src/lib/fal-ai-client.ts` | API client methods | Existing |
| 3 | `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts` | Generation hook logic | Existing |
| 4 | `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx` | UI components | Existing |
| 5 | `qcut/apps/web/src/types/ai-generation.ts` | TypeScript types | **New** |

### Test Files

| # | File Path | Purpose | Status |
|---|-----------|---------|--------|
| 6 | `qcut/apps/web/src/lib/__tests__/fal-ai-client-veo31.test.ts` | Client unit tests | **New** (Optional) |
| 7 | `qcut/apps/web/src/components/editor/media-panel/views/__tests__/ai-veo31-integration.test.tsx` | UI integration tests | **New** (Optional) |

### Documentation Files

| # | File Path | Purpose | Status |
|---|-----------|---------|--------|
| 8 | `qcut/docs/issues/veo31/veo31-integration-plan.md` | Full integration plan | ✅ Created |
| 9 | `qcut/docs/issues/veo31/FILES-TO-MODIFY.md` | This file | ✅ Created |

---

## 📊 Code Change Summary

| File | Lines Added | Complexity | Breaking Changes |
|------|-------------|------------|------------------|
| ai-constants.ts | ~60 | Low | ❌ No |
| fal-ai-client.ts | ~150 | Medium | ❌ No |
| use-ai-generation.ts | ~100 | Medium | ❌ No |
| ai.tsx | ~200 | Medium-High | ❌ No |
| ai-generation.ts (new) | ~80 | Low | ❌ No |
| **Total** | **~590 lines** | **Medium** | **❌ None** |

---

## 🔗 File Dependencies

### Dependency Graph

```
ai-generation.ts (types)
        ↓
fal-ai-client.ts (API methods)
        ↓
use-ai-generation.ts (hook logic)
        ↓
ai.tsx (UI components)
        ↑
ai-constants.ts (model definitions)
```

### Import Relationships

**ai.tsx imports from:**
- `ai-constants.ts` (AI_MODELS, ERROR_MESSAGES, UPLOAD_CONSTANTS)
- `use-ai-generation.ts` (useAIGeneration hook)
- `@/types/ai-generation` (Veo31 types)

**use-ai-generation.ts imports from:**
- `fal-ai-client.ts` (falAIClient)
- `@/types/ai-generation` (Veo31 types)

**fal-ai-client.ts imports from:**
- `@/types/ai-generation` (Veo31 types)
- `error-handler.ts` (error handling utilities)

---

## 🛡️ Non-Breaking Changes Guarantee

### Why No Breaking Changes?

1. **Additive Only:** All changes add new functionality, no deletions
2. **Backward Compatible:** Existing models continue to work
3. **Opt-In:** Veo 3.1 features only activate when models selected
4. **Type Safe:** TypeScript ensures compile-time safety
5. **Isolated:** Veo 3.1 code paths don't affect existing paths

### Proof of Non-Breaking

**Before Integration:**
```typescript
// Existing Sora 2 model selection works
const selectedModels = ["sora2_text_to_video"];
generation.handleGenerate(); // ✅ Still works
```

**After Integration:**
```typescript
// Existing Sora 2 still works
const selectedModels = ["sora2_text_to_video"];
generation.handleGenerate(); // ✅ Still works

// New Veo 3.1 also works
const selectedModels = ["veo31_text_to_video"];
generation.handleGenerate(); // ✅ New functionality
```

---

## 📝 Integration Subtasks

### Task Breakdown by File

#### 1️⃣ ai-constants.ts
```
Subtasks:
├── Add veo31_text_to_video model definition
├── Add veo31_image_to_video model definition
├── Add veo31_frame_to_video model definition
├── Add VEO31_IMAGE_TOO_LARGE error message
├── Add VEO31_INVALID_ASPECT_RATIO error message
└── Add VEO31_MISSING_FRAMES error message
```

#### 2️⃣ fal-ai-client.ts
```
Subtasks:
├── Add generateVeo31TextToVideo() method
│   ├── Parameter validation
│   ├── API request
│   ├── Response parsing
│   └── Error handling
├── Add generateVeo31ImageToVideo() method
│   ├── Image URL validation
│   ├── Aspect ratio validation
│   ├── API request
│   └── Error handling
└── Add generateVeo31FrameToVideo() method
    ├── Frame URL validation
    ├── API request
    └── Error handling
```

#### 3️⃣ use-ai-generation.ts
```
Subtasks:
├── Add Veo 3.1 settings state
│   ├── resolution state (720p/1080p)
│   ├── duration state (4s/6s/8s)
│   ├── aspectRatio state (16:9/9:16/1:1)
│   ├── generateAudio state (boolean)
│   └── enhancePrompt state (boolean)
├── Add hasVeo31Selected computed value
├── Add firstFrame/lastFrame state (for frame-to-video)
├── Extend handleGenerate() with Veo 3.1 logic
│   ├── Detect Veo 3.1 models
│   ├── Call appropriate API method
│   ├── Handle progress tracking
│   └── Handle results
└── Add validation logic
    ├── Validate image sizes
    ├── Validate aspect ratios
    └── Validate frame pairs
```

#### 4️⃣ ai.tsx
```
Subtasks:
├── Add Veo 3.1 settings panel
│   ├── Resolution selector
│   ├── Duration selector
│   ├── Aspect ratio selector
│   ├── Audio toggle
│   └── Conditional rendering (only show when Veo 3.1 selected)
├── Add first frame upload component
│   ├── File input
│   ├── Preview thumbnail
│   ├── Clear button
│   └── Validation
├── Add last frame upload component
│   ├── File input
│   ├── Preview thumbnail
│   ├── Clear button
│   └── Validation
├── Update cost calculation
│   ├── Add Veo 3.1 pricing logic
│   ├── Factor in audio on/off
│   ├── Factor in duration
│   └── Update total cost display
└── Add validation error displays
    ├── Image size errors
    ├── Aspect ratio errors
    └── Missing frames errors
```

#### 5️⃣ ai-generation.ts (new)
```
Subtasks:
├── Define Veo31TextToVideoInput interface
├── Define Veo31ImageToVideoInput interface
├── Define Veo31FrameToVideoInput interface
├── Define Veo31Response interface
├── Define Veo31Settings interface
└── Export all types
```

---

## ⚡ Quick Start Commands

### Start Development
```bash
# Navigate to project
cd C:\Users\zdhpe\Desktop\vite_opencut\OpenCut-main\qcut

# Ensure on veo31 branch
git branch --show-current  # Should show: veo31

# Install dependencies (if needed)
bun install

# Start dev server
bun run dev

# In another terminal, watch tests
bun run test:watch
```

### Create New Files
```bash
# Create type definitions file
touch apps/web/src/types/ai-generation.ts

# Create test files (optional)
touch apps/web/src/lib/__tests__/fal-ai-client-veo31.test.ts
touch apps/web/src/components/editor/media-panel/views/__tests__/ai-veo31-integration.test.tsx
```

### Verify Changes
```bash
# Run TypeScript check
cd apps/web && bun x tsc --noEmit

# Run linter
bun run lint:clean

# Run all tests
bun run test

# Build production
bun run build
```

---

## 📚 Additional Resources

### Related Documentation
- [Full Integration Plan](./veo31-integration-plan.md) - Complete implementation guide
- [Veo 3.1 API Docs](https://fal.ai/models/fal-ai/veo3.1/fast/api) - Official API reference
- [QCut CLAUDE.md](../../../CLAUDE.md) - Project coding guidelines

### Code References
- **Existing AI Integration:** See `ai.tsx` lines 636-709 (Sora 2 settings panel)
- **File Upload Pattern:** See `ai.tsx` lines 461-520 (Avatar file uploads)
- **API Client Pattern:** See `fal-ai-client.ts` lines 279-337 (generateWithModel)
- **Hook Pattern:** See `use-ai-generation.ts` lines 1-200 (existing generation logic)

---

## ✅ Definition of Done

### For Each File

- [ ] Code written and tested locally
- [ ] TypeScript compilation passes
- [ ] No linter errors
- [ ] Unit tests added (if applicable)
- [ ] Integration tests pass
- [ ] Code reviewed (self-review)
- [ ] JSDoc comments added
- [ ] No breaking changes introduced

### For Overall Integration

- [ ] All 3 Veo 3.1 models functional
- [ ] Multi-model generation works
- [ ] Cost calculation accurate
- [ ] Validation logic complete
- [ ] Error handling robust
- [ ] UI responsive and intuitive
- [ ] No regressions in existing features
- [ ] Documentation updated
- [ ] Pull request created

---

**End of Files to Modify Reference**

**Next Steps:**
1. Review the [full integration plan](./veo31-integration-plan.md)
2. Start with Phase 1 (Foundation)
3. Create type definitions file
4. Add model constants
5. Proceed sequentially through phases
