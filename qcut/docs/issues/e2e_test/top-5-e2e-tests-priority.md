# Top 5 E2E Tests to Implement for QCut

**Document Version**: 1.1
**Created**: 2025-01-12
**Updated**: 2025-09-15
**Status**: Updated after codebase analysis - Ready for Implementation

## Executive Summary

Based on the current testing strategy and QCut's architecture, these are the **5 most critical E2E tests** that should be implemented first. These tests cover the core user workflows and critical business functionality that would have the highest impact on user experience if broken.

## Codebase Analysis Results

**✅ Updated after analyzing current implementation** (2025-09-15)

### Key Architecture Findings:
- **Media Panel**: Fully functional at `apps/web/src/components/editor/media-panel/views/media.tsx`
- **Timeline System**: Complete with `timeline-element.tsx` and `timeline-track.tsx`
- **Preview System**: Advanced preview panel with sticker overlay support
- **Project Management**: Robust project store with save/load functionality
- **File Handling**: Integrated drag-drop with progress tracking

### Components That Exist and Are Ready:
1. ✅ Media import/management (media.tsx)
2. ✅ Timeline tracks and elements (timeline-track.tsx, timeline-element.tsx)
3. ✅ Project creation/loading (projects.lazy.tsx with useProjectStore)
4. ✅ Sticker overlay system (StickerCanvas.tsx)
5. ✅ Text overlay system (text.tsx, text-properties.tsx)

### Components Requiring Investigation:
- Export functionality (may be in properties panel or separate components)
- AI features implementation status (ai.tsx exists but needs functional verification)
- Auto-save mechanisms (may need implementation)

### Non-Breaking Implementation Strategy:
All test IDs will be added as **data-testid attributes** to existing elements without modifying core functionality or component behavior. This ensures zero risk to existing features while enabling comprehensive E2E testing.

## Priority E2E Tests

### 1. 🎬 **Complete Video Project Workflow**
**Priority**: CRITICAL
**Total Estimated Time**: 30-45 minutes (Split into 3 subtasks)

#### Subtask 1A: Project Creation & Media Import (15 minutes)
**File**: `apps/web/src/test/e2e/project-workflow-part1.e2e.ts`

```typescript
import { test, expect } from '@playwright/test';
import { ElectronApplication } from 'playwright';

test.describe('Project Creation & Media Import', () => {
  let app: ElectronApplication;

  test('should create project and import media', async () => {
    // Test steps:
    // 1. Create new project with settings (1080p, 30fps)
    // 2. Import video file (MP4)
    // 3. Verify media appears in media panel

    // Add data-testid to components:
    // - apps/web/src/components/editor/project-settings.tsx: data-testid="project-settings"
    // - apps/web/src/components/editor/media-panel/media-upload.tsx: data-testid="media-upload"

    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-width-input').fill('1920');
    await page.getByTestId('project-height-input').fill('1080');
    await page.getByTestId('project-fps-input').fill('30');
    await page.getByTestId('create-project-confirm').click();

    // Import media file
    await page.getByTestId('import-media-button').click();
    await page.setInputFiles('[data-testid="file-input"]', 'src/test/e2e/fixtures/media/sample-video.mp4');

    // Verify media imported
    await expect(page.getByTestId('media-item')).toBeVisible();
  });
});
```

**Files to Modify (Non-breaking):**
- `apps/web/src/routes/projects.lazy.tsx` - Add `data-testid="new-project-button"` to the Plus button in handleCreateProject
- `apps/web/src/components/editor/media-panel/views/media.tsx` - Add `data-testid="import-media-button"` to the Plus button at line 342
- `apps/web/src/components/editor/media-panel/views/media.tsx` - Add `data-testid="media-item"` to DraggableMediaItem components at line 373

#### Subtask 1B: Timeline Operations (15 minutes)
**File**: `apps/web/src/test/e2e/project-workflow-part2.e2e.ts`

```typescript
test.describe('Timeline Operations', () => {
  test('should add media to timeline and perform basic edits', async () => {
    // Test steps:
    // 1. Add video to timeline (drag & drop)
    // 2. Trim video (cut 5 seconds from start)
    // 3. Verify timeline state

    // Drag media to timeline
    const mediaItem = page.getByTestId('media-item').first();
    const timeline = page.getByTestId('timeline-track');
    await mediaItem.dragTo(timeline);

    // Verify media on timeline
    await expect(page.getByTestId('timeline-element')).toBeVisible();

    // Trim operation
    await page.getByTestId('timeline-element').click();
    await page.getByTestId('trim-start-handle').dragTo(
      page.getByTestId('timeline-ruler').locator('[data-time="5"]')
    );

    // Verify trim applied
    const duration = await page.getByTestId('timeline-element').getAttribute('data-duration');
    expect(Number(duration)).toBeLessThan(10); // Original was ~10s, now should be ~5s
  });
});
```

**Files to Modify (Non-breaking):**
- `apps/web/src/components/editor/timeline/timeline-track.tsx` - Add `data-testid="timeline-track"` to the div at line 1115 (.track-elements-container)
- `apps/web/src/components/editor/timeline/timeline-element.tsx` - Add `data-testid="timeline-element"` to the div at line 453 and `data-duration` attribute calculating from element.duration - element.trimStart - element.trimEnd
- `apps/web/src/components/editor/timeline/timeline-element.tsx` - Add `data-testid="trim-start-handle"` to the left resize handle at line 496

