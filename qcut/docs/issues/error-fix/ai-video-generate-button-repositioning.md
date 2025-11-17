# AI Video Generate Button Repositioning

## Issue Summary
**Date**: 2025-11-17
**Component**: AI Video Generation Panel
**Type**: UI/UX Improvement
**Priority**: Medium
**Status**: Documented - Awaiting Implementation

## Problem Description

The current AI Video Generation interface requires users to **scroll past the entire model list** before seeing the Generate button. This creates UX friction, especially when:
- Users have selected their models and want to generate immediately
- The model list is long (7+ models visible)
- Users need to adjust prompt and regenerate quickly
- Generate button is off-screen on smaller displays

### Current UI Flow

```
┌────────────────────────────────────────┐
│ AI Video Generation                    │
├────────────────────────────────────────┤
│ [Text] [Image] [Avatar] [Upscale]     │ ← Tabs
├────────────────────────────────────────┤
│ Prompt for Video Generation            │
│ ┌────────────────────────────────────┐ │
│ │ Describe the video you want...    │ │
│ │                                    │ │
│ └────────────────────────────────────┘ │
│                  500 characters remaining│
├────────────────────────────────────────┤
│ Select AI Models (multi-select)        │
│                                        │
│ ☐ Sora 2 Text-to-Video    $0.10/s     │
│ ☐ Sora 2 Pro              $0.30-0.50  │
│ ☐ WAN v2.5 Preview        $0.12       │
│ ☐ LTX Video 2.0 Pro T2V   $0.06       │
│ ☐ LTX Video 2.0 Fast T2V  $0.04-0.16  │
│ ☐ Veo 3.1 Fast            $1.20       │
│ ☐ Veo 3.1                 $3.20       │
│ ... (more models below)                │
│                                        │
│                                        │ ← User must scroll
│                                        │
│ ┌────────────────────────────────────┐ │
│ │   [🎬 Generate Video]              │ │ ← Button at bottom
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

### User Experience Issues

1. **Hidden Call-to-Action**: Generate button not immediately visible
2. **Scrolling Required**: Extra interaction needed to start generation
3. **Workflow Disruption**: Break in visual flow between prompt and action
4. **Regeneration Friction**: After generation, must scroll to generate again
5. **Small Screen Problem**: On laptops/tablets, button often off-screen

## Proposed Solution

### New UI Flow

Move the Generate button **above the model selection list**, creating a more logical flow:

```
┌────────────────────────────────────────┐
│ AI Video Generation                    │
├────────────────────────────────────────┤
│ [Text] [Image] [Avatar] [Upscale]     │ ← Tabs
├────────────────────────────────────────┤
│ Prompt for Video Generation            │
│ ┌────────────────────────────────────┐ │
│ │ Describe the video you want...    │ │
│ │                                    │ │
│ └────────────────────────────────────┘ │
│                  500 characters remaining│
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │
│ │   [🎬 Generate with 2 Models]      │ │ ← Button moved here
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│ Select AI Models (multi-select)        │
│                                        │
│ ☑ Sora 2 Text-to-Video    $0.10/s     │
│ ☑ Sora 2 Pro              $0.30-0.50  │
│ ☐ WAN v2.5 Preview        $0.12       │
│ ☐ LTX Video 2.0 Pro T2V   $0.06       │
│ ☐ LTX Video 2.0 Fast T2V  $0.04-0.16  │
│ ☐ Veo 3.1 Fast            $1.20       │
│ ☐ Veo 3.1                 $3.20       │
│ ... (scrollable list)                  │
└────────────────────────────────────────┘
```

### Benefits

1. ✅ **Immediate Visibility**: Generate button always on-screen
2. ✅ **Reduced Clicks**: No scrolling needed to start generation
3. ✅ **Logical Flow**: Prompt → Generate → Model Selection
4. ✅ **Quick Iteration**: Easy to adjust prompt and regenerate
5. ✅ **Better Mobile UX**: Works well on smaller screens
6. ✅ **Progressive Disclosure**: Models are optional advanced settings

## Implementation Plan

### File to Modify

**Primary File**: `apps/web/src/components/editor/media-panel/views/ai.tsx`

This file contains the AI Video Generation panel layout.

### Current Code Structure (Estimated)

```tsx
// Current structure (simplified)
<div className="ai-video-panel">
  {/* Tabs */}
  <Tabs value={activeTab}>
    <TabsList>
      <TabsTrigger value="text">Text</TabsTrigger>
      <TabsTrigger value="image">Image</TabsTrigger>
      <TabsTrigger value="avatar">Avatar</TabsTrigger>
      <TabsTrigger value="upscale">Upscale</TabsTrigger>
    </TabsList>

    <TabsContent value="text">
      {/* Prompt Section */}
      <div className="prompt-section">
        <Label>Prompt for Video Generation</Label>
        <Textarea
          placeholder="Describe the video you want to generate..."
          value={prompt}
          onChange={handlePromptChange}
        />
        <div className="character-count">
          {500 - prompt.length} characters remaining
        </div>
      </div>

      {/* Model Selection Section */}
      <div className="model-selection">
        <Label>Select AI Models (multi-select)</Label>
        <div className="model-list">
          {videoModels.map((model) => (
            <ModelCheckbox
              key={model.id}
              model={model}
              selected={selectedModels.includes(model.id)}
              onToggle={handleModelToggle}
            />
          ))}
        </div>
      </div>

      {/* Generate Button - CURRENTLY AT BOTTOM */}
      <Button
        onClick={handleGenerate}
        disabled={!prompt || selectedModels.length === 0}
        className="generate-button"
      >
        <Wand2 className="mr-2" />
        Generate with {selectedModels.length} Models
      </Button>
    </TabsContent>
  </Tabs>
