# Video Effects Not Working - Investigation & Fix

## Issue Description
Video effects are not being applied correctly in the QCut editor. Effects show in the UI but don't render in preview or export.

## Status
🔧 **In Progress** - Branch: `video-effect-fix`

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

### Timeline Selection Issue
- Effects only apply to selected elements
- When selection is cleared, effects disappear
- Need to apply effects regardless of selection state

### Export Issue
- Effects show in preview but not in exported video
- May be related to canvas context or timing

## Proposed Solutions

### Solution 1: Fix Selection Dependency
Modify preview panel to apply effects to ALL elements with stored effects, not just selected ones.

### Solution 2: Fix Export Pipeline
Ensure effects are applied during frame rendering in export process.

## Testing Checklist
- [ ] Effects visible in preview panel
- [ ] Effects persist when element deselected
- [ ] Effects appear in exported video
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

---

**Next Steps**:
1. Add console logging to track effects application
2. Test effects in preview vs export
3. Implement fix for selection dependency