#### Subtask 1C: Project Persistence & Export (15 minutes)
**File**: `apps/web/src/test/e2e/project-workflow-part3.e2e.ts`

```typescript
test.describe('Project Persistence & Export', () => {
  test('should save, reload project and export video', async () => {
    // Test steps:
    // 1. Save project
    // 2. Reload project
    // 3. Verify timeline state preserved
    // 4. Export as MP4 (720p)
    // 5. Verify output file exists

    // Save project
    await page.getByTestId('save-project-button').click();
    await page.getByTestId('project-name-input').fill('E2E Test Project');
    await page.getByTestId('save-confirm-button').click();

    // Verify save completed
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    // Reload application (simulate restart)
    await app.close();
    app = await electron.launch({ args: ['dist/electron/main.js'] });
    const newPage = await app.firstWindow();

    // Open saved project
    await newPage.getByTestId('open-project-button').click();
    await newPage.getByTestId('project-list-item').filter({ hasText: 'E2E Test Project' }).click();

    // Verify timeline state preserved
    await expect(newPage.getByTestId('timeline-element')).toBeVisible();

    // Export video
    await newPage.getByTestId('export-button').click();
    await newPage.getByTestId('export-resolution-select').selectOption('720p');
    await newPage.getByTestId('export-format-select').selectOption('mp4');
    await newPage.getByTestId('export-start-button').click();

    // Wait for export completion (up to 2 minutes)
    await expect(newPage.getByTestId('export-status')).toContainText('Complete', { timeout: 120000 });

    // Verify output file exists
    const exportPath = await newPage.getByTestId('export-output-path').textContent();
    expect(exportPath).toBeTruthy();
  });
});
```

**Files to Modify (Non-breaking):**
- Create save/export functionality in components that don't exist yet, or use existing project store methods
- Use the existing `createNewProject`, `savedProjects` from useProjectStore found in projects.lazy.tsx
- `apps/web/src/routes/projects.lazy.tsx` - Add `data-testid="project-list-item"` to the Card components that render projects

#### Why Critical:
- Covers the entire user journey from start to finish
- Tests data persistence across sessions
- Validates FFmpeg integration
- Ensures project state management works correctly

---

### 2. 📁 **Multi-Media Import and Timeline Management**
**Priority**: CRITICAL
**Total Estimated Time**: 20-30 minutes (Split into 2 subtasks)

#### Subtask 2A: Multi-Media Import & Track Management (15 minutes)
**File**: `apps/web/src/test/e2e/media-timeline-part1.e2e.ts`

```typescript
test.describe('Multi-Media Import & Track Management', () => {
  test('should import multiple media types and arrange on timeline', async () => {
    // Test steps:
    // 1. Import multiple media types (MP4, MP3, PNG)
    // 2. Add all to timeline on different tracks
    // 3. Arrange media (overlap audio with video, position image as overlay)

    // Import video file
    await page.getByTestId('import-media-button').click();
    await page.setInputFiles('[data-testid="file-input"]', [
      'src/test/e2e/fixtures/media/sample-video.mp4',
      'src/test/e2e/fixtures/media/sample-audio.mp3',
      'src/test/e2e/fixtures/media/sample-image.png'
    ]);

    // Verify all media imported
    await expect(page.getByTestId('media-item')).toHaveCount(3);
    await expect(page.getByTestId('media-item').filter({ hasText: '.mp4' })).toBeVisible();
    await expect(page.getByTestId('media-item').filter({ hasText: '.mp3' })).toBeVisible();
    await expect(page.getByTestId('media-item').filter({ hasText: '.png' })).toBeVisible();

    // Add video to video track
    const videoItem = page.getByTestId('media-item').filter({ hasText: '.mp4' });
    const videoTrack = page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'video' });
    await videoItem.dragTo(videoTrack);

    // Add audio to audio track
    const audioItem = page.getByTestId('media-item').filter({ hasText: '.mp3' });
    const audioTrack = page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'audio' });
    await audioItem.dragTo(audioTrack);

    // Add image to overlay track
    const imageItem = page.getByTestId('media-item').filter({ hasText: '.png' });
    const overlayTrack = page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'overlay' });
    await imageItem.dragTo(overlayTrack);

    // Verify all tracks have elements
    await expect(videoTrack.getByTestId('timeline-element')).toBeVisible();
    await expect(audioTrack.getByTestId('timeline-element')).toBeVisible();
    await expect(overlayTrack.getByTestId('timeline-element')).toBeVisible();

    // Overlap audio with video (move audio to start at 2 seconds)
    const audioElement = audioTrack.getByTestId('timeline-element');
    await audioElement.dragTo(page.getByTestId('timeline-ruler').locator('[data-time="2"]'));
  });
});
```

