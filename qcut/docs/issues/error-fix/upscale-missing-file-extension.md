# Upscale Image Missing File Extension Issue

## Issue Summary
**Date**: 2025-11-17
**Component**: AI Images Panel - Image Upscaling
**Location**: Select Upscale Model → Add to Media Panel
**Severity**: Medium
**Status**: Documented

## Problem Description

When users upscale images using the "Select Upscale Model" feature in the AI Images panel, the resulting upscaled image is automatically added to the media panel. However, **the media item name does not include the correct file extension** (`.png`, `.jpeg`, or `.webp`) that corresponds to the selected output format.

### User Impact

- **Missing Extension**: Upscaled images appear in media panel without file extensions
- **Download Issues**: When users download or export these images, the filename may not reflect the actual format
- **File Type Confusion**: Users cannot immediately identify the image format from the filename
- **Metadata Inconsistency**: The actual image format and the filename don't match

### Example Scenario

```
User Actions:
1. Select "Crystal Upscaler" model
2. Choose "PNG" as output format
3. Upload an image to upscale
4. Click "Upscale" button
5. Image successfully upscales
6. Image auto-added to media panel

Expected Filename:
"Upscaled: my beautiful sunset.png"

Actual Filename:
"Upscaled: my beautiful sunset"
```

## Root Cause Analysis

### Issue Location

**File**: `qcut/apps/web/src/stores/text2image-store.ts:590-597`

### Problem Code

```typescript
const mediaItems = resultsToAdd.map((result) => ({
  url: result.imageUrl,
  type: "image" as const,
  name: `${
    result.mode === "upscale" ? "Upscaled" : "Generated"
  }: ${result.prompt.slice(0, 30)}${
    result.prompt.length > 30 ? "..." : ""
  }`,  // ❌ Missing file extension
  size: 0,
  duration: 0,
  metadata: {
    source:
      result.mode === "upscale"
        ? ("image-upscale" as const)
        : ("text2image" as const),
    model: result.modelKey,
    prompt: result.prompt,
    settings: result.settings,
    generatedAt: new Date(),
    mode: result.mode,
  },
}));
```

### Analysis

1. **Name Generation Logic** (Line 593-597):
   - The `name` field is constructed from the mode ("Upscaled" vs "Generated") and prompt text
   - No file extension is appended to the name
   - The output format information is available in `result.settings` but not used

2. **Available Information**:
   - **Output Format**: Available in `result.settings.outputFormat` (e.g., "png", "jpeg", "webp")
   - **Model Info**: Available in `result.modelKey`
   - **Upscale Settings**: All upscale parameters are in `result.settings`

3. **Current Flow**:
   ```
   Upscale Request (Line 466-530)
   ├── upscaleSettings.outputFormat ✅ Available
   ├── Result URL from API ✅ Has extension
   └── Media Item Creation (Line 590-611)
       ├── name: "Upscaled: prompt" ❌ No extension
       └── metadata.settings ✅ Contains outputFormat
   ```

## Affected Code Paths

### 1. Upscale Function
**Location**: `qcut/apps/web/src/stores/text2image-store.ts:466-530`

```typescript
upscaleImage: async (imageUrl, options) => {
  const { upscaleSettings } = get();
  // ... upscale logic ...

  if (response.status === "completed" && response.result_url) {
    const promptLabel = `Upscale ${upscaleSettings.scaleFactor}x`;
    const result: GenerationResult = {
      status: "success",
      imageUrl: response.result_url,
      generatedAt: new Date(),
    };

    await get().addSelectedToMedia([
      {
        modelKey: request.model,
        imageUrl: response.result_url,
        prompt: promptLabel,
        settings: request,  // ✅ Contains outputFormat
        mode: "upscale",
      },
    ]);

    // ... history update ...
  }
  // ...
};
```

### 2. Media Item Creation
**Location**: `qcut/apps/web/src/stores/text2image-store.ts:535-640`

```typescript
addSelectedToMedia: async (results) => {
  // ...
  const mediaItems = resultsToAdd.map((result) => ({
    url: result.imageUrl,
    type: "image" as const,
    name: `${result.mode === "upscale" ? "Upscaled" : "Generated"}: ${result.prompt.slice(0, 30)}${result.prompt.length > 30 ? "..." : ""}`,
    // ⚠️ Should append: `.${result.settings?.outputFormat || 'png'}`
    metadata: {
      source: result.mode === "upscale" ? "image-upscale" : "text2image",
      model: result.modelKey,
      prompt: result.prompt,
      settings: result.settings,  // Contains outputFormat
      mode: result.mode,
    },
  }));

  await addGeneratedImages(mediaItems);
};
```

