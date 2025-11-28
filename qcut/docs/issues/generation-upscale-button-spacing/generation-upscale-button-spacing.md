# Generation/Upscale Button Spacing Issue

## Status: ✅ RESOLVED

**Implemented:** 2025-11-27

## Summary
The Generation and Upscale toggle buttons in the AI Images panel had insufficient padding around the text, making them look cramped and less visually appealing.

## Previous State
- Location: `apps/web/src/components/editor/media-panel/views/model-type-selector.tsx`
- The buttons used `size="sm"` with minimal internal spacing
- Text appeared too close to button edges
- Visual hierarchy between label and description was weak

## Screenshot (Before)
![Previous button spacing](../assets/generation-upscale-current.png)

**Previous styling:**
```tsx
<Button
  size="sm"
  className={cn(
    "flex-1 flex-col items-start gap-0.5",
    selected === option.id
      ? "shadow-sm"
      : "border border-transparent hover:border-border"
  )}
>
  <span className="text-xs font-medium">{option.label}</span>
  <span className="text-[10px] text-muted-foreground">
    {option.description}
  </span>
</Button>
```

## Implemented Fix

The following changes were applied to improve button spacing:

```tsx
<Button
  size="sm"
  className={cn(
    "flex-1 flex-col items-start gap-0.5 px-3 py-2 h-auto",
    selected === option.id
      ? "shadow-sm"
      : "border border-transparent hover:border-border"
  )}
>
  <span className="text-sm font-medium">{option.label}</span>
  <span className="text-xs text-muted-foreground">
    {option.description}
  </span>
</Button>
```

### Changes Applied
1. Added `gap-0.5` - Small space between label and description
2. Added `px-3 py-2` - Moderate horizontal and vertical padding
3. Added `h-auto` - Allow button to expand to fit content
4. `text-xs` → `text-sm` for label - Slightly larger main text
5. `text-[10px]` → `text-xs` for description - Standard small size

## Visual Comparison

| Aspect | Before | After |
|--------|--------|-------|
| Horizontal padding | ~8px | ~12px |
| Vertical padding | ~6px | ~8px |
| Gap between lines | 2px | 2px |
| Label size | 12px | 14px |
| Description size | 10px | 12px |

## Files Modified
- `apps/web/src/components/editor/media-panel/views/model-type-selector.tsx`

## Priority
Low - Visual polish improvement

## Related Components
- Container already has `p-2` padding which is appropriate
- Parent container uses `gap-2` for spacing between buttons