**Files to Modify (Non-breaking):**
- `apps/web/src/components/editor/timeline/timeline-track.tsx` - Add `data-track-type={track.type}` attribute to the container div at line 1101
- Timeline ruler functionality needs to be found in the main timeline component (not timeline-track.tsx)
- `apps/web/src/components/editor/media-panel/views/media.tsx` - File extension already available via item.name - no changes needed for identification

#### Subtask 2B: Timeline Controls & Editing Operations (15 minutes)
**File**: `apps/web/src/test/e2e/media-timeline-part2.e2e.ts`

```typescript
test.describe('Timeline Controls & Editing Operations', () => {
  test('should control playback and perform edit operations', async () => {
    // Test steps:
    // 1. Test timeline controls (play/pause, seek, zoom)
    // 2. Split video clip at playhead
    // 3. Delete segment
    // 4. Undo/redo operations

    // Test playback controls
    await page.getByTestId('play-button').click();
    await expect(page.getByTestId('play-button')).toHaveAttribute('data-playing', 'true');

    await page.getByTestId('pause-button').click();
    await expect(page.getByTestId('play-button')).toHaveAttribute('data-playing', 'false');

    // Test seek functionality
    await page.getByTestId('timeline-ruler').locator('[data-time="5"]').click();
    const currentTime = await page.getByTestId('current-time-display').textContent();
    expect(currentTime).toContain('00:05');

    // Test zoom controls
    await page.getByTestId('zoom-in-button').click();
    const zoomLevel = await page.getByTestId('timeline-container').getAttribute('data-zoom-level');
    expect(Number(zoomLevel)).toBeGreaterThan(1);

    await page.getByTestId('zoom-out-button').click();
    const newZoomLevel = await page.getByTestId('timeline-container').getAttribute('data-zoom-level');
    expect(Number(newZoomLevel)).toBeLessThan(Number(zoomLevel));

    // Split video clip at playhead (set playhead to 3 seconds)
    await page.getByTestId('timeline-ruler').locator('[data-time="3"]').click();
    const videoElement = page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'video' })
                            .getByTestId('timeline-element');
    await videoElement.click();
    await page.getByTestId('split-clip-button').click();

    // Verify clip was split (should now have 2 elements on video track)
    await expect(page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'video' })
                    .getByTestId('timeline-element')).toHaveCount(2);

    // Delete second segment
    const secondSegment = page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'video' })
                             .getByTestId('timeline-element').nth(1);
    await secondSegment.click();
    await page.keyboard.press('Delete');

    // Verify segment deleted
    await expect(page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'video' })
                    .getByTestId('timeline-element')).toHaveCount(1);

    // Test undo operation
    await page.keyboard.press('Control+Z');
    await expect(page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'video' })
                    .getByTestId('timeline-element')).toHaveCount(2);

    // Test redo operation
    await page.keyboard.press('Control+Y');
    await expect(page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'video' })
                    .getByTestId('timeline-element')).toHaveCount(1);
  });
});
```

**Files to Modify (Non-breaking):**
- `apps/web/src/components/editor/preview-panel.tsx` - Found Play/Pause icons at line 20, add data-testids to Button components containing these icons
- Need to locate the main timeline component that contains zoom controls (not in timeline-track.tsx)
- Split functionality exists in timeline-element.tsx context menu - may need to expose as toolbar button
- Time display likely in preview-panel-components.tsx or similar

#### Why Critical:
- Tests multi-track timeline functionality
- Validates media compatibility
- Ensures timeline manipulation works
- Tests undo/redo system integrity

---

### 3. 🎨 **Sticker and Text Overlay System**
**Priority**: HIGH
**Total Estimated Time**: 20-25 minutes (Split into 2 subtasks)

#### Subtask 3A: Sticker Integration & Canvas Operations (12 minutes)
**File**: `apps/web/src/test/e2e/overlays-part1.e2e.ts`

```typescript
test.describe('Sticker Integration & Canvas Operations', () => {
  test('should add and manipulate stickers on canvas', async () => {
    // Test steps:
    // 1. Add video to timeline
    // 2. Open stickers panel
    // 3. Add animated sticker and manipulate it

    // Add video to timeline first
    const videoItem = page.getByTestId('media-item').filter({ hasText: '.mp4' });
    const videoTrack = page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'video' });
    await videoItem.dragTo(videoTrack);

    // Open stickers panel
    await page.getByTestId('stickers-panel-tab').click();
    await expect(page.getByTestId('stickers-panel')).toBeVisible();

    // Browse stickers and select one
    await page.getByTestId('sticker-category').filter({ hasText: 'Animals' }).click();
    const stickerItem = page.getByTestId('sticker-item').first();
    await stickerItem.click();

    // Add sticker to canvas (drag to preview canvas)
    const previewCanvas = page.getByTestId('preview-canvas');
    await stickerItem.dragTo(previewCanvas);

    // Verify sticker appears on canvas
    await expect(page.getByTestId('canvas-sticker')).toBeVisible();

    // Test sticker positioning
    const stickerElement = page.getByTestId('canvas-sticker');
    const canvasCenter = await previewCanvas.boundingBox();
    if (canvasCenter) {
      await stickerElement.dragTo(previewCanvas, {
        targetPosition: { x: canvasCenter.width / 2, y: canvasCenter.height / 2 }
      });
    }

    // Test sticker resizing
    const resizeHandle = page.getByTestId('sticker-resize-handle');
    await expect(resizeHandle).toBeVisible();
    await resizeHandle.dragTo(resizeHandle, { targetPosition: { x: 50, y: 50 } });

    // Set sticker duration (5 seconds)
    await stickerElement.click();
    await page.getByTestId('sticker-duration-input').fill('5');
    await page.getByTestId('apply-duration-button').click();

    // Verify sticker properties
    const duration = await stickerElement.getAttribute('data-duration');
    expect(duration).toBe('5');
  });
});
```