### 3. Upscale Settings Management
**Location**: `qcut/apps/web/src/stores/text2image-store.ts:259-271`

```typescript
upscaleSettings: DEFAULT_UPSCALE_SETTINGS,
setUpscaleSettings: (settings) =>
  set((state) => {
    const nextSettings = computeUpscaleSettings(
      state.upscaleSettings,
      settings
    );
    // Settings include: scaleFactor, denoise, creativity, overlappingTiles, outputFormat
    return { upscaleSettings: nextSettings };
  }),
```

### 4. Upscale Models Configuration
**Location**: `qcut/apps/web/src/lib/upscale-models.ts:167-355`

```typescript
export const UPSCALE_MODELS: Record<UpscaleModelId, UpscaleModel> = {
  "crystal-upscaler": {
    // ...
    defaultParams: {
      scale_factor: 4,
      denoise: 0.45,
      output_format: "png",  // ✅ Default format
    },
    // ...
  },
  // ... other models
};
```

## Solution Design

### Proposed Fix

Modify the `name` field generation in `addSelectedToMedia` to include the file extension based on the output format:

```typescript
// Current (Line 593-597)
name: `${
  result.mode === "upscale" ? "Upscaled" : "Generated"
}: ${result.prompt.slice(0, 30)}${
  result.prompt.length > 30 ? "..." : ""
}`,

// Proposed Fix
name: `${
  result.mode === "upscale" ? "Upscaled" : "Generated"
}: ${result.prompt.slice(0, 30)}${
  result.prompt.length > 30 ? "..." : ""
}${getFileExtension(result)}`,
```

### Helper Function

```typescript
/**
 * Extracts the appropriate file extension for a generated/upscaled image
 * @param result - The generation result containing settings and metadata
 * @returns File extension with leading dot (e.g., ".png", ".jpeg", ".webp")
 */
function getFileExtension(result: SelectedResult): string {
  // For upscaled images, use the outputFormat from settings
  if (result.mode === "upscale" && result.settings?.outputFormat) {
    return `.${result.settings.outputFormat}`;
  }

  // For generated images, check model default or settings
  if (result.settings?.output_format) {
    return `.${result.settings.output_format}`;
  }

  // Fallback to .png as default
  return ".png";
}
```

### Implementation Steps

1. **Add Helper Function** to `text2image-store.ts`
   - Create `getFileExtension()` helper
   - Handle both upscale and generation modes
   - Provide sensible fallback

2. **Update Name Generation**
   - Modify line 593-597 to append extension
   - Test with all three output formats (png, jpeg, webp)
   - Ensure backward compatibility

3. **Handle Edge Cases**
   - Missing `outputFormat` in settings → fallback to `.png`
   - Very long prompt + extension → ensure total length is reasonable
   - Special characters in prompt → sanitize for valid filename

4. **Update Tests**
   - Test upscale with PNG format
   - Test upscale with JPEG format
   - Test upscale with WebP format
   - Test generated images (non-upscale mode)
   - Test missing settings scenario

## Testing Checklist

### Manual Testing

- [ ] **Crystal Upscaler**
  - [ ] Upscale with PNG output → Check filename ends with `.png`
  - [ ] Upscale with JPEG output → Check filename ends with `.jpeg`
  - [ ] Upscale with WebP output → Check filename ends with `.webp`

- [ ] **SeedVR Upscale**
  - [ ] Upscale with PNG output → Verify extension
  - [ ] Upscale with JPEG output → Verify extension
  - [ ] Upscale with WebP output → Verify extension

- [ ] **Topaz Upscale**
  - [ ] Upscale with PNG output → Verify extension
  - [ ] Upscale with JPEG output → Verify extension
  - [ ] Upscale with WebP output → Verify extension

- [ ] **Media Panel Integration**
  - [ ] Verify upscaled images appear in media panel
  - [ ] Check filename displays correctly with extension
  - [ ] Download upscaled image → Verify correct file extension
  - [ ] Drag upscaled image to timeline → Works correctly

- [ ] **Edge Cases**
  - [ ] Very long prompt (> 30 chars) → Extension still appended
  - [ ] Empty prompt → Fallback name with extension
  - [ ] Special characters in prompt → Valid filename generated

### Automated Testing

