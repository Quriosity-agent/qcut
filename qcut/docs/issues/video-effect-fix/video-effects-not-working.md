# Video Effects Not Working - Investigation & Fix

## Issue Description
Video effects are not being applied correctly in the QCut editor export. Effects work in preview but not in exported video.

## Status
⚠️ **EXPORT ISSUE IDENTIFIED** - Branch: `video-effect-fix`

**Progress**:
- ✅ Preview panel effects working correctly
- ❌ Export fails with `window.electronAPI?.invoke is not a function`
- 🔍 CLI Export Engine being used in browser environment

## Related Files to Investigate

### Core Effects System
- `apps/web/src/stores/effects-store.ts` - Main effects state management
- `apps/web/src/lib/effects-utils.ts` - Effects utility functions
- `apps/web/src/lib/effects-canvas-advanced.ts` - Advanced canvas effects implementation
- `apps/web/src/config/features.ts` - Feature flags (EFFECTS_ENABLED)

### Effects UI Components
- `apps/web/src/components/editor/media-panel/views/effects.tsx` - Effects panel UI
- `apps/web/src/components/editor/properties-panel/effects-view.tsx` - Effects properties view

### Preview & Rendering
- `apps/web/src/components/editor/preview-panel.tsx` - Preview rendering with effects
- `apps/web/src/lib/export-engine.ts` - Export engine effects application
- `apps/web/src/lib/export-engine-cli.ts` - CLI export effects support

### Effect Types & Parameters
- `apps/web/src/types/effects.ts` - Effect type definitions
- `apps/web/src/data/video-effects.ts` - Available effects configuration

## Investigation Steps

### 1. Check Effects Store
```typescript
// apps/web/src/stores/effects-store.ts
- Verify effects are being saved to store
- Check getElementEffects() returns correct data
- Confirm applyEffect() is working
```

### 2. Preview Panel Rendering
```typescript
// apps/web/src/components/editor/preview-panel.tsx
- Check if effects are applied to video elements
- Verify CSS filters are generated correctly
- Confirm parametersToCSSFilters() conversion
```

### 3. Export Engine
```typescript
// apps/web/src/lib/export-engine.ts
- Verify applyEffectsToCanvas() is called
- Check if effects persist through export
- Confirm both Standard and CLI engines apply effects
```

### 4. Feature Flag
```typescript
// apps/web/src/config/features.ts
- Ensure EFFECTS_ENABLED = true
```

## Known Issues

### ❌ Critical Export Error
```console
export-engine-cli.ts:559 Uncaught (in promise) TypeError: window.electronAPI?.invoke is not a function
```
**CAUSE**: CLI Export Engine selected for non-Electron environment
- Export factory returns CLI engine even in browser
- CLI engine requires Electron API which doesn't exist in browser
- Need to force Standard engine for browser exports

## Proposed Solutions

### Solution 1: Fix Selection Dependency
Modify preview panel to apply effects to ALL elements with stored effects, not just selected ones.

### Solution 2: Fix Export Pipeline
Ensure effects are applied during frame rendering in export process.

## Testing Checklist
- [x] Effects visible in preview panel ✅
- [x] Effects persist when element deselected ✅
- [ ] Effects appear in exported video 🔍 (Investigating with console logs)
- [ ] Effects work in both Electron and browser
- [ ] Multiple effects can be combined
- [ ] Effect parameters update correctly

## Console Commands for Debugging
```javascript
// Check effects store state
useEffectsStore.getState().elementEffects

// Check if element has effects
useEffectsStore.getState().getElementEffects('element-id')

// Check feature flag
localStorage.getItem('qcut_effects_enabled')
```

## Progress Log

### 2025-09-19
- Created investigation branch `video-effect-fix`
- Identified key files for investigation
- Started documenting issue

### 2025-09-20
- ✅ **FIXED**: Preview panel selection dependency issue
- ✅ **ADDED**: Comprehensive console logging for debugging
- 🔍 **INVESTIGATING**: Export pipeline with console output analysis

## Console Output Analysis (console_message_v1.md)

### ✅ Effects Working in Preview
```console
🎨 EFFECTS STORE: Applying effect "Brighten" to element 27f64590-7093-4654-b1dc-6e65d069caad
✅ EFFECTS STORE: Successfully applied effect "Brighten" (ID: bb9d47de-dfe9-4802-887c-20ad975c135b)
🔍 EFFECTS STORE: Retrieved 1 effects for element: ['Brighten(enabled)']
```

### ❌ Export Engine Selection Error
```console
🚀 EXPORT ENGINE SELECTION: CLI FFmpeg chosen for Electron environment
🏗️ EXPORT ENGINE CREATION: Creating cli engine instance
⚡ CLI EXPORT ENGINE: Using native FFmpeg CLI for video export
export-engine-cli.ts:559 TypeError: window.electronAPI?.invoke is not a function
```
**PROBLEM**: Export factory incorrectly selects CLI engine for browser environment

### Root Cause Identified

The export is failing because:
1. **Export factory detects Electron environment incorrectly**
2. **CLI engine is selected instead of Standard engine**
3. **CLI engine tries to call `window.electronAPI?.invoke`** which doesn't exist in browser
4. **Export crashes before effects can be applied**

---

## Solution Required

### Fix Export Engine Selection
Modify `export-engine-factory.ts` to:
1. Properly detect browser vs Electron environment
2. Force Standard engine for browser exports
3. Only use CLI engine when `window.electronAPI` is available

### Code Fix Location
```typescript
// apps/web/src/lib/export-engine-factory.ts
// Line ~99: Fix environment detection
const isElectron = typeof window !== 'undefined' &&
                   window.electronAPI &&
                   typeof window.electronAPI.invoke === 'function';
```

## Testing After Fix
- [ ] Verify Standard engine is selected in browser
- [ ] Confirm export completes without errors
- [ ] Check that effects appear in exported video