**Files to Modify (Non-breaking):**
- `apps/web/src/components/editor/media-panel/tabbar.tsx` - Add `data-testid="stickers-panel-tab"` to stickers tab button
- `apps/web/src/components/editor/media-panel/views/stickers.tsx` - Add `data-testid="stickers-panel"` to main container
- `apps/web/src/components/editor/media-panel/views/stickers/components/sticker-item.tsx` - Add `data-testid="sticker-item"` to the button element
- `apps/web/src/components/editor/preview-panel.tsx` - Add `data-testid="preview-canvas"` to the video/canvas container
- `apps/web/src/components/editor/stickers-overlay/StickerCanvas.tsx` - Already exists, add data-testids to sticker elements and ResizeHandles component
- Properties panel for stickers needs to be located or created

#### Subtask 3B: Text Overlays & Export Verification (13 minutes)
**File**: `apps/web/src/test/e2e/overlays-part2.e2e.ts`

```typescript
test.describe('Text Overlays & Export Verification', () => {
  test('should add text overlays and verify in export', async () => {
    // Test steps:
    // 1. Add text overlay with styling
    // 2. Preview with overlays
    // 3. Export with overlays
    // 4. Verify overlays in output

    // Add text overlay
    await page.getByTestId('text-overlay-button').click();
    const textBox = page.getByTestId('text-input-box');
    await textBox.fill('Test Title');

    // Position text on canvas
    const previewCanvas = page.getByTestId('preview-canvas');
    const textElement = page.getByTestId('canvas-text');
    await textElement.dragTo(previewCanvas, {
      targetPosition: { x: 100, y: 50 } // Top area
    });

    // Change font size
    await textElement.click();
    await page.getByTestId('font-size-input').fill('24');
    await page.getByTestId('apply-font-size-button').click();

    // Set text animation (fade in)
    await page.getByTestId('text-animation-select').selectOption('fade-in');
    await page.getByTestId('apply-animation-button').click();

    // Test preview with overlays
    await page.getByTestId('play-button').click();

    // Verify overlays visible during playback
    await expect(page.getByTestId('canvas-sticker')).toBeVisible();
    await expect(page.getByTestId('canvas-text')).toBeVisible();

    // Stop playback
    await page.getByTestId('pause-button').click();

    // Test export with overlays
    await page.getByTestId('export-button').click();
    await page.getByTestId('export-resolution-select').selectOption('720p');
    await page.getByTestId('export-include-overlays-checkbox').check();
    await page.getByTestId('export-start-button').click();

    // Wait for export completion
    await expect(page.getByTestId('export-status')).toContainText('Complete', { timeout: 120000 });

    // Verify export contains overlays (check export log or metadata)
    const exportLog = await page.getByTestId('export-log').textContent();
    expect(exportLog).toContain('Overlays: 2 rendered');
    expect(exportLog).toContain('Text overlays: 1');
    expect(exportLog).toContain('Sticker overlays: 1');

    // Get export file path
    const exportPath = await page.getByTestId('export-output-path').textContent();
    expect(exportPath).toBeTruthy();
    expect(exportPath).toContain('.mp4');
  });
});
```

**Files to Modify (Non-breaking):**
- `apps/web/src/components/editor/media-panel/views/text.tsx` - Already exists, add `data-testid="text-overlay-button"` to main action button
- Text input functionality needs to be located in the text components
- Preview panel likely renders text elements - add `data-testid="canvas-text"`
- `apps/web/src/components/editor/properties-panel/text-properties.tsx` - Already exists, add test IDs to styling inputs
- Export functionality may need to be created or located in existing export components

#### Why Critical:
- Tests canvas-based overlay system
- Validates real-time preview
- Ensures overlay persistence in exports
- Tests animation system

---

### 4. 🤖 **AI Features Integration (Transcription & Enhancement)**
**Priority**: HIGH
**Total Estimated Time**: 25-30 minutes (Split into 2 subtasks)

#### Subtask 4A: Transcription Service & Subtitle Generation (15 minutes)
**File**: `apps/web/src/test/e2e/ai-features-part1.e2e.ts`