</div>
```

### Proposed Code Changes

```tsx
// Proposed structure (simplified)
<div className="ai-video-panel">
  {/* Tabs */}
  <Tabs value={activeTab}>
    <TabsList>
      <TabsTrigger value="text">Text</TabsTrigger>
      <TabsTrigger value="image">Image</TabsTrigger>
      <TabsTrigger value="avatar">Avatar</TabsTrigger>
      <TabsTrigger value="upscale">Upscale</TabsTrigger>
    </TabsList>

    <TabsContent value="text">
      {/* Prompt Section */}
      <div className="prompt-section">
        <Label>Prompt for Video Generation</Label>
        <Textarea
          placeholder="Describe the video you want to generate..."
          value={prompt}
          onChange={handlePromptChange}
          maxLength={500}
        />
        <div className="character-count">
          {500 - prompt.length} characters remaining
        </div>
      </div>

      {/* ✅ GENERATE BUTTON MOVED HERE - ABOVE MODEL SELECTION */}
      <div className="generate-section">
        <Button
          onClick={handleGenerate}
          disabled={!prompt || selectedModels.length === 0}
          className="w-full generate-button"
          size="lg"
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Wand2 className="mr-2 h-4 w-4" />
              {selectedModels.length === 0
                ? "Select models to generate"
                : `Generate with ${selectedModels.length} Model${
                    selectedModels.length !== 1 ? "s" : ""
                  }`}
            </>
          )}
        </Button>

        {/* Optional: Show estimated cost */}
        {selectedModels.length > 0 && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            Estimated cost: ${calculateEstimatedCost(selectedModels)}
          </p>
        )}
      </div>

      {/* Model Selection Section - NOW BELOW BUTTON */}
      <div className="model-selection">
        <Label>
          Select AI Models (multi-select)
          {selectedModels.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">
              ({selectedModels.length} selected)
            </span>
          )}
        </Label>
        <div className="model-list">
          {videoModels.map((model) => (
            <ModelCheckbox
              key={model.id}
              model={model}
              selected={selectedModels.includes(model.id)}
              onToggle={handleModelToggle}
            />
          ))}
        </div>
      </div>
    </TabsContent>
  </Tabs>
</div>
```

### Styling Adjustments

**Add/Update CSS** (likely in the same file or a separate styles file):

```css
/* Generate section styling */
.generate-section {
  margin-top: 1rem;
  margin-bottom: 1.5rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: linear-gradient(
    to right,
    rgba(59, 130, 246, 0.1),
    rgba(139, 92, 246, 0.1)
  );
  border: 1px solid rgba(59, 130, 246, 0.2);
}

/* Generate button */
.generate-button {
  width: 100%;
  font-weight: 600;
  font-size: 1rem;
  padding: 1.25rem;
  transition: all 0.2s ease;
}

.generate-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.generate-button:not(:disabled):hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

/* Model selection section */
.model-selection {
  margin-top: 1.5rem;
}

