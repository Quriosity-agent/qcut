# Sora 2 Duration Validation Error (422)

## Error Summary

**Error Type**: FAL.ai API Validation Error (422 Unprocessable Entity)
**Model**: Sora 2 Text-to-Video
**Timestamp**: 2025-11-17T07:23:26.023Z
**Severity**: Medium

## Error Message

```
Invalid request parameters: {
  "detail": [
    {
      "loc": ["body", "duration"],
      "msg": "unexpected value; permitted: 4, 8, 12",
      "type": "value_error.const",
      "ctx": {
        "given": 6,
        "permitted": [4, 8, 12]
      }
    }
  ]
}
```

## Root Cause Analysis

### What Happened

1. **User selected duration**: 6 seconds (from the Duration dropdown in Additional Settings)
2. **API call sent**: `duration: 6` to `fal-ai/sora-2/text-to-video` endpoint
3. **API rejected**: Sora 2 model only accepts **4, 8, or 12 seconds** for duration
4. **Configuration mismatch**: Our UI configuration allowed durations [2, 3, 4, 5, 6] but the actual API only supports [4, 8, 12]

### Where It Happened

**File**: `qcut/apps/web/src/components/editor/media-panel/views/use-ai-generation.ts`
- **Line**: ~902 - Video generation request with invalid duration parameter

**Configuration File**: `qcut/apps/web/src/components/editor/media-panel/views/text2video-models-config.ts`
- **Issue**: Incorrect `supportedDurations` array for `sora2_text_to_video`

## Call Stack

```
Error: FAL Queue Submit Error: 422
  at mx (ai-video-client.ts:593:9)
  at async use-ai-generation.ts:902:24
```

## Why This Error Occurred

The unified controls feature was implemented with generic duration options [2, 3, 4, 5, 6] based on common video generation standards, but **Sora 2 has specific duration constraints** that were not properly researched during implementation:

- **Assumed**: Standard 2-6 second range in 1-second increments
- **Reality**: Sora 2 only supports fixed durations: **4s, 8s, 12s**

## Impact

- **User Experience**: Users can select invalid durations from the dropdown
- **API Calls**: Failed video generation requests waste API credits
- **Error Handling**: Generic error message doesn't explain why the request failed

## Fix Implementation

### Step 1: Update Model Capabilities Configuration

**File**: `qcut/apps/web/src/components/editor/media-panel/views/text2video-models-config.ts`

**Change**:
```typescript
// BEFORE (Incorrect)
sora2_text_to_video: {
  supportsAspectRatio: true,
  supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  supportsResolution: true,
  supportedResolutions: ["720p", "1080p"],
  supportsDuration: true,
  supportedDurations: [2, 3, 4, 5, 6], // ❌ WRONG
  defaultDuration: 5, // ❌ WRONG - not a valid option
  // ...
}

// AFTER (Correct)
sora2_text_to_video: {
  supportsAspectRatio: true,
  supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  supportsResolution: true,
  supportedResolutions: ["720p", "1080p"],
  supportsDuration: true,
  supportedDurations: [4, 8, 12], // ✅ CORRECT - matches API spec
  defaultDuration: 4, // ✅ CORRECT - shortest valid duration
  // ...
}
```

### Step 2: Verify Duration Control Rendering

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

The duration control should automatically update when `supportedDurations` changes:

```typescript
// Duration control (around line 1135)
{modelCapabilities?.supportsDuration && (
  <div className="space-y-2">
    <Label htmlFor="t2v-duration" className="flex items-center gap-2">
      Duration <Info className="h-4 w-4 text-muted-foreground" />
    </Label>
    <Select
      value={t2vDuration.toString()}
      onValueChange={(val) => setT2vDuration(Number(val))}
    >
      <SelectTrigger id="t2v-duration">
        <SelectValue placeholder="Select duration" />
      </SelectTrigger>
      <SelectContent>
        {modelCapabilities.supportedDurations?.map((duration) => (
          <SelectItem key={duration} value={duration.toString()}>
            {duration} seconds
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
)}
```

**Expected behavior after fix**:
- When Sora 2 is selected: Dropdown shows **"4 seconds", "8 seconds", "12 seconds"**
- Default selection: **4 seconds** (first valid option)