```typescript
test.describe('Transcription Service & Subtitle Generation', () => {
  test('should generate and edit subtitles from video', async () => {
    // Test steps:
    // 1. Import video with speech
    // 2. Generate transcription
    // 3. Edit subtitles

    // Import video with speech
    await page.getByTestId('import-media-button').click();
    await page.setInputFiles('[data-testid="file-input"]', 'src/test/e2e/fixtures/media/sample-speech-video.mp4');

    // Add video to timeline
    const videoItem = page.getByTestId('media-item').filter({ hasText: 'speech-video' });
    const videoTrack = page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'video' });
    await videoItem.dragTo(videoTrack);

    // Open AI features panel
    await page.getByTestId('ai-panel-tab').click();
    await expect(page.getByTestId('ai-features-panel')).toBeVisible();

    // Select transcription service
    await page.getByTestId('transcription-service-select').selectOption('whisper');

    // Check if API key is configured
    const apiKeyStatus = page.getByTestId('api-key-status');
    const hasApiKey = await apiKeyStatus.textContent();

    if (hasApiKey?.includes('Not configured')) {
      // Set up test API key (use environment variable)
      await page.getByTestId('configure-api-key-button').click();
      await page.getByTestId('api-key-input').fill(process.env.TEST_TRANSCRIPTION_API_KEY || 'test-key');
      await page.getByTestId('save-api-key-button').click();
    }

    // Start transcription
    await page.getByTestId('start-transcription-button').click();

    // Wait for transcription to complete (up to 2 minutes)
    await expect(page.getByTestId('transcription-status')).toContainText('Complete', { timeout: 120000 });

    // Verify subtitles generated
    await expect(page.getByTestId('subtitle-track')).toBeVisible();
    await expect(page.getByTestId('subtitle-segment')).toHaveCount.toBeGreaterThan(0);

    // Edit subtitle text
    const firstSubtitle = page.getByTestId('subtitle-segment').first();
    await firstSubtitle.click();
    await page.getByTestId('subtitle-text-input').fill('Edited test subtitle');
    await page.getByTestId('save-subtitle-edit-button').click();

    // Verify edit applied
    await expect(firstSubtitle).toContainText('Edited test subtitle');

    // Adjust subtitle timing
    await firstSubtitle.click();
    await page.getByTestId('subtitle-start-time-input').fill('00:01.500');
    await page.getByTestId('subtitle-end-time-input').fill('00:03.000');
    await page.getByTestId('save-timing-button').click();

    // Verify timing adjustment
    const startTime = await firstSubtitle.getAttribute('data-start-time');
    expect(startTime).toBe('1.5');
  });
});
```

**Files to Modify (Non-breaking):**
- AI functionality may not be fully implemented yet - need to check if `ai.tsx` exists and is functional
- `apps/web/src/components/editor/media-panel/views/ai.tsx` - Already exists, add panel and control test IDs
- Transcription/subtitle functionality may be limited - check existing implementation
- Caption functionality exists (`captions.tsx`) - may use this instead of separate subtitle tracks

#### Subtask 4B: AI Enhancement & Export with Subtitles (15 minutes)
**File**: `apps/web/src/test/e2e/ai-features-part2.e2e.ts`

```typescript
test.describe('AI Enhancement & Export with Subtitles', () => {
  test('should apply AI enhancement and export with subtitles', async () => {
    // Test steps:
    // 1. Apply AI enhancement to video segment
    // 2. Preview enhanced result
    // 3. Export with subtitles
    // 4. Verify subtitle track in output

    // Select video segment for enhancement
    const videoElement = page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'video' })
                            .getByTestId('timeline-element');
    await videoElement.click();

    // Open AI enhancement panel
    await page.getByTestId('ai-enhancement-tab').click();
    await expect(page.getByTestId('ai-enhancement-panel')).toBeVisible();

    // Select enhancement type
    await page.getByTestId('enhancement-type-select').selectOption('upscale');

    // Configure enhancement settings
    await page.getByTestId('enhancement-quality-select').selectOption('high');
    await page.getByTestId('enhancement-model-select').selectOption('real-esrgan');

    // Apply enhancement to selected segment
    await page.getByTestId('apply-enhancement-button').click();

    // Wait for enhancement processing
    await expect(page.getByTestId('enhancement-status')).toContainText('Processing', { timeout: 10000 });
    await expect(page.getByTestId('enhancement-status')).toContainText('Complete', { timeout: 180000 });

    // Preview enhanced result
    await page.getByTestId('preview-enhanced-button').click();
    await page.getByTestId('play-button').click();

    // Verify enhanced video is playing
    await expect(page.getByTestId('video-preview')).toHaveAttribute('data-enhanced', 'true');

    // Stop preview
    await page.getByTestId('pause-button').click();

    // Export with subtitles
    await page.getByTestId('export-button').click();

    // Configure export settings
    await page.getByTestId('export-resolution-select').selectOption('1080p');
    await page.getByTestId('export-format-select').selectOption('mp4');

    // Enable subtitle export
    await page.getByTestId('export-include-subtitles-checkbox').check();
    await page.getByTestId('subtitle-format-select').selectOption('srt');

    // Start export
    await page.getByTestId('export-start-button').click();

    // Wait for export completion
    await expect(page.getByTestId('export-status')).toContainText('Complete', { timeout: 180000 });

    // Verify export contains subtitles
    const exportLog = await page.getByTestId('export-log').textContent();
    expect(exportLog).toContain('Subtitle track: embedded');
    expect(exportLog).toContain('Enhancement applied: upscale');

    // Verify subtitle file created
    const exportPath = await page.getByTestId('export-output-path').textContent();
    expect(exportPath).toContain('.mp4');

    // Check for separate subtitle file
    const subtitlePath = await page.getByTestId('subtitle-file-path').textContent();
    expect(subtitlePath).toContain('.srt');

    // Verify export quality
    const exportQuality = await page.getByTestId('export-quality-info').textContent();
    expect(exportQuality).toContain('1080p');
    expect(exportQuality).toContain('Enhanced');
  });
});
```

