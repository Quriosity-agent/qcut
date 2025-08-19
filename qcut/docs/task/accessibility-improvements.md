# Accessibility Improvements for Settings Feature

## Overview
This document outlines accessibility improvements for the project settings feature based on code review feedback.

## Issue: Clickable Divs Should Be Buttons
**Problem**: Interactive elements using `<div>` with `onClick` handlers are not accessible to keyboard users or screen readers.

**Solution**: Replace clickable `<div>` elements with proper `<button>` elements.

## Specific Improvements

### 1. Blur Preview Tiles
**Current (in tag v0.2.0-settings-and-media-fix):**
```tsx
<div
  className={cn(
    "w-full aspect-square rounded-sm cursor-pointer hover:outline-2 hover:outline-primary relative overflow-hidden",
    isSelected && "outline-2 outline-primary"
  )}
  onClick={onSelect}
>
  {/* content */}
</div>
```

**Improved:**
```tsx
<button
  type="button"
  aria-pressed={isSelected}
  aria-label={`Select ${blur.label} blur level`}
  className={cn(
    "w-full aspect-square rounded-sm cursor-pointer hover:outline-2 hover:outline-primary relative overflow-hidden",
    isSelected && "outline-2 outline-primary"
  )}
  onClick={onSelect}
>
  {/* content */}
</button>
```

### 2. Color Selection Tiles
**Current:**
```tsx
<div
  key={color}
  className={cn(
    "w-full aspect-square rounded-sm cursor-pointer hover:border-2 hover:border-primary",
    isColorBackground &&
      color === currentBackgroundColor &&
      "border-2 border-primary"
  )}
  style={{ backgroundColor: color }}
  onClick={() => handleColorSelect(color)}
/>
```

**Improved:**
```tsx
<button
  type="button"
  key={color}
  aria-pressed={isColorBackground && color === currentBackgroundColor}
  aria-label={`Select color ${color}`}
  className={cn(
    "w-full aspect-square rounded-sm cursor-pointer hover:border-2 hover:border-primary",
    isColorBackground &&
      color === currentBackgroundColor &&
      "border-2 border-primary"
  )}
  style={{ backgroundColor: color }}
  onClick={() => handleColorSelect(color)}
/>
```

### 3. Custom Color Picker Button
**Current:**
```tsx
<div className="w-full aspect-square rounded-sm cursor-pointer border border-foreground/15 hover:border-primary flex items-center justify-center">
  <PipetteIcon className="size-4" />
</div>
```

**Improved:**
```tsx
<button
  type="button"
  aria-label="Pick a custom color"
  className="w-full aspect-square rounded-sm cursor-pointer border border-foreground/15 hover:border-primary flex items-center justify-center"
  onClick={handleCustomColorPicker}
>
  <PipetteIcon className="size-4" />
</button>
```

## Accessibility Benefits

### ✅ Keyboard Navigation
- **Before**: Div elements not focusable with Tab key
- **After**: Button elements focusable and keyboard accessible

### ✅ Screen Reader Support
- **Before**: Screen readers don't announce divs as interactive
- **After**: Screen readers announce buttons with proper roles and states

### ✅ ARIA States
- **`aria-pressed`**: Indicates selection state for toggle buttons
- **`aria-label`**: Provides descriptive labels for color values and blur levels

### ✅ Semantic HTML
- **Before**: Non-semantic div elements
- **After**: Proper button elements with appropriate roles

## Implementation Strategy (Non-Breaking)

Since the settings feature is in the tagged release `v0.2.0-settings-and-media-fix`, these improvements can be implemented:

### Option 1: Create New Accessible Version
1. Create new branch from tag: `git checkout -b feat-settings-accessibility v0.2.0-settings-and-media-fix`
2. Apply accessibility improvements
3. Test thoroughly for regression
4. Create new tag: `v0.2.1-settings-accessibility`

### Option 2: Apply to Current Development
1. When ready to merge settings into main branch
2. Apply accessibility improvements during merge
3. Ensure all existing functionality preserved

## Testing Checklist

- [ ] **Keyboard Navigation**: All interactive elements accessible via Tab key
- [ ] **Screen Reader**: NVDA/JAWS properly announce button states
- [ ] **Focus Management**: Clear focus indicators on all buttons  
- [ ] **Functionality**: All click handlers work identically to div version
- [ ] **Styling**: Visual appearance unchanged from div implementation
- [ ] **Performance**: No performance regression from div→button conversion

## Backward Compatibility

✅ **Non-Breaking**: These changes only improve accessibility without changing:
- Visual appearance
- Click behavior
- Component APIs
- Store interactions
- Existing functionality

The improvements are purely semantic HTML and ARIA enhancements.