### Step 3: Update Default State Value

**File**: `qcut/apps/web/src/components/editor/media-panel/views/ai.tsx`

**Change**:
```typescript
// BEFORE
const [t2vDuration, setT2vDuration] = useState<number>(5); // ❌ Invalid for Sora 2

// AFTER
const [t2vDuration, setT2vDuration] = useState<number>(4); // ✅ Valid for all models
```

**Rationale**: Default to 4 seconds since it's the shortest duration supported by Sora 2 and likely supported by other models as well.

## Verification Steps

### 1. Code Changes
```bash
cd qcut/apps/web/src/components/editor/media-panel/views
# Edit text2video-models-config.ts - update supportedDurations and defaultDuration
# Edit ai.tsx - update default useState value to 4
```

### 2. Rebuild
```bash
cd qcut
bun run build
```

### 3. Test in Electron
```bash
bun run electron:dev
```

**Test scenario**:
1. Open AI panel → Text-to-Video
2. Select "Sora 2 Text-to-Video" model
3. Click "Additional Settings" to expand
4. Verify Duration dropdown shows: **4, 8, 12** (not 2, 3, 4, 5, 6)
5. Default selection should be **4 seconds**
6. Generate a video with prompt
7. Verify no 422 error occurs

### 4. API Validation
- Monitor console logs for successful queue submission
- Verify no "unexpected value; permitted: 4, 8, 12" error
- Confirm video generation completes successfully

## Related Files

| File | Purpose | Modification |
|------|---------|--------------|
| `text2video-models-config.ts:15-30` | Model capability definitions | Update `supportedDurations` and `defaultDuration` |
| `ai.tsx:172` | State initialization | Update default `t2vDuration` to 4 |
| `ai.tsx:1135-1155` | Duration UI control | Automatically renders correct options |
| `use-ai-generation.ts:740-743` | Duration parameter passing | No changes needed |

## API Documentation Reference

**Sora 2 Text-to-Video Endpoint**: `fal-ai/sora-2/text-to-video`

**Duration Parameter**:
- **Type**: Integer (seconds)
- **Valid values**: `4`, `8`, `12`
- **Default**: `4`
- **Description**: Length of the generated video in seconds

**Other models to verify**:
- Check if other text-to-video models have similar constraints
- Update their `supportedDurations` arrays accordingly
- Consult FAL.ai documentation for each model's specific requirements

## Prevention Strategy

### 1. API Documentation Review
Before implementing unified controls for new models:
- Read the official FAL.ai API documentation
- Note exact parameter constraints (permitted values, ranges)
- Don't assume standard ranges apply universally

### 2. Configuration-Driven UI
The current implementation is correct:
- ✅ UI reads from `supportedDurations` array
- ✅ Only shows valid options for each model
- ✅ Model-specific capabilities prevent invalid combinations

### 3. Validation Testing
Add validation tests:
```typescript
// Example test case
describe('Sora 2 Model Configuration', () => {
  it('should only allow valid durations', () => {
    const config = T2V_MODEL_CAPABILITIES.sora2_text_to_video;
    expect(config.supportedDurations).toEqual([4, 8, 12]);
    expect(config.defaultDuration).toBe(4);
  });
});
```

### 4. Error Message Enhancement
Consider adding user-friendly error messages:
```typescript
// In error handler
if (error.message.includes('permitted:')) {
  const match = error.message.match(/permitted: ([\d,\s]+)/);
  if (match) {
    return `Invalid duration. This model only supports: ${match[1]} seconds`;
  }
}
```

## Estimated Fix Time

- **Configuration update**: 2 minutes
- **Default state update**: 1 minute
- **Build and test**: 5 minutes
- **Total**: ~8 minutes

## Status

- [ ] Update `text2video-models-config.ts` with correct durations
- [ ] Update default `t2vDuration` state value to 4
- [ ] Build and verify no TypeScript errors
- [ ] Test in Electron with Sora 2 model
- [ ] Verify other models' duration constraints
- [ ] Commit changes

## Related Issues

- Text-to-video unified controls implementation (completed)
- Other models may have similar undocumented constraints
- Need systematic API documentation review for all 11+ models