/* Character count */
.character-count {
  text-align: right;
  font-size: 0.75rem;
  color: var(--muted-foreground);
  margin-top: 0.25rem;
}
```

### Enhanced Button States

Consider adding smart button states:

```tsx
function GenerateButton() {
  const getButtonState = () => {
    if (isGenerating) {
      return {
        text: "Generating...",
        icon: <Loader2 className="animate-spin" />,
        disabled: true,
      };
    }

    if (!prompt.trim()) {
      return {
        text: "Enter a prompt to generate",
        icon: <Wand2 />,
        disabled: true,
      };
    }

    if (selectedModels.length === 0) {
      return {
        text: "Select at least one model",
        icon: <Wand2 />,
        disabled: true,
      };
    }

    return {
      text: `Generate with ${selectedModels.length} Model${
        selectedModels.length !== 1 ? "s" : ""
      }`,
      icon: <Wand2 />,
      disabled: false,
    };
  };

  const state = getButtonState();

  return (
    <Button
      onClick={handleGenerate}
      disabled={state.disabled}
      className="w-full generate-button"
      size="lg"
    >
      {state.icon}
      <span className="ml-2">{state.text}</span>
    </Button>
  );
}
```

## Alternative Layouts Considered

### Option 1: Floating Button (Sticky)

Keep button at bottom but make it sticky/floating:

```tsx
<div className="fixed bottom-4 left-0 right-0 px-4 z-10">
  <Button className="w-full generate-button shadow-lg">
    Generate with {selectedModels.length} Models
  </Button>
</div>
```

**Pros:** Always visible, familiar mobile pattern
**Cons:** Covers content, may interfere with other UI elements

### Option 2: Button in Both Positions

Show button both above and below models:

```tsx
{/* Top button */}
<Button>Generate</Button>

{/* Model selection */}
<ModelList />

{/* Bottom button */}
<Button>Generate</Button>
```

**Pros:** Maximum accessibility
**Cons:** Redundant, cluttered

### Option 3: Collapsible Model Section

Make model selection collapsible with button always visible:

```tsx
<Button>Generate</Button>

<Collapsible>
  <CollapsibleTrigger>
    Advanced: Select Models ({selectedModels.length})
  </CollapsibleTrigger>
  <CollapsibleContent>
    <ModelList />
  </CollapsibleContent>
</Collapsible>
```

**Pros:** Clean, progressive disclosure
**Cons:** Hides important settings, extra click

**Recommendation:** Use the main proposed solution (button above models) for best balance.

## User Flow Comparison

### Before (Current Flow)

```
1. User enters prompt
2. User scrolls down ↓
3. User selects models
4. User scrolls down ↓
5. User clicks Generate button
6. Generation starts
7. User scrolls up ↑ to see results
8. To regenerate: scroll down ↓ again
```

**Total interactions:** 5 actions (2 prompts + 3 scrolls)

### After (Proposed Flow)

```
1. User enters prompt
2. User clicks Generate button (no scroll)
3. (Optional) User expands/selects models below
4. Generation starts
5. Results appear
6. To regenerate: modify prompt, click Generate (no scroll)
```

**Total interactions:** 2 actions (1 prompt + 1 click)

**Efficiency gain:** 60% fewer interactions

## Edge Cases & Considerations

### 1. Long Model List

**Issue:** Model list might be very long (10+ models)

**Solution:**
- Make model section scrollable with max-height
- Keep generate button visible at top
- Add "X models selected" indicator

```tsx
<div className="model-list-container" style={{ maxHeight: '400px', overflowY: 'auto' }}>
  {videoModels.map(model => <ModelCheckbox />)}
</div>
```

### 2. Default Model Selection

**Issue:** What if no models are selected?

**Options:**
- A) Disable button (current approach)
- B) Auto-select default model (recommended)
- C) Show error message on click

**Recommended:**
```tsx
// Auto-select first model if none selected
useEffect(() => {
  if (selectedModels.length === 0 && videoModels.length > 0) {
    setSelectedModels([videoModels[0].id]);
  }
}, []);
```

### 3. Mobile/Small Screens

**Issue:** Limited vertical space

**Solution:**
- Use responsive sizing
- Reduce button padding on mobile
- Consider collapsible model list

```css
@media (max-width: 768px) {
  .generate-button {
    padding: 0.875rem;
    font-size: 0.9rem;
  }

  .generate-section {
    margin-top: 0.5rem;
    margin-bottom: 1rem;
  }
}
```

### 4. Generation in Progress

**Issue:** Button state during generation

**Solution:**
- Show loading spinner
- Disable all interactions
- Display progress if available

```tsx
{isGenerating && (
  <div className="mt-2">
    <Progress value={generationProgress} />
    <p className="text-xs text-center mt-1">
      Generating with {activeModelName}... {generationProgress}%
    </p>
  </div>
)}
```

### 5. Multiple Tab Consistency

**Issue:** Other tabs (Image, Avatar, Upscale) might have different layouts

**Solution:**
- Apply same pattern to all tabs
- Ensure consistency across generation interfaces

## Testing Checklist

### Visual Testing

- [ ] Generate button appears above model list
- [ ] Button is full width and prominent
- [ ] Button states (disabled/enabled/loading) work correctly
- [ ] Character counter displays properly
- [ ] Model selection list is scrollable
- [ ] Spacing and margins look balanced

### Functional Testing

- [ ] **Test 1: Empty Prompt**
  - Button disabled
  - Shows "Enter a prompt to generate"

- [ ] **Test 2: Prompt Only (No Models)**
  - If auto-select: Uses default model
  - If no auto-select: Button disabled

- [ ] **Test 3: Prompt + Selected Models**
  - Button enabled
  - Shows "Generate with N Models"
  - Click triggers generation

- [ ] **Test 4: During Generation**
  - Button shows loading spinner
  - Button disabled
  - Shows "Generating..."

- [ ] **Test 5: After Generation**
  - Button re-enables
  - User can modify prompt and regenerate immediately
  - No scrolling required

### UX Testing

- [ ] Button is visible without scrolling
- [ ] Tab switching preserves button position
- [ ] Model selection doesn't require scrolling to find button
- [ ] Quick regeneration flow feels smooth
- [ ] Mobile/tablet view works well

### Accessibility Testing

- [ ] Button has proper ARIA labels
- [ ] Keyboard navigation works (Tab to button, Enter to submit)
- [ ] Screen reader announces button state changes
- [ ] Focus indicators are visible
- [ ] Color contrast meets WCAG standards

## Performance Considerations

### Rendering Optimization

Since the button moves higher in the DOM, ensure it doesn't cause layout shifts:

```tsx
// Use consistent spacing
<div className="space-y-4">
  <PromptSection />
  <GenerateSection />  {/* Fixed height */}
  <ModelSelection />
