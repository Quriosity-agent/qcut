# Generation/Upscale Button Spacing Issue

## Summary
The Generation and Upscale toggle buttons in the AI Images panel have insufficient padding around the text, making them look cramped and less visually appealing.

## Current State
- Location: `apps/web/src/components/editor/media-panel/views/model-type-selector.tsx`
- The buttons use `size="sm"` with minimal internal spacing
- Text appears too close to button edges
- Visual hierarchy between label and description is weak

## Screenshot
![Current button spacing](../assets/generation-upscale-current.png)

**Current styling:**
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

## Proposed Fix

### Option 1: Increase Button Padding
Add explicit padding to create more breathing room:

```tsx
<Button
  size="sm"
  className={cn(
    "flex-1 flex-col items-start gap-1 px-4 py-3 h-auto",
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

### Key Changes
1. `gap-0.5` → `gap-1` - More space between label and description
2. Add `px-4 py-3` - Explicit horizontal and vertical padding
3. Add `h-auto` - Allow button to expand to fit content
4. `text-xs` → `text-sm` for label - Slightly larger main text
5. `text-[10px]` → `text-xs` for description - Standard small size

### Option 2: Use Medium Size Button
```tsx
<Button
  size="default" // or remove size prop entirely
  className={cn(
    "flex-1 flex-col items-start gap-1",
    ...
  )}
>
```

## Visual Comparison

| Aspect | Before | After |
|--------|--------|-------|
| Horizontal padding | ~8px | ~16px |
| Vertical padding | ~6px | ~12px |
| Gap between lines | 2px | 4px |
| Label size | 12px | 14px |
| Description size | 10px | 12px |

## Files to Modify
- `apps/web/src/components/editor/media-panel/views/model-type-selector.tsx`

## Priority
Low - Visual polish improvement

## Related Components
- Container already has `p-2` padding which is appropriate
- Parent container uses `gap-2` for spacing between buttons
