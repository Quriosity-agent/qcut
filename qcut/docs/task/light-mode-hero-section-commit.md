# Light Mode Hero Section Implementation

## Commit Information
- **Commit Hash**: efa5be2ab8fd5be095995378caddd0784fc3fbd3
- **Title**: feat: proper light mode for hero section
- **Author**: mazeincoding
- **Date**: August 4, 2025
- **URL**: https://github.com/OpenCut-app/OpenCut/commit/efa5be2ab8fd5be095995378caddd0784fc3fbd3

## Summary
This commit implements proper light mode support for the hero section and related components by updating theme-aware styling and adding adaptive image handling.

## Files Changed

### Image Assets
- **Removed**: `apps/web/public/landing-page-bg.png`
- **Added**: 
  - `apps/web/public/landing-page-dark.png`
  - `apps/web/public/landing-page-light.png`

### Component Updates

#### 1. `apps/web/src/components/header.tsx`
- Updated logo styling to include `invert dark:invert-0` classes for theme-aware display
- Changed background from `bg-accent` to `bg-background`

#### 2. `apps/web/src/components/landing/handlebars.tsx`
- Added `invert dark:invert-0` classes to handlebars SVG for theme adaptation

#### 3. `apps/web/src/components/landing/hero.tsx`
- Major refactoring for light/dark mode support:
  - Updated text colors from zinc-based (`text-zinc-500`, `text-zinc-300`) to theme-aware (`text-muted-foreground`, `text-foreground`)
  - Changed background colors to use `bg-background` instead of `bg-accent`
  - Implemented theme-specific background images using light/dark variants

#### 4. `apps/web/src/components/ui/sponsor-button.tsx`
- Updated text color from `text-zinc-400` to `text-muted-foreground`
- Changed hover effects to be theme-aware

## Key Implementation Details

### Theme-Aware Color Changes
- **Before**: Hardcoded colors like `text-zinc-500`, `text-zinc-300`, `bg-accent`
- **After**: Theme-adaptive colors like `text-muted-foreground`, `text-foreground`, `bg-background`

### Image Inversion Strategy
The commit uses CSS classes `invert dark:invert-0` to automatically invert images in light mode while keeping them normal in dark mode. This technique allows for single-source images that adapt to the current theme.

### Background Image Handling
Split the single background image into two theme-specific versions:
- `landing-page-light.png` for light mode
- `landing-page-dark.png` for dark mode

## Impact
This update ensures:
1. Consistent visual experience across light and dark themes
2. Better accessibility through proper contrast ratios
3. Reduced maintenance by using theme-aware utility classes
4. Improved user experience with automatic theme adaptation

## Technical Approach
The implementation follows Tailwind CSS best practices by:
- Using semantic color variables (`foreground`, `background`, `muted-foreground`)
- Leveraging dark mode variants (`dark:*` classes)
- Implementing CSS-based image transformations for theme switching