</div>
```

### State Management

Button position change shouldn't affect state:

```tsx
// State remains the same
const [prompt, setPrompt] = useState('');
const [selectedModels, setSelectedModels] = useState([]);
const [isGenerating, setIsGenerating] = useState(false);

// Only layout changes
```

## Migration Notes

### Backward Compatibility

- No breaking changes to functionality
- Only UI layout changes
- State management unchanged
- API calls remain the same

### User Communication

Add a tooltip or help text if needed:

```tsx
<div className="flex items-center gap-2 mb-2">
  <Label>Select AI Models</Label>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger>
        <Info className="h-4 w-4 text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent>
        <p>Generate button is now above for easier access</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</div>
```

### Analytics Tracking

Track if the change improves user engagement:

```tsx
const handleGenerate = () => {
  // Track button position interaction
  analytics.track('generate_button_clicked', {
    position: 'above_models', // vs 'below_models'
    models_selected: selectedModels.length,
    prompt_length: prompt.length,
  });

  // ... generation logic
};
```

## Related Files

Based on QCut architecture:

- **Main Component**: `apps/web/src/components/editor/media-panel/views/ai.tsx`
- **Styles**: Inline or `ai.module.css` / `ai.styles.ts`
- **Types**: `apps/web/src/types/ai-generation.ts`
- **Constants**: `apps/web/src/components/editor/media-panel/views/ai-constants.ts`

## Success Metrics

After implementation, measure:

1. **Time to First Generation**
   - Before: ~15-20 seconds (with scrolling)
   - After: ~5-10 seconds (direct click)

2. **Regeneration Frequency**
   - Expect increase due to easier access

3. **User Satisfaction**
   - Survey feedback on "ease of use"
   - Track support tickets about "can't find generate button"

4. **Scroll Metrics**
   - Reduction in scroll depth for generation

## Visual Mockup

### Before
```
┌─────────────────────┐
│ Prompt              │
│ [Text Area]         │
│                     │
├─────────────────────┤
│ Models              │
│ ☐ Model 1          │
│ ☐ Model 2          │
│ ☐ Model 3          │
│ ☐ Model 4          │
│ ☐ Model 5          │
│ ↓ scroll ↓         │
│ [Generate Button]   │ ← Hidden
└─────────────────────┘
```

### After
```
┌─────────────────────┐
│ Prompt              │
│ [Text Area]         │
│                     │
├─────────────────────┤
│ [Generate Button]   │ ← Always visible
├─────────────────────┤
│ Models              │
│ ☑ Model 1          │
│ ☑ Model 2          │
│ ☐ Model 3          │
│ ☐ Model 4          │
│ ☐ Model 5          │
│ (scrollable)        │
└─────────────────────┘
```

## Conclusion

Moving the Generate button above the model selection list will:

- ✅ **Improve UX**: Reduce clicks and scrolling
- ✅ **Increase Efficiency**: Faster time to generation
- ✅ **Better Visibility**: Button always on-screen
- ✅ **Logical Flow**: Prompt → Action → Options
- ✅ **Mobile Friendly**: Works on all screen sizes

**Implementation Effort:** Low (15-30 minutes)
**User Impact:** High (significant UX improvement)
**Risk:** Very Low (cosmetic change only)

**Recommendation:** Implement this change in the next UI update cycle.