**Files to Modify (Non-breaking):**
- AI enhancement functionality may not be fully implemented - check if these components exist
- Preview panel already imports StickerCanvas and has comprehensive preview logic
- Export functionality needs to be located - may be in properties panel or separate components
- Focus on existing features rather than potentially unimplemented AI enhancements

#### Why Critical:
- Tests Electron IPC for AI services
- Validates API key management
- Ensures subtitle workflow works
- Tests AI enhancement pipeline

---

### 5. 🔄 **Cross-Platform File Handling and Storage**
**Priority**: HIGH
**Total Estimated Time**: 15-20 minutes (Split into 2 subtasks)

#### Subtask 5A: File Operations & Storage Management (10 minutes)
**File**: `apps/web/src/test/e2e/file-storage-part1.e2e.ts`

```typescript
test.describe('File Operations & Storage Management', () => {
  test('should handle file operations and storage fallback', async () => {
    // Test steps:
    // 1. Test file operations (open dialog, large file, thumbnail)
    // 2. Test storage fallback system

    // Test file dialog integration
    await page.getByTestId('import-media-button').click();

    // Listen for file dialog (mock large file selection)
    page.on('filechooser', async (fileChooser) => {
      await fileChooser.setFiles('src/test/e2e/fixtures/media/large-video.mp4');
    });

    // Trigger file dialog
    await page.getByTestId('browse-files-button').click();

    // Verify large file import progress
    await expect(page.getByTestId('import-progress-bar')).toBeVisible();
    await expect(page.getByTestId('import-status')).toContainText('Processing large file');

    // Wait for import completion
    await expect(page.getByTestId('import-status')).toContainText('Import complete', { timeout: 60000 });

    // Verify thumbnail generation
    const mediaItem = page.getByTestId('media-item').filter({ hasText: 'large-video' });
    await expect(mediaItem.getByTestId('media-thumbnail')).toBeVisible();

    // Verify file size display
    const fileSize = await mediaItem.getByTestId('file-size').textContent();
    expect(fileSize).toMatch(/\d+(\.\d+)?\s*(MB|GB)/);

    // Test storage quota simulation
    await page.evaluate(() => {
      // Simulate IndexedDB quota exceeded
      window.testStorageQuotaExceeded = true;
    });

    // Add media to timeline (should trigger storage operations)
    const videoTrack = page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'video' });
    await mediaItem.dragTo(videoTrack);

    // Verify storage fallback message
    await expect(page.getByTestId('storage-warning')).toContainText('Using fallback storage');

    // Verify project still saves with fallback
    await page.getByTestId('save-project-button').click();
    await page.getByTestId('project-name-input').fill('Storage Test Project');
    await page.getByTestId('save-confirm-button').click();

    await expect(page.getByTestId('save-status')).toContainText('Saved');
  });
});
```

**Files to Modify (Non-breaking):**
- File browser is integrated into media.tsx with file input at line 300 - add test ID there
- Import progress is shown via state in media.tsx - add test IDs to progress indicators
- Media thumbnails are rendered in the renderPreview function - add test IDs there
- Storage service exists - add warning mechanisms as needed
- DraggableMediaItem component is used - may need test IDs there instead

#### Subtask 5B: Auto-Save & Export File Management (10 minutes)
**File**: `apps/web/src/test/e2e/file-storage-part2.e2e.ts`