```typescript
describe("Upscale Image File Extension", () => {
  it("should append .png extension for PNG output format", async () => {
    const result = {
      mode: "upscale",
      prompt: "Test upscale",
      imageUrl: "https://example.com/image.png",
      settings: { outputFormat: "png" },
    };

    const mediaItem = createMediaItem(result);
    expect(mediaItem.name).toContain(".png");
  });

  it("should append .jpeg extension for JPEG output format", async () => {
    const result = {
      mode: "upscale",
      prompt: "Test upscale",
      imageUrl: "https://example.com/image.jpeg",
      settings: { outputFormat: "jpeg" },
    };

    const mediaItem = createMediaItem(result);
    expect(mediaItem.name).toContain(".jpeg");
  });

  it("should append .webp extension for WebP output format", async () => {
    const result = {
      mode: "upscale",
      prompt: "Test upscale",
      imageUrl: "https://example.com/image.webp",
      settings: { outputFormat: "webp" },
    };

    const mediaItem = createMediaItem(result);
    expect(mediaItem.name).toContain(".webp");
  });

  it("should fallback to .png when outputFormat is missing", async () => {
    const result = {
      mode: "upscale",
      prompt: "Test upscale",
      imageUrl: "https://example.com/image",
      settings: {},
    };

    const mediaItem = createMediaItem(result);
    expect(mediaItem.name).toContain(".png");
  });
});
```

## Related Files

- **Main Issue**: `qcut/apps/web/src/stores/text2image-store.ts:590-597`
- **Upscale Logic**: `qcut/apps/web/src/stores/text2image-store.ts:466-530`
- **Model Config**: `qcut/apps/web/src/lib/upscale-models.ts`
- **Settings Panel**: `qcut/apps/web/src/components/editor/media-panel/views/upscale-settings.tsx`
- **Upscale Hook**: `qcut/apps/web/src/components/editor/media-panel/views/use-upscale-generation.ts`
- **Image Edit Client**: `qcut/apps/web/src/lib/image-edit-client.ts`

## Additional Considerations

### Filename Sanitization

When implementing the fix, consider sanitizing the entire filename:

```typescript
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "") // Remove invalid chars
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}
```

### Length Limits

Ensure the total filename length doesn't exceed filesystem limits:

```typescript
const MAX_FILENAME_LENGTH = 255; // Common filesystem limit

function truncateFilename(name: string, extension: string): string {
  const maxNameLength = MAX_FILENAME_LENGTH - extension.length;
  if (name.length > maxNameLength) {
    return name.substring(0, maxNameLength - 3) + "..." + extension;
  }
  return name + extension;
}
```

### Metadata Preservation

The fix should preserve all existing metadata:

```typescript
metadata: {
  source: result.mode === "upscale" ? "image-upscale" : "text2image",
  model: result.modelKey,
  prompt: result.prompt,
  settings: result.settings,
  generatedAt: new Date(),
  mode: result.mode,
  // Consider adding:
  originalOutputFormat: result.settings?.outputFormat,
  fileExtension: getFileExtension(result),
}
```

## Prevention Measures

### Code Review Checklist

- [ ] Verify file extension is included in all media item names
- [ ] Check that extension matches the actual image format
- [ ] Ensure extension is lowercase (`.png` not `.PNG`)
- [ ] Test with all supported output formats
- [ ] Validate filename length and special characters

### Documentation Updates

- [ ] Update API documentation for media item structure
- [ ] Document expected filename format in media store
- [ ] Add examples of valid vs invalid filenames
- [ ] Update user guide with file format information

### Future Improvements

1. **Extract extension from URL**: As a fallback, parse the extension from `result.imageUrl`
2. **Format detection**: Use image headers to detect actual format if metadata is missing
3. **User preference**: Allow users to customize filename templates
4. **Format conversion**: Add option to convert format when adding to media

## References

- **Upscale Models**: [upscale-models.ts](../../../apps/web/src/lib/upscale-models.ts)
- **Text2Image Store**: [text2image-store.ts](../../../apps/web/src/stores/text2image-store.ts)
- **FAL API Docs**: https://fal.ai/models
- **Image Edit Client**: [image-edit-client.ts](../../../apps/web/src/lib/image-edit-client.ts)

## Notes

- This issue affects **all three upscale models** (Crystal, SeedVR, Topaz)
- The problem is purely cosmetic but affects **user experience**
- The actual image format is correct (determined by API), only the filename is missing the extension
- The fix should be applied to **both upscale and text2image generation** for consistency
