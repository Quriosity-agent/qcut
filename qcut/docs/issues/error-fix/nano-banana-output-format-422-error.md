# Nano Banana Model - Output Format 422 Error

## Issue Summary
**Date**: 2025-11-14
**Component**: Adjust Panel - Nano Banana Image Edit Model
**Severity**: Medium
**Status**: Fixed

## Error Description
The Nano Banana image edit model is failing with a 422 HTTP error when attempting to edit images.

### Error Details
```
❌ Edit generation failed: Error: API error: 422 - [{
  "type": "literal_error",
  "loc": ["body", "output_format"],
  "msg": "Input should be 'jpeg', 'png' or 'webp'",
  "input": "PNG",
  "ctx": {"expected": "'jpeg', 'png' or 'webp'"}
}]
```

### Error Logs
```
error-handler.ts:145 🚨 Error ERR-1763100421523-X28TRW [MEDIUM]
Timestamp: 2025-11-14T06:07:01.523Z
Operation: FAL AI image edit request
Category: ai_service
Severity: medium

fal.run/fal-ai/nano-banana/edit:1 Failed to load resource:
the server responded with a status of 422 ()
```

## Root Cause Analysis

### Issue Location
**File**: `apps/web/src/lib/image-edit-client.ts:113`

### Problem
The `output_format` parameter for the Nano Banana model was set to uppercase `"PNG"` in the default parameters, but the FAL API expects lowercase format values.

```typescript
// INCORRECT (Line 113)
"nano-banana": {
  endpoint: "fal-ai/nano-banana/edit",
  defaultParams: {
    num_images: 1,
    output_format: "PNG",  // ❌ Uppercase
    sync_mode: false,
  },
},
```

### API Requirements
According to the FAL API validation error, the `output_format` field accepts only:
- `'jpeg'` (lowercase)
- `'png'` (lowercase)
- `'webp'` (lowercase)

## Solution

### Fix Applied
Changed the default `output_format` value from uppercase to lowercase in `image-edit-client.ts`:

```typescript
// CORRECTED (Line 113)
"nano-banana": {
  endpoint: "fal-ai/nano-banana/edit",
  defaultParams: {
    num_images: 1,
    output_format: "png",  // ✅ Lowercase
    sync_mode: false,
  },
},
```

### Additional Validation
Verified consistency across the codebase:
- `text2image-models.ts:602` - Already using lowercase `"png"` ✅
- `text2image-models.ts:627` - Options array uses lowercase ✅
- Image upload process using base64 data URLs - Working correctly ✅

## Type Safety Improvements

### Updated TypeScript Interface
The `ImageEditRequest` interface in `image-edit-client.ts:35` already defines the correct type:

```typescript
outputFormat?: "JPEG" | "PNG" | "png" | "jpeg" | "webp";
```

However, this allows both uppercase and lowercase variants. Consider standardizing to lowercase only:

```typescript
// RECOMMENDED
outputFormat?: "jpeg" | "png" | "webp";
```

## Impact Assessment

### Affected Features
- ✅ **Nano Banana Image Editing**: Now functional
- ✅ **Adjust Panel**: Can successfully apply edits
- ✅ **Other Models**: Not affected (Reve Edit already uses lowercase)

### Tested Scenarios
- [x] Image upload via base64 data URL
- [x] Nano Banana model parameter submission
- [x] FAL API request/response handling
- [x] Error handling and logging

## Prevention Measures

### Recommendations
1. **Add API Contract Tests**: Validate parameter formats before deployment
2. **Lint Rule**: Consider adding a lint rule to enforce lowercase for API enum values
3. **Type Guards**: Add runtime validation for output format values
4. **Documentation**: Update API integration docs with format requirements

### Code Review Checklist
- [ ] Verify all FAL API enum parameters use lowercase
- [ ] Check other models (SeedDream V4, Reve Edit) for similar issues
- [ ] Add unit tests for parameter formatting
- [ ] Update TypeScript types to prevent uppercase variants

## Related Files
- `apps/web/src/lib/image-edit-client.ts` - Image edit API client
- `apps/web/src/lib/text2image-models.ts` - Model configurations
- `apps/web/src/lib/error-handler.ts` - Error tracking

## References
- FAL API Documentation: [https://fal.run/fal-ai/nano-banana/edit](https://fal.run/fal-ai/nano-banana/edit)
- Error Code: `ERR-1763100421523-X28TRW`