```typescript
test.describe('Auto-Save & Export File Management', () => {
  test('should handle auto-save and export file operations', async () => {
    // Test steps:
    // 1. Test auto-save functionality
    // 2. Test export to custom locations
    // 3. Test special character handling

    // Enable auto-save
    await page.getByTestId('settings-button').click();
    await page.getByTestId('auto-save-checkbox').check();
    await page.getByTestId('auto-save-interval-input').fill('30'); // 30 seconds
    await page.getByTestId('save-settings-button').click();

    // Make timeline changes that should trigger auto-save
    const videoItem = page.getByTestId('media-item').first();
    const videoTrack = page.getByTestId('timeline-track').filter({ hasAttribute: 'data-track-type', value: 'video' });
    await videoItem.dragTo(videoTrack);

    // Add text overlay
    await page.getByTestId('text-overlay-button').click();
    await page.getByTestId('text-input-box').fill('Auto-save test');

    // Wait for auto-save indicator
    await expect(page.getByTestId('auto-save-indicator')).toContainText('Auto-saving...', { timeout: 35000 });
    await expect(page.getByTestId('auto-save-indicator')).toContainText('Auto-saved', { timeout: 10000 });

    // Simulate application crash/force quit
    await page.evaluate(() => {
      window.testForceQuit = true;
    });

    // Restart application
    await app.close();
    const newApp = await electron.launch({ args: ['dist/electron/main.js'] });
    const newPage = await newApp.firstWindow();

    // Verify recovery prompt
    await expect(newPage.getByTestId('recovery-dialog')).toBeVisible();
    await expect(newPage.getByTestId('recovery-message')).toContainText('unsaved changes');

    // Recover project
    await newPage.getByTestId('recover-project-button').click();

    // Verify timeline state recovered
    await expect(newPage.getByTestId('timeline-element')).toBeVisible();
    await expect(newPage.getByTestId('canvas-text')).toContainText('Auto-save test');

    // Test export to custom directory
    await newPage.getByTestId('export-button').click();

    // Set custom export location
    await newPage.getByTestId('custom-export-location-button').click();

    // Mock directory selection
    newPage.on('dialog', async (dialog) => {
      expect(dialog.type()).toBe('save');
      await dialog.accept('/custom/export/path/');
    });

    // Test export with special characters in filename
    await newPage.getByTestId('export-filename-input').fill('Test Video (Special & Characters) [2024]');
    await newPage.getByTestId('export-resolution-select').selectOption('720p');
    await newPage.getByTestId('export-start-button').click();

    // Verify export started
    await expect(newPage.getByTestId('export-status')).toContainText('Exporting');

    // Verify file path handling
    const exportPath = await newPage.getByTestId('export-output-path').textContent();
    expect(exportPath).toContain('/custom/export/path/');
    expect(exportPath).toContain('Test Video (Special & Characters) [2024]');

    // Wait for export completion
    await expect(newPage.getByTestId('export-status')).toContainText('Complete', { timeout: 120000 });

    // Verify file permissions (cross-platform)
    const filePermissions = await newPage.getByTestId('file-permissions-status').textContent();
    expect(filePermissions).toContain('Read/Write access confirmed');
  });
});
```

**Files to Modify (Non-breaking):**
- Auto-save functionality may not be fully implemented yet - check if components exist
- Recovery mechanisms need to be implemented if not present
- Export functionality exists somewhere - need to locate actual export components
- Focus on core workflow tests rather than advanced features that may not exist

#### Why Critical:
- Tests Electron file system integration
- Validates storage layer resilience
- Ensures data recovery works
- Tests cross-platform compatibility

---

## Implementation Guidelines

### Test Environment Setup
```typescript
// Base E2E test configuration
import { test, expect } from '@playwright/test';
import { ElectronApplication, Page } from 'playwright';

test.describe('QCut E2E Tests', () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    // Launch Electron app
    app = await electron.launch({
      args: ['dist/electron/main.js'],
      env: { NODE_ENV: 'test' }
    });
    page = await app.firstWindow();
  });

  test.afterAll(async () => {
    await app.close();
  });
});
```

### Key Testing Considerations

1. **Test Data Management**
   - Use small test media files (< 10MB)
   - Clean up generated files after tests
   - Use consistent test project names

2. **Timing and Waits**
   - Account for FFmpeg processing time
   - Wait for IndexedDB operations
   - Handle async timeline updates

3. **Platform Differences**
   - Test on Windows, macOS, Linux
   - Handle path separator differences
   - Account for codec availability

4. **Error Scenarios**
   - Test with corrupted media files
   - Test storage quota exceeded
   - Test network failures for AI features

## Success Metrics

### Coverage Goals
- **User Workflows**: 100% of critical paths
- **Feature Integration**: All major features tested
- **Error Handling**: Common failure scenarios covered
- **Performance**: Export times within acceptable range

### Quality Indicators
- Tests run in < 5 minutes total
- Zero flaky tests
- Clear failure messages
- Reproducible across platforms

## Detailed Integration Plan

### Phase 1: Setup & Infrastructure (Week 1)

#### Files to Create/Modify:

**Package Configuration:**
- `qcut/package.json` - Add Playwright dependencies and test scripts
- `qcut/apps/web/package.json` - Add e2e test scripts
- `qcut/playwright.config.ts` - Main Playwright configuration for Electron

**Test Infrastructure:**
- `qcut/apps/web/src/test/e2e/` - Create E2E test directory structure
- `qcut/apps/web/src/test/e2e/fixtures/` - Test media files and project templates
- `qcut/apps/web/src/test/e2e/helpers/` - Utility functions and test helpers
- `qcut/apps/web/src/test/e2e/setup/` - Global test setup and teardown

**Configuration Files:**
- `qcut/apps/web/src/test/e2e/setup/global-setup.ts` - Global test environment setup
- `qcut/apps/web/src/test/e2e/setup/global-teardown.ts` - Cleanup after tests
- `qcut/apps/web/src/test/e2e/helpers/electron-helpers.ts` - Electron-specific utilities
- `qcut/apps/web/src/test/e2e/helpers/media-helpers.ts` - Media file handling utilities

### Phase 2: Core Test Implementation (Weeks 2-3)

#### Test Files to Create:

**Critical Priority Tests:**
- `qcut/apps/web/src/test/e2e/project-workflow.e2e.ts` - Complete video project workflow
- `qcut/apps/web/src/test/e2e/media-timeline.e2e.ts` - Multi-media import and timeline management

