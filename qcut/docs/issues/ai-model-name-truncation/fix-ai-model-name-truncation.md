# AI Model Name Truncation Fix

## Issue

In the AI Video Generation panel, model selection buttons truncate long model names with "..." instead of displaying the full name. This makes it difficult for users to distinguish between similar models.

**Affected models (examples):**
- "WAN Animate/Repla..." → WAN Animate/Replicate
- "Kling Avatar v2 Sta..." → Kling Avatar v2 Standard
- "Kling O1 Video Refere..." → Kling O1 Video Reference
- "Kling O1 Reference-t..." → Kling O1 Reference-to-Video
- "ByteDance OmniHum..." → ByteDance OmniHuman
- "Sora 2 Video-to-Vide..." → Sora 2 Video-to-Video

## Root Cause

The model name span uses the `truncate` CSS class which applies:
- `overflow: hidden`
- `text-overflow: ellipsis`
- `white-space: nowrap`

**Location:** `apps/web/src/components/editor/media-panel/views/ai/index.tsx`

**Lines 943-957:**
```tsx
<Button
  key={model.id}
  type="button"
  size="sm"
  variant={isModelSelected(model.id) ? "default" : "outline"}
  onClick={() => toggleModel(model.id)}
  className={`h-auto py-2 px-2 text-xs justify-start ${isCompact ? "flex-col items-start" : ""}`}
>
  <span className="truncate">{model.name}</span>  {/* <-- Problem here */}
  {!isCompact && (
    <span className="ml-auto text-muted-foreground">
      ${model.price}
    </span>
  )}
</Button>
```

## Solution

Remove the `truncate` class and add proper text wrapping styles to allow multi-line model names:

```tsx
<Button
  key={model.id}
  type="button"
  size="sm"
  variant={isModelSelected(model.id) ? "default" : "outline"}
  onClick={() => toggleModel(model.id)}
  className={`h-auto min-h-[44px] py-2 px-2 text-xs justify-start items-start ${isCompact ? "flex-col" : "flex-row"}`}
>
  <span className="text-left leading-tight flex-1">{model.name}</span>
  {!isCompact && (
    <span className="ml-2 text-muted-foreground whitespace-nowrap shrink-0">
      ${model.price}
    </span>
  )}
</Button>
```

### Changes Made

1. **Removed `truncate` class** - Allows text to wrap naturally
2. **Added `text-left`** - Ensures left-aligned text when wrapping
3. **Added `leading-tight`** - Reduces line spacing for multi-line names
4. **Added `flex-1`** - Allows name to take available space
5. **Added `min-h-[44px]`** - Sets minimum height for consistent button sizing
6. **Added `items-start`** - Aligns content to top when text wraps
7. **Price styling updates:**
   - Added `ml-2` instead of `ml-auto` - Consistent spacing
   - Added `whitespace-nowrap` - Prevents price from wrapping
   - Added `shrink-0` - Prevents price from shrinking

## Testing

After applying the fix, verify:
1. All model names are fully visible
2. Buttons expand vertically to accommodate long names
3. Price stays on the right side and doesn't wrap
4. Grid layout remains intact with 2 columns
5. Works in both compact and normal panel widths

## Priority

Low - UI improvement only, does not affect functionality
