# Test Media Fixtures

This directory contains test media files for E2E testing.

## Required Test Files:

- `sample-video.mp4` - Small test video file (< 5MB) for upload testing
- `sample-audio.mp3` - Small test audio file (< 1MB) for audio testing
- `sample-image.png` - Small test image (< 500KB) for image testing

## Note:

These files should be small, non-copyrighted, and suitable for automated testing.
They are used to verify media import, timeline operations, and export functionality.

## Usage in Tests:

```typescript
// Example usage in E2E tests
await page.setInputFiles('[data-testid="file-input"]', 'src/test/e2e/fixtures/media/sample-video.mp4');
```

## Creating Test Files:

You can create simple test media files using ffmpeg:

```bash
# Create 5-second test video (720p, 30fps)
ffmpeg -f lavfi -i testsrc=duration=5:size=1280x720:rate=30 -c:v libx264 -preset fast -crf 23 sample-video.mp4

# Create 5-second test audio (sine wave at 440Hz)
ffmpeg -f lavfi -i sine=frequency=440:duration=5 -c:a aac -b:a 128k sample-audio.mp3

# Create test image (solid color 1280x720)
ffmpeg -f lavfi -i color=c=blue:size=1280x720:duration=1 -vframes 1 sample-image.png
```