**High Priority Tests:**
- `qcut/apps/web/src/test/e2e/overlays.e2e.ts` - Sticker and text overlay system
- `qcut/apps/web/src/test/e2e/ai-features.e2e.ts` - AI features integration
- `qcut/apps/web/src/test/e2e/file-storage.e2e.ts` - Cross-platform file handling

#### Test Fixtures to Create:
- `qcut/apps/web/src/test/e2e/fixtures/media/sample-video.mp4` - Small test video (5MB)
- `qcut/apps/web/src/test/e2e/fixtures/media/sample-audio.mp3` - Test audio file (1MB)
- `qcut/apps/web/src/test/e2e/fixtures/media/sample-image.png` - Test image (500KB)
- `qcut/apps/web/src/test/e2e/fixtures/projects/basic-project.json` - Template project
- `qcut/apps/web/src/test/e2e/fixtures/projects/multi-track-project.json` - Complex project template

### Phase 3: CI/CD Integration (Week 4)

#### Files to Modify/Create:

**GitHub Actions:**
- `.github/workflows/e2e-tests.yml` - E2E test workflow for CI/CD
- `.github/workflows/pr-validation.yml` - Update to include E2E tests

**Build Configuration:**
- `qcut/turbo.json` - Add e2e test task to Turborepo config
- `qcut/.gitignore` - Add E2E test artifacts to ignore list

### Detailed File Structure:

```
qcut/
├── playwright.config.ts                           # Main Playwright config
├── package.json                                   # Add Playwright deps
├── apps/web/
│   ├── package.json                              # Add e2e scripts
│   └── src/test/e2e/
│       ├── setup/
│       │   ├── global-setup.ts                   # Global test setup
│       │   └── global-teardown.ts                # Global cleanup
│       ├── helpers/
│       │   ├── electron-helpers.ts               # Electron utilities
│       │   ├── media-helpers.ts                  # Media utilities
│       │   ├── timeline-helpers.ts               # Timeline utilities
│       │   ├── project-helpers.ts                # Project utilities
│       │   └── assertion-helpers.ts              # Custom assertions
│       ├── fixtures/
│       │   ├── media/
│       │   │   ├── sample-video.mp4             # Test video file
│       │   │   ├── sample-audio.mp3             # Test audio file
│       │   │   └── sample-image.png             # Test image file
│       │   └── projects/
│       │       ├── basic-project.json           # Basic project template
│       │       └── multi-track-project.json     # Complex project template
│       ├── project-workflow.e2e.ts              # Test 1: Complete workflow
│       ├── media-timeline.e2e.ts                # Test 2: Media & timeline
│       ├── overlays.e2e.ts                      # Test 3: Stickers & text
│       ├── ai-features.e2e.ts                   # Test 4: AI integration
│       └── file-storage.e2e.ts                  # Test 5: File handling
├── .github/workflows/
│   ├── e2e-tests.yml                            # E2E CI workflow
│   └── pr-validation.yml                        # Update for E2E
└── turbo.json                                    # Add e2e task
```

### Implementation Schedule:

**Week 1: Infrastructure Setup**
1. Install Playwright dependencies
2. Create configuration files
3. Set up test directory structure
4. Create helper utilities
5. Add test fixtures

**Week 2: Critical Tests**
1. Implement project-workflow.e2e.ts
2. Implement media-timeline.e2e.ts
3. Create supporting test helpers
4. Validate tests work locally

**Week 3: High Priority Tests**
1. Implement overlays.e2e.ts
2. Implement ai-features.e2e.ts
3. Implement file-storage.e2e.ts
4. Refine test helpers and utilities

**Week 4: CI/CD Integration**
1. Create GitHub Actions workflows
2. Configure test reporting
3. Set up failure notifications
4. Test full CI/CD pipeline

### Dependencies to Add:

```json
{
  "devDependencies": {
    "@playwright/test": "^1.40.0",
    "playwright": "^1.40.0",
    "playwright-electron": "^0.4.0"
  }
}
```

### Configuration Requirements:

**Environment Variables:**
- `E2E_TEST_TIMEOUT` - Test timeout configuration
- `E2E_FIXTURES_PATH` - Path to test fixtures
- `E2E_OUTPUT_PATH` - Path for test outputs

**Component Updates:**
- Add `data-testid` attributes to key UI components
- Ensure consistent element selectors
- Add test-specific environment detection

## Next Steps

1. **Set up Playwright for Electron**
   ```bash
   bun add -D @playwright/test playwright playwright-electron
   ```

2. **Create test fixtures and helpers**
   - Media file fixtures
   - Project templates
   - Utility functions

3. **Implement tests in priority order**
   - Start with Project Workflow
   - Add remaining tests incrementally

4. **Integrate with CI/CD**
   - Run on PR creation
   - Generate test reports
   - Block merge on failures

## Notes

- These E2E tests complement the existing unit and integration tests
- Focus on user-visible functionality rather than implementation details
- Each test should be independent and not rely on others
- Use data-testid attributes for reliable element selection
- Consider visual regression testing for UI consistency

---

**For questions or updates**: Contact the QA team or refer to the main testing